import { NextResponse } from 'next/server'
import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { MOONBAGS_AIDA_CONTRACT, AIDA_COIN_TYPE, MOONBAGS_AIDA_V2_ORIGINAL_PKG } from '@/lib/contracts_aida'

// Periodically distribute accrued trading fees from every active AIDA-paired
// bonding-curve pool. The Move function `withdraw_fee_bonding_curve<Token, AIDA>`
// is public and stateless — anyone can call it; the contract routes the shares
// (40% platform / 30% creator / ~0% meme stakers / ~30% AIDA stakers) internally.
//
// Without this cron, fees pile up in each pool's `fee_recipient: Coin<AIDA>`
// forever and no creator or staker sees a payout.

export const dynamic = 'force-dynamic'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

// Skip pools whose fee balance is below this — not worth the gas.
// AIDA has 9 decimals, so 1e9 mist = 1 AIDA.
const MIN_DISTRIBUTE_MIST = 1_000_000_000n

async function rpc(method: string, params: any[]) {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const j = await res.json()
  if (j.error) throw new Error(j.error.message)
  return j.result
}

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

// Fetch every pool that emitted CreatedEventV2 under the AIDA package.
// Returns [{ poolId, tokenType }].
async function fetchAidaPools(): Promise<Array<{ poolId: string, tokenType: string }>> {
  const eventType = `${MOONBAGS_AIDA_V2_ORIGINAL_PKG}::moonbags::CreatedEventV2`
  const out: Array<{ poolId: string, tokenType: string }> = []
  let cursor: any = null

  for (let page = 0; page < 10; page++) {
    const data = await rpc('suix_queryEvents', [
      { MoveEventType: eventType }, cursor, 100, true,
    ])
    const events: any[] = data?.data || []
    for (const e of events) {
      const pj = e.parsedJson
      if (!pj?.pool_id) continue
      // Extract the token type from the event's MoveEventType arg list,
      // or from the pool's parsed fields if present.
      const tokenType = pj.token_address?.startsWith('0x')
        ? pj.token_address
        : pj.token_address ? `0x${pj.token_address}` : null
      if (tokenType) {
        out.push({ poolId: pj.pool_id, tokenType })
      }
    }
    if (!data?.hasNextPage) break
    cursor = data.nextCursor
  }
  return out
}

// Read a pool object and return the fee_recipient balance and completion flag.
async function getPoolFeeState(poolId: string): Promise<{ feeMist: bigint, isCompleted: boolean }> {
  const obj = await rpc('sui_getObject', [poolId, { showContent: true }])
  const f = obj?.data?.content?.fields
  if (!f) return { feeMist: 0n, isCompleted: true }
  const feeMist = BigInt(f.fee_recipient?.fields?.balance || '0')
  const isCompleted = !!f.is_completed
  return { feeMist, isCompleted }
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

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()
  const results: Array<{ poolId: string, tokenType: string, feeMist: string, status: string, digest?: string, error?: string }> = []

  try {
    const pools = await fetchAidaPools()
    console.log(`[distribute-fees] scanning ${pools.length} AIDA pools`)

    for (const { poolId, tokenType } of pools) {
      try {
        const { feeMist, isCompleted } = await getPoolFeeState(poolId)

        if (isCompleted) {
          results.push({ poolId, tokenType, feeMist: feeMist.toString(), status: 'skipped:completed' })
          continue
        }
        if (feeMist < MIN_DISTRIBUTE_MIST) {
          results.push({ poolId, tokenType, feeMist: feeMist.toString(), status: 'skipped:below-threshold' })
          continue
        }

        const tx = new Transaction()
        tx.setSender(adminAddress)
        tx.setGasBudget(100_000_000)

        tx.moveCall({
          target: `${MOONBAGS_AIDA_CONTRACT.packageId}::moonbags::withdraw_fee_bonding_curve`,
          typeArguments: [tokenType, AIDA_COIN_TYPE],
          arguments: [
            tx.object(MOONBAGS_AIDA_CONTRACT.configuration),
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
        results.push({
          poolId,
          tokenType,
          feeMist: feeMist.toString(),
          status: ok ? 'distributed' : 'failed',
          digest: result.digest,
          error: ok ? undefined : JSON.stringify(result.effects?.status),
        })
      } catch (e: any) {
        console.error(`[distribute-fees] pool ${poolId} failed: ${e.message}`)
        results.push({ poolId, tokenType, feeMist: '0', status: 'error', error: e.message })
      }
    }
  } catch (e: any) {
    console.error(`[distribute-fees] fatal:`, e.message)
    return NextResponse.json({ error: e.message, results }, { status: 500 })
  }

  const summary = {
    scanned: results.length,
    distributed: results.filter(r => r.status === 'distributed').length,
    skipped: results.filter(r => r.status.startsWith('skipped')).length,
    failed: results.filter(r => r.status === 'failed' || r.status === 'error').length,
  }

  return NextResponse.json({
    ...summary,
    results,
    timestamp: new Date().toISOString(),
  })
}
