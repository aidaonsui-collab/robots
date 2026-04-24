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
// Two event paths handled:
//
//   1. PoolMigratingEvent — emitted by `transfer_pool` on natural
//      graduation (buy fills the curve). Event carries the exact
//      sui_amount + token_amount dumped to admin, so migrate() slices
//      those exact amounts out of admin's coins (preserves the
//      deterministic initial Cetus price).
//
//   2. PoolCompletedEventV2 — emitted by BOTH `transfer_pool` (natural)
//      AND `early_complete_pool` (admin force-graduation gated by
//      ThresholdConfig). The force-graduation path does NOT emit
//      PoolMigratingEvent, so pools created that way were invisible to
//      this cron before this change. The second loop picks them up:
//      idempotency-checks the pool (burn_proof dynamic field present?),
//      and if not yet migrated, passes whole admin-owned coins —
//      Cetus's fix_amount_a rebalances and refunds residuals back to
//      admin.
//
// Both loops converge on the same migrate() and share the burn_proof
// dynamic-field idempotency check, so re-running after a successful
// migration is a no-op for either event type.
//
// Required env:
//   ADMIN_WALLET_SECRET   — admin keypair (same as distribute-fees cron)
//   CRON_SECRET           — optional Bearer auth

export const dynamic = 'force-dynamic'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

const MIGRATION_PKG = MOONBAGS_AIDA_CONTRACT.packageId
// Events are anchored to the original V2 publish id forever.
const MIGRATING_EVENT_TYPE = `${MOONBAGS_AIDA_V2_ORIGINAL_PKG}::moonbags::PoolMigratingEvent`
const COMPLETED_EVENT_TYPE = `${MOONBAGS_AIDA_V2_ORIGINAL_PKG}::moonbags::PoolCompletedEventV2`

// Independent cursors so the two loops can advance without blocking.
const KV_CURSOR_KEY_MIGRATING = 'cetus-migrate-aida:cursor'
const KV_CURSOR_KEY_COMPLETED = 'cetus-migrate-aida:cursor:completed'

// Don't attempt migration on events older than this — avoids replaying
// ancient graduations on first deploy of a new cursor.
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000

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

type EventSource = 'migrating' | 'completed'

interface PendingMigration {
  tokenType: string
  // Exact amounts when sourced from PoolMigratingEvent; undefined when
  // sourced from PoolCompletedEventV2 (force-graduation has no amounts
  // in the event — migrate() falls back to whole-coin mode).
  suiAmount?: bigint
  tokenAmount?: bigint
  poolEventTs: number
  eventDigest: string
  source: EventSource
}

