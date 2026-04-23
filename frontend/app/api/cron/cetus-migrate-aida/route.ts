import { NextResponse } from 'next/server'
import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import {
  MOONBAGS_AIDA_CONTRACT,
  MOONBAGS_AIDA_V2_ORIGINAL_PKG,
  AIDA_COIN_TYPE,
  AIDA_METADATA_ID,
} from '@/lib/contracts_aida'
import { CETUS_CONTRACT } from '@/lib/contracts'
import { kv } from '@vercel/kv'

// Cetus auto-migration cron for AIDA-pair bonding pools.
//
// Flow:
//   1. Bonding curve fills → transfer_pool dumps real + remain token reserves
//      + real_sui (AIDA) reserves to the admin wallet and emits
//      PoolMigratingEvent + PoolCompletedEventV2.
//   2. This cron polls for PoolMigratingEvents on the AIDA V2 original-id
//      (event types are pinned to original-id regardless of which upgrade
//      emitted them). For each event it hasn't processed yet, it picks up
//      the dumped coins and calls init_cetus_aida_pool_v2 on the latest
//      upgraded package, which creates the Cetus CLMM pool, burns the LP
//      position via lp_burn, and records a BURN_PROOF_FIELD dynamic field
//      on the bonding pool.
//
// The cron is idempotent: it skips any pool that already has a burn_proof
// dynamic field, so re-running it after a successful migration is a no-op.
// Event dedup is kept in Vercel KV as a belt-and-suspenders check against
// transient failures that leave no burn_proof but partially consumed gas.
//
// Required env:
//   ADMIN_WALLET_SECRET   — the admin wallet's private key (same as the
//                            distribute-fees cron). Suiprivkey1…-style
//                            encoding, raw base64, or 0x-hex.
//   CRON_SECRET           — (optional) Bearer token Vercel Cron sends on
//                            the Authorization header.
//
// Cron schedule in vercel.json — every 30s is enough; graduations aren't
// frequent and each call that finds no pending events is a cheap no-op.

export const dynamic = 'force-dynamic'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

// The packageId move calls target — latest upgrade with init_cetus_aida_pool_v2.
const MIGRATION_PKG = MOONBAGS_AIDA_CONTRACT.packageId
// Events are anchored to the original V2 publish id forever.
const EVENT_TYPE = `${MOONBAGS_AIDA_V2_ORIGINAL_PKG}::moonbags::PoolMigratingEvent`

// Vercel KV cursor so repeat invocations skip already-handled events.
const KV_CURSOR_KEY = 'cetus-migrate-aida:cursor'

// Don't attempt migration on events older than this. Protects against
// replaying ancient graduations when the cron is first deployed into a
// pool with years of history.
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000 // 24h

