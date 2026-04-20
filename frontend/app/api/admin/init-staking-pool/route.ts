import { NextResponse } from 'next/server'
import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { MOONBAGS_AIDA_CONTRACT } from '@/lib/contracts_aida'

// One-time admin route to call moonbags_stake::initialize_staking_pool<T> for a given token type.
// Required once per StakingToken before withdraw_fee_bonding_curve can succeed — the reward
// index update aborts with code 1 (EStakingPoolNotExist) if the pool isn't initialized.
//
// Usage:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://robots-teal.vercel.app/api/admin/init-staking-pool?token=0xcee208...::aida::AIDA"
//
// Run once with AIDA coin type (for PlatformToken stakers), then once per launched meme
// token (HERO, etc.). After this, fee distribution works. Going forward, the create-token
// flow should call initialize_staking_pool inline so new tokens are self-initializing.

export const dynamic = 'force-dynamic'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

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
  const tokenType = url.searchParams.get('token')
  if (!tokenType || !tokenType.includes('::')) {
    return NextResponse.json({
      error: 'Missing ?token=<coinType> query param (e.g. 0xcee208...::aida::AIDA)',
    }, { status: 400 })
  }

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  try {
    const tx = new Transaction()
    tx.setSender(adminAddress)
    tx.setGasBudget(100_000_000)

    // initialize_staking_pool lives in the moonbags_stake module and takes the
    // moonbags_stake::Configuration object (frontend constant: stakeConfig).
    tx.moveCall({
      target: `${MOONBAGS_AIDA_CONTRACT.packageId}::moonbags_stake::initialize_staking_pool`,
      typeArguments: [tokenType],
      arguments: [
        tx.object(MOONBAGS_AIDA_CONTRACT.stakeConfig),
        tx.object(SUI_CLOCK),
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
      tokenType,
      error: ok ? undefined : JSON.stringify(result.effects?.status),
    })
  } catch (e: any) {
    console.error(`[init-staking-pool] ${tokenType} failed: ${e.message}`)
    return NextResponse.json({ success: false, tokenType, error: e.message }, { status: 500 })
  }
}