async function fetchPending(eventType: string, source: EventSource, cursor: any): Promise<{ pending: PendingMigration[]; nextCursor: any; hasNextPage: boolean }> {
  // Ascending (descending=false) so we process oldest un-handled events first.
  const data = await rpc('suix_queryEvents', [
    { MoveEventType: eventType },
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

    const poolEventTs = Number(pj.ts ?? e.timestampMs ?? 0)
    if (poolEventTs && now - poolEventTs > MAX_EVENT_AGE_MS) continue

    pending.push({
      tokenType,
      suiAmount: source === 'migrating' ? BigInt(pj.sui_amount ?? 0) : undefined,
      tokenAmount: source === 'migrating' ? BigInt(pj.token_amount ?? 0) : undefined,
      poolEventTs,
      eventDigest: e.id?.txDigest || '',
      source,
    })
  }

  return {
    pending,
    nextCursor: data?.nextCursor ?? null,
    hasNextPage: !!data?.hasNextPage,
  }
}

// burn_proof dynamic field detection. The field key is `b"burn_proof"`
// stored via dynamic_object_field::add; Sui's RPC wraps it in
// Wrapper<vector<u8>> and the concrete f.name.value shape varies
// across RPC versions — probe all three shapes.
function fieldNameMatchesBurnProof(name: any): boolean {
  const target = 'burn_proof'
  const targetBytes = [0x62, 0x75, 0x72, 0x6e, 0x5f, 0x70, 0x72, 0x6f, 0x6f, 0x66]
  if (!name) return false
  if (Array.isArray(name)) {
    return name.length === targetBytes.length && name.every((b, i) => b === targetBytes[i])
  }
  if (typeof name === 'string') {
    const hex = name.startsWith('0x') ? name.slice(2) : name
    try { return Buffer.from(hex, 'hex').toString() === target } catch { return name === target }
  }
  if (typeof name === 'object') {
    if ('name' in name) return fieldNameMatchesBurnProof((name as any).name)
    if ('value' in name) return fieldNameMatchesBurnProof((name as any).value)
  }
  return false
}

async function isAlreadyMigrated(poolId: string): Promise<boolean> {
  let cursor: any = null
  for (let page = 0; page < 10; page++) {
    let list: any
    try { list = await rpc('suix_getDynamicFields', [poolId, cursor, 50]) } catch { return false }
    for (const f of list?.data ?? []) {
      if (fieldNameMatchesBurnProof(f?.name?.value)) return true
    }
    if (!list?.hasNextPage || !list?.nextCursor) break
    cursor = list.nextCursor
  }
  return false
}

async function findBondingPoolId(tokenType: string): Promise<string | null> {
  const tokenAddr = tokenType.replace(/^0x/, '').split('::')[0]
  try {
    const dyn = await rpc('suix_getDynamicFieldObject', [
      MOONBAGS_AIDA_CONTRACT.configuration,
      { type: '0x1::ascii::String', value: tokenAddr },
    ])
    return dyn?.data?.objectId ?? null
  } catch {
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

// minAmount-aware: if specified, prefers the smallest coin that still
// covers the amount (avoids splitting a giant coin when a small one
// matches). If omitted, returns the largest available coin.
async function findAdminCoin(owner: string, coinType: string, minAmount?: bigint): Promise<{ id: string; balance: bigint } | null> {
  const res = await rpc('suix_getCoins', [owner, coinType, null, 200])
  const coins: Array<{ coinObjectId: string; balance: string }> = res?.data ?? []
  const mapped = coins.map(c => ({ id: c.coinObjectId, balance: BigInt(c.balance) }))
  if (minAmount !== undefined) {
    const candidates = mapped
      .filter(c => c.balance >= minAmount)
      .sort((a, b) => (a.balance < b.balance ? -1 : a.balance > b.balance ? 1 : 0))
    return candidates[0] ?? null
  }
  const sorted = mapped.sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0))
  return sorted[0] ?? null
}

interface MigrationResult {
  tokenType: string
  source: EventSource
  status: 'migrated' | 'already-migrated' | 'skipped:no-coin' | 'error' | 'no-pool'
  digest?: string
  error?: string
}

async function migrate(pending: PendingMigration, client: SuiClient, keypair: Ed25519Keypair): Promise<MigrationResult> {
  const admin = keypair.getPublicKey().toSuiAddress()
  const { tokenType, suiAmount, tokenAmount, source } = pending

  const poolId = await findBondingPoolId(tokenType)
  if (!poolId) {
    return { tokenType, source, status: 'no-pool', error: 'bonding pool not found in Configuration dynamic fields' }
  }

  if (await isAlreadyMigrated(poolId)) {
    return { tokenType, source, status: 'already-migrated' }
  }

  const aidaCoin = await findAdminCoin(admin, AIDA_COIN_TYPE, suiAmount)
  const tokenCoin = await findAdminCoin(admin, tokenType, tokenAmount)
  if (!aidaCoin || !tokenCoin) {
    return {
      tokenType,
      source,
      status: 'skipped:no-coin',
      error: `aidaCoin=${!!aidaCoin} tokenCoin=${!!tokenCoin} suiAmount=${suiAmount ?? 'whole-coin'} tokenAmount=${tokenAmount ?? 'whole-coin'}`,
    }
  }

  let metadataObjId: string
  try {
    const meta = await rpc('suix_getCoinMetadata', [tokenType])
    metadataObjId = meta?.id
    if (!metadataObjId) throw new Error('CoinMetadata missing id')
  } catch (e: any) {
    return { tokenType, source, status: 'error', error: `CoinMetadata lookup failed: ${e.message}` }
  }

  const tx = new Transaction()
  tx.setSender(admin)
  tx.setGasBudget(500_000_000)

  // Exact-amount slicing when we know what transfer_pool dumped
  // (PoolMigratingEvent); otherwise whole admin coin (PoolCompletedEventV2
  // force-graduation path — no amounts available, Cetus rebalances and
  // refunds residuals).
  const aidaArg = suiAmount !== undefined
    ? tx.splitCoins(tx.object(aidaCoin.id), [tx.pure.u64(suiAmount)])[0]
    : tx.object(aidaCoin.id)
  const tokenArg = tokenAmount !== undefined
    ? tx.splitCoins(tx.object(tokenCoin.id), [tx.pure.u64(tokenAmount)])[0]
    : tx.object(tokenCoin.id)

  tx.moveCall({
    target: `${MIGRATION_PKG}::moonbags::init_cetus_aida_pool_v2`,
    typeArguments: [tokenType],
    arguments: [
      tx.pure.address(admin),
      tx.object(MOONBAGS_AIDA_CONTRACT.configuration),
      aidaArg,
      tokenArg,
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
      source,
      status: ok ? 'migrated' : 'error',
      digest: result.digest,
      error: ok ? undefined : JSON.stringify(result.effects?.status),
    }
  } catch (e: any) {
    return { tokenType, source, status: 'error', error: e.message }
  }
}

async function runLoop(
  eventType: string,
  source: EventSource,
  cursorKey: string,
  client: SuiClient,
  keypair: Ed25519Keypair,
  processedPools: Set<string>,
): Promise<{ results: MigrationResult[]; scanned: number }> {
  const results: MigrationResult[] = []
  let scanned = 0

  let cursor: any = null
  try { cursor = (await kv.get<any>(cursorKey)) ?? null } catch { /* KV optional */ }
  let lastSeenCursor: any = cursor

  for (let page = 0; page < 10; page++) {
    const { pending, nextCursor, hasNextPage } = await fetchPending(eventType, source, cursor)
    scanned += pending.length

    for (const p of pending) {
      // Natural graduation emits BOTH event types. If loop 1 already
      // migrated this pool in the current invocation, short-circuit
      // here to skip a redundant burn_proof lookup. Across invocations
      // the burn_proof check inside migrate() catches it anyway.
      if (processedPools.has(p.tokenType)) {
        results.push({ tokenType: p.tokenType, source, status: 'already-migrated' })
        continue
      }
      const r = await migrate(p, client, keypair)
      results.push(r)
      processedPools.add(p.tokenType)
    }

    if (nextCursor) lastSeenCursor = nextCursor
    if (!hasNextPage || !nextCursor) break
    cursor = nextCursor
  }

  try { if (lastSeenCursor) await kv.set(cursorKey, lastSeenCursor) } catch { /* non-fatal */ }
  return { results, scanned }
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
  const processedPools = new Set<string>()
  const allResults: MigrationResult[] = []
  let totalScanned = 0

  try {
    // Natural graduations first — they have exact amounts, so running
    // them before the completed-event loop ensures the deterministic
    // price path wins when both events exist for the same pool.
    const migratingRun = await runLoop(
      MIGRATING_EVENT_TYPE, 'migrating', KV_CURSOR_KEY_MIGRATING,
      client, keypair, processedPools,
    )
    allResults.push(...migratingRun.results)
    totalScanned += migratingRun.scanned

    // Force-graduations (and natural graduations re-observed). Pools
    // already handled in the first loop are short-circuited by the
    // processedPools set; anything else that's already migrated in a
    // prior invocation is caught by the burn_proof check.
    const completedRun = await runLoop(
      COMPLETED_EVENT_TYPE, 'completed', KV_CURSOR_KEY_COMPLETED,
      client, keypair, processedPools,
    )
    allResults.push(...completedRun.results)
    totalScanned += completedRun.scanned
  } catch (e: any) {
    return NextResponse.json({ error: e.message, results: allResults, scanned: totalScanned }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    scanned: totalScanned,
    migrated: allResults.filter(r => r.status === 'migrated').length,
    alreadyMigrated: allResults.filter(r => r.status === 'already-migrated').length,
    skippedNoCoin: allResults.filter(r => r.status === 'skipped:no-coin').length,
    errors: allResults.filter(r => r.status === 'error').length,
    noPool: allResults.filter(r => r.status === 'no-pool').length,
    results: allResults,
  })
}