async function rpc<T = any>(method: string, params: any[]): Promise<T> {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const j = await res.json()
  if (j.error) throw new Error(`${method}: ${j.error.message}`)
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

interface PendingMigration {
  tokenType: string          // fully-qualified `0xaddr::mod::TYPE`
  tokenTypeRaw: string        // as emitted by the event (no leading 0x)
  suiAmount: bigint           // AIDA dumped to admin
  tokenAmount: bigint         // Token dumped to admin
  poolEventTs: number         // event timestamp (ms)
  eventDigest: string         // tx digest that emitted PoolMigratingEvent
}

async function fetchPendingMigrations(cursor: any): Promise<{ pending: PendingMigration[]; nextCursor: any; hasNextPage: boolean }> {
  // Descending=false so we see the oldest un-processed events first.
  // Vercel KV stores the cursor as the last seen event id.
  const data = await rpc('suix_queryEvents', [
    { MoveEventType: EVENT_TYPE },
    cursor,
    50,
    false,
  ])
  const events: any[] = data?.data || []
  const pending: PendingMigration[] = []
  const now = Date.now()

  for (const e of events) {
    const pj = e.parsedJson || {}
    const tokenTypeRaw: string = pj.token_address || ''
    if (!tokenTypeRaw) continue
    const tokenType = tokenTypeRaw.startsWith('0x') ? tokenTypeRaw : `0x${tokenTypeRaw}`

    const suiAmount = BigInt(pj.sui_amount ?? 0)
    const tokenAmount = BigInt(pj.token_amount ?? 0)
    const poolEventTs = Number(pj.ts ?? e.timestampMs ?? 0)

    if (poolEventTs && now - poolEventTs > MAX_EVENT_AGE_MS) continue

    pending.push({
      tokenType,
      tokenTypeRaw,
      suiAmount,
      tokenAmount,
      poolEventTs,
      eventDigest: e.id?.txDigest || '',
    })
  }

  return {
    pending,
    nextCursor: data?.nextCursor ?? null,
    hasNextPage: !!data?.hasNextPage,
  }
}

// Check whether the bonding pool has the burn_proof dynamic field. Used
// both as the primary "already migrated" check and as the success signal
// after a migration tx lands.
//
// `BURN_PROOF_FIELD` in the contract is `b"burn_proof"` stored via
// `dynamic_object_field::add`. Sui's RPC wraps that key in
// `dynamic_object_field::Wrapper<vector<u8>>`, but the concrete shape of
// `f.name.value` varies across RPC versions (raw array, hex string, or
// `{name: [...]}`). Probe all three shapes instead of assuming one.
function fieldNameMatchesBurnProof(name: any): boolean {
  const target = 'burn_proof'
  const targetBytes = [0x62, 0x75, 0x72, 0x6e, 0x5f, 0x70, 0x72, 0x6f, 0x6f, 0x66]
  if (!name) return false
  // Shape A: raw byte array.
  if (Array.isArray(name)) {
    return name.length === targetBytes.length && name.every((b, i) => b === targetBytes[i])
  }
  // Shape B: hex string (with or without 0x prefix).
  if (typeof name === 'string') {
    const hex = name.startsWith('0x') ? name.slice(2) : name
    try {
      return Buffer.from(hex, 'hex').toString() === target
    } catch {
      return name === target
    }
  }
  // Shape C: nested wrapper `{name: [...]}` or `{value: [...]}`.
  if (typeof name === 'object') {
    if ('name' in name) return fieldNameMatchesBurnProof((name as any).name)
    if ('value' in name) return fieldNameMatchesBurnProof((name as any).value)
  }
  return false
}

async function isAlreadyMigrated(poolId: string): Promise<boolean> {
  // Iterate all dynamic fields on the bonding pool (paginated). The pool
  // only carries a handful of fields in practice, so one page usually
  // suffices — we still loop in case the admin has queued many.
  let cursor: any = null
  for (let page = 0; page < 10; page++) {
    let list: any
    try {
      list = await rpc('suix_getDynamicFields', [poolId, cursor, 50])
    } catch {
      return false
    }
    for (const f of list?.data ?? []) {
      if (fieldNameMatchesBurnProof(f?.name?.value)) return true
    }
    if (!list?.hasNextPage || !list?.nextCursor) break
    cursor = list.nextCursor
  }
  return false
}

// Find the bonding pool object id for a given token type by walking
// Configuration's dynamic fields. This matches the on-chain dynamic_field
// storage key — Token's type-name address.
async function findBondingPoolId(tokenType: string): Promise<string | null> {
  // The dynamic_field key Move uses is `type_name::get_address(&type_name::get<Token>())`
  // which equals the address portion of the coin type, ASCII-encoded.
  const tokenAddr = tokenType.replace(/^0x/, '').split('::')[0]
  try {
    const dyn = await rpc('suix_getDynamicFieldObject', [
      MOONBAGS_AIDA_CONTRACT.configuration,
      { type: '0x1::ascii::String', value: tokenAddr },
    ])
    return dyn?.data?.objectId ?? null
  } catch {
    // Fallback: iterate dynamic fields and match by objectType.
    let cursor: any = null
    for (let page = 0; page < 10; page++) {
      const list = await rpc('suix_getDynamicFields', [MOONBAGS_AIDA_CONTRACT.configuration, cursor, 50])
      for (const f of list?.data ?? []) {
        if (f.objectType?.includes(tokenType)) return f.objectId
      }
      if (!list?.hasNextPage || !list?.nextCursor) break
      cursor = list.nextCursor
    }
    return null
  }
}

// Find an admin-owned Coin<X> whose balance is at least `minAmount`. Prefer
// the object with balance CLOSEST to `minAmount` so we don't split a giant
// coin when a small one already matches. Returns `null` if nothing fits.
async function findAdminCoin(owner: string, coinType: string, minAmount: bigint): Promise<{ id: string; balance: bigint } | null> {
  const res = await rpc('suix_getCoins', [owner, coinType, null, 200])
  const coins: Array<{ coinObjectId: string; balance: string }> = res?.data ?? []
  const candidates = coins
    .map(c => ({ id: c.coinObjectId, balance: BigInt(c.balance) }))
    .filter(c => c.balance >= minAmount)
    .sort((a, b) => (a.balance < b.balance ? -1 : a.balance > b.balance ? 1 : 0))
  return candidates[0] ?? null
}

interface MigrationResult {
  tokenType: string
  status: 'migrated' | 'already-migrated' | 'skipped:no-coin' | 'error' | 'no-pool'
  digest?: string
  error?: string
}

async function migrate(pending: PendingMigration, client: SuiClient, keypair: Ed25519Keypair): Promise<MigrationResult> {
  const admin = keypair.getPublicKey().toSuiAddress()
  const { tokenType, suiAmount, tokenAmount } = pending

  const poolId = await findBondingPoolId(tokenType)
  if (!poolId) {
    return { tokenType, status: 'no-pool', error: 'bonding pool not found in Configuration dynamic fields' }
  }

  if (await isAlreadyMigrated(poolId)) {
    return { tokenType, status: 'already-migrated' }
  }

  // Find the dumped coins. The graduation tx creates coins with balances
  // equal to sui_amount + token_amount exactly, so those are our targets.
  // If the exact coins were consumed by another op, findAdminCoin will
  // fall back to the smallest coin that covers the amount.
  const aidaCoin = await findAdminCoin(admin, AIDA_COIN_TYPE, suiAmount)
  const tokenCoin = await findAdminCoin(admin, tokenType, tokenAmount)
  if (!aidaCoin || !tokenCoin) {
    return {
      tokenType,
      status: 'skipped:no-coin',
      error: `aidaCoin=${!!aidaCoin} tokenCoin=${!!tokenCoin} (sui_amount=${suiAmount}, token_amount=${tokenAmount})`,
    }
  }

  // Need the token's CoinMetadata<T> object — Cetus's create_pool_v2
  // requires it for ticker + decimals metadata.
  let metadataObjId: string
  try {
    const meta = await rpc('suix_getCoinMetadata', [tokenType])
    metadataObjId = meta?.id
    if (!metadataObjId) throw new Error('CoinMetadata missing id')
  } catch (e: any) {
    return { tokenType, status: 'error', error: `CoinMetadata lookup failed: ${e.message}` }
  }

  const tx = new Transaction()
  tx.setSender(admin)
  tx.setGasBudget(500_000_000)

  // Split exact-amount slices off the admin's whole coins so the remainder
  // stays in the wallet as change instead of getting swallowed by Cetus's
  // fix_amount_a rebalancing.
  const [aidaSlice] = tx.splitCoins(tx.object(aidaCoin.id), [tx.pure.u64(suiAmount)])
  const [tokenSlice] = tx.splitCoins(tx.object(tokenCoin.id), [tx.pure.u64(tokenAmount)])

  tx.moveCall({
    target: `${MIGRATION_PKG}::moonbags::init_cetus_aida_pool_v2`,
    typeArguments: [tokenType],
    arguments: [
      tx.pure.address(admin),
      tx.object(MOONBAGS_AIDA_CONTRACT.configuration),
      aidaSlice,
      tokenSlice,
      tx.object(CETUS_CONTRACT.burnManager),
      tx.object(CETUS_CONTRACT.pools),
      tx.object(CETUS_CONTRACT.globalConfig),
      tx.object(AIDA_METADATA_ID),
      tx.object(metadataObjId),
      tx.object(SUI_CLOCK),
    ],
  })

  try {
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true },
    })
    const ok = result.effects?.status?.status === 'success'
    return {
      tokenType,
      status: ok ? 'migrated' : 'error',
      digest: result.digest,
      error: ok ? undefined : JSON.stringify(result.effects?.status),
    }
  } catch (e: any) {
    return { tokenType, status: 'error', error: e.message }
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

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()

  let cursor: any = null
  try {
    cursor = (await kv.get<any>(KV_CURSOR_KEY)) ?? null
  } catch { /* KV optional; first run starts from beginning */ }

  const results: MigrationResult[] = []
  let scanned = 0
  let lastSeenCursor: any = cursor

  try {
    // Iterate forward until the node says there's nothing newer. Cap at 10
    // pages per invocation so a huge backlog doesn't blow the Vercel
    // function timeout.
    for (let page = 0; page < 10; page++) {
      const { pending, nextCursor, hasNextPage } = await fetchPendingMigrations(cursor)
      scanned += pending.length
      for (const p of pending) {
        const r = await migrate(p, client, keypair)
        results.push(r)
      }
      if (nextCursor) lastSeenCursor = nextCursor
      if (!hasNextPage || !nextCursor) break
      cursor = nextCursor
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message, results, scanned }, { status: 500 })
  }

  try {
    if (lastSeenCursor) await kv.set(KV_CURSOR_KEY, lastSeenCursor)
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ok: true,
    scanned,
    migrated: results.filter(r => r.status === 'migrated').length,
    alreadyMigrated: results.filter(r => r.status === 'already-migrated').length,
    errors: results.filter(r => r.status === 'error').length,
    results,
  })
}
