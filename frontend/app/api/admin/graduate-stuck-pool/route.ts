import { NextResponse } from 'next/server'
import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { MOONBAGS_AIDA_CONTRACT, AIDA_COIN_TYPE } from '@/lib/contracts_aida'

// One-time admin route to force-graduate a stuck AIDA-paired bonding pool.
//
// When a curve reaches ~99.9999% but no user-facing buy can drain the final
// dust (because the contract caps actual_amount_out to the remaining supply,
// and that cap falls below the buyer's min_tokens_out slippage guard), the
// pool gets stuck. This route sweeps it by submitting a buy with
// min_tokens_out = 1, which trivially passes the slippage assert, letting
// the contract cap the output, auto-call transfer_pool, and emit
// PoolMigratingEvent.
//
// Usage:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://robots-teal.vercel.app/api/admin/graduate-stuck-pool?poolId=0x8280...&token=0x9b23...::hero::HERO"
//
// Amount: the admin sends 10 AIDA by default (the contract will cap to
// whatever's actually needed and refund the remainder). Override with
// ?amountAida=<number>.

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
  const poolId = url.searchParams.get('poolId')
  const tokenType = url.searchParams.get('token')
  const amountAida = Number(url.searchParams.get('amountAida') || '10')

  if (!poolId || !poolId.startsWith('0x')) {
    return NextResponse.json({ error: 'Missing ?poolId=0x...' }, { status: 400 })
  }
  if (!tokenType || !tokenType.includes('::')) {
    return NextResponse.json({ error: 'Missing ?token=<coinType>' }, { status: 400 })
  }
  if (!isFinite(amountAida) || amountAida <= 0) {
    return NextResponse.json({ error: 'Invalid amountAida' }, { status: 400 })
  }

  const amountInMist = BigInt(Math.floor(amountAida * 1e9))
  // Contract charges 2% fee — send 103% to cover fee + buffer, contract caps the rest.
  const coinAmount = amountInMist * 103n / 100n

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  try {
    const { data: aidaCoins } = await client.getCoins({ owner: adminAddress, coinType: AIDA_COIN_TYPE })
    if (!aidaCoins.length) {
      return NextResponse.json({ error: 'Admin wallet has no AIDA' }, { status: 503 })
    }

    const tx = new Transaction()
    tx.setSender(adminAddress)
    tx.setGasBudget(100_000_000)

    const base = tx.object(aidaCoins[0].coinObjectId)
    for (let i = 1; i < aidaCoins.length; i++) {
      tx.moveCall({
        target: '0x2::pay::join',
        typeArguments: [AIDA_COIN_TYPE],
        arguments: [base, tx.object(aidaCoins[i].coinObjectId)],
      })
    }
    const [payCoin] = tx.splitCoins(base, [tx.pure.u64(coinAmount)])

    tx.moveCall({
      target: `${MOONBAGS_AIDA_CONTRACT.packageId}::moonbags::buy_exact_in_with_lock`,
      typeArguments: [tokenType],
      arguments: [
        tx.object(MOONBAGS_AIDA_CONTRACT.configuration),
        tx.object(MOONBAGS_AIDA_CONTRACT.lockConfig),
        payCoin,
        tx.pure.u64(amountInMist),
        tx.pure.u64(1),                  // min_tokens_out = 1 (accept anything nonzero)
        tx.object(SUI_CLOCK),
      ],
    })

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showEvents: true },
    })

    const ok = result.effects?.status?.status === 'success'
    const migratingEvent = result.events?.find((e: any) => e.type?.includes('PoolMigratingEvent'))

    return NextResponse.json({
      success: ok,
      digest: result.digest,
      poolId,
      tokenType,
      migrated: !!migratingEvent,
      migratingEvent: migratingEvent?.parsedJson,
      hint: migratingEvent
        ? 'Curl /api/cron/graduate to create the Momentum pool.'
        : 'Buy succeeded but pool did not graduate — there may still be HERO reserves left. Retry with a larger amountAida.',
      error: ok ? undefined : JSON.stringify(result.effects?.status),
    })
  } catch (e: any) {
    console.error(`[graduate-stuck-pool] failed: ${e.message}`)
    return NextResponse.json({ success: false, poolId, tokenType, error: e.message }, { status: 500 })
  }
}
