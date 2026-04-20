import { NextResponse } from 'next/server'
import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { MOONBAGS_AIDA_CONTRACT } from '@/lib/contracts_aida'

// One-time admin route to re-balance the fee withdrawal splits on the
// moonbags_aida Configuration. The contract init sets:
//   platform: 4000 (40%) · creator: 3000 (30%) · stake: 1 (~0%) · platform_stake: 2999 (~30%)
// But the intended/documented split per the docs + Earnings UI + agent pages is:
//   platform: 4000 (40%) · creator: 2500 (25%) · stake: 1000 (10%) · platform_stake: 2500 (25%)
//
// Requires presenting the AdminCap object to the contract's admin setter.
//
// Usage:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://robots-teal.vercel.app/api/admin/update-fee-split?adminCap=0xADMINCAP_OBJECT_ID&platform=4000&creator=2500&stake=1000&platformStake=2500"
//
// All four share params are basis points out of 10000 and must sum to exactly
// 10000 (client-side check; contract also enforces).

export const dynamic = 'force-dynamic'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'

function getAdminKeypair(): Ed25519Keypair {
  const secret = process.env.ADMIN_WALLET_SECRET
  if (!secret) throw new Error('ADMIN_WALLET_SECRET env var is required')
  try {
    const { secretKey } = decodeSuiPrivateKey(secret)
    return Ed25519Keypair.fromSecretKey(secretKey)
  } catch {
    const bytes = secret.startsWith('0x')
      ? Uint8Array.from(Buffer.from(secret.slice(2), 'hex'))
      : Uint8Array.from(Buffer.from(secret, 'base64'))
    return Ed25519Keypair.fromSecretKey(bytes)
  }
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.ADMIN_WALLET_SECRET) {
    return NextResponse.json({ error: 'ADMIN_WALLET_SECRET not configured' }, { status: 503 })
  }

  const url = new URL(req.url)
  const adminCap = url.searchParams.get('adminCap')
  const platform = Number(url.searchParams.get('platform') || '4000')
  const creator = Number(url.searchParams.get('creator') || '2500')
  const stake = Number(url.searchParams.get('stake') || '1000')
  const platformStake = Number(url.searchParams.get('platformStake') || '2500')

  if (!adminCap || !adminCap.startsWith('0x')) {
    return NextResponse.json({
      error: 'Missing ?adminCap=0x<AdminCap object ID>. Find it by querying the deployer wallet\'s owned objects for type moonbags::AdminCap.',
    }, { status: 400 })
  }
  for (const [name, v] of [['platform', platform], ['creator', creator], ['stake', stake], ['platformStake', platformStake]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 10000) {
      return NextResponse.json({ error: `Invalid ${name}: must be integer in [0, 10000]` }, { status: 400 })
    }
  }
  const sum = platform + creator + stake + platformStake
  if (sum !== 10000) {
    return NextResponse.json({
      error: `Shares must sum to exactly 10000 (100%). Got ${sum}.`,
    }, { status: 400 })
  }

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  try {
    const tx = new Transaction()
    tx.setSender(adminAddress)
    tx.setGasBudget(50_000_000)

    tx.moveCall({
      target: `${MOONBAGS_AIDA_CONTRACT.packageId}::moonbags::update_config_withdraw_fee`,
      arguments: [
        tx.object(adminCap),
        tx.object(MOONBAGS_AIDA_CONTRACT.configuration),
        tx.pure.u16(platform),
        tx.pure.u16(creator),
        tx.pure.u16(stake),
        tx.pure.u16(platformStake),
      ],
    })

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true },
    })

    const ok = result.effects?.status?.status === 'success'
    return NextResponse.json({
      success: ok,
      digest: result.digest,
      newSplit: { platform, creator, stake, platformStake, sum },
      error: ok ? undefined : JSON.stringify(result.effects?.status),
    })
  } catch (e: any) {
    console.error(`[update-fee-split] failed: ${e.message}`)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
