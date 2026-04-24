import { NextResponse } from 'next/server'
import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import {
  MOONBAGS_AIDA_CONTRACT,
  AIDA_COIN_TYPE,
  AIDA_METADATA_ID,
} from '@/lib/contracts_aida'
import { CETUS_CONTRACT } from '@/lib/contracts'

// Manual migration trigger for pools the cetus-migrate-aida cron can't
// reach — specifically pools force-graduated via `early_complete_pool`,
// which emits PoolCompletedEventV2 but NOT PoolMigratingEvent (the event
// the cron watches). Calls the same init_cetus_aida_pool_v2 entry the
// cron would call, just dispatched by hand against an arbitrary pool.
//
// Body: { tokenType, aidaAmountMist?, tokenAmountMist?, aidaCoinId?, tokenCoinId? }
//
//   tokenType           required  e.g. "0x1a39eb90…::grillz::GRILLZ"
//   aidaAmountMist      optional  exact AIDA (MIST) to slice off
//   tokenAmountMist     optional  exact Token (atomic units) to slice off
//   aidaCoinId          optional  explicit Coin<AIDA> object to source from
//   tokenCoinId         optional  explicit Coin<Token> object to source from
//
// With amounts omitted, the route uses whole admin-owned coins; Cetus's
// fix_amount_a rebalances and refunds residuals back to admin (safe for
// the typical unblock case). Pass amounts + coin ids for deterministic
// initial price.
//
// Required env: ADMIN_WALLET_SECRET, CRON_SECRET (bearer auth).

export const dynamic = 'force-dynamic'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'
const MIGRATION_PKG = MOONBAGS_AIDA_CONTRACT.packageId
const BURN_PROOF_BYTES = [0x62, 0x75, 0x72, 0x6e, 0x5f, 0x70, 0x72, 0x6f, 0x6f, 0x66]

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
  const secret = process.env.ADMIN_WALLET_SECRET!
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

function fieldNameMatchesBurnProof(name: any): boolean {
  if (!name) return false
  if (Array.isArray(name)) {
    return name.length === BURN_PROOF_BYTES.length && name.every((b, i) => b === BURN_PROOF_BYTES[i])
  }
  if (typeof name === 'string') {
    const hex = name.startsWith('0x') ? name.slice(2) : name
    try { return Buffer.from(hex, 'hex').toString() === 'burn_proof' } catch { return name === 'burn_proof' }
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
    return null
  }
}

async function findAdminCoin(owner: string, coinType: string, minAmount?: bigint): Promise<{ id: string; balance: bigint } | null> {
  const res = await rpc('suix_getCoins', [owner, coinType, null, 200])
  const coins: Array<{ coinObjectId: string; balance: string }> = res?.data ?? []
  const mapped = coins.map(c => ({ id: c.coinObjectId, balance: BigInt(c.balance) }))
  if (minAmount !== undefined) {
    const candidates = mapped.filter(c => c.balance >= minAmount).sort((a, b) => (a.balance < b.balance ? -1 : a.balance > b.balance ? 1 : 0))
    return candidates[0] ?? null
  }
  const sorted = mapped.sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0))
  return sorted[0] ?? null
}

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.ADMIN_WALLET_SECRET) {
    return NextResponse.json({ error: 'ADMIN_WALLET_SECRET not configured' }, { status: 503 })
  }

  let body: any
  try { body = await req.json() } catch { body = {} }
  const tokenType: string | undefined = body?.tokenType
  if (!tokenType || !tokenType.includes('::')) {
    return NextResponse.json({ error: 'tokenType required (e.g. 0x<pkg>::grillz::GRILLZ)' }, { status: 400 })
  }

  const aidaAmount = body?.aidaAmountMist ? BigInt(body.aidaAmountMist) : undefined
  const tokenAmount = body?.tokenAmountMist ? BigInt(body.tokenAmountMist) : undefined

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const admin = keypair.getPublicKey().toSuiAddress()

  const poolId = await findBondingPoolId(tokenType)
  if (!poolId) {
    return NextResponse.json({ error: 'bonding pool not found in Configuration dynamic fields', tokenType }, { status: 404 })
  }

  if (await isAlreadyMigrated(poolId)) {
    return NextResponse.json({ ok: true, status: 'already-migrated', poolId, tokenType })
  }

  const aidaCoin = body?.aidaCoinId
    ? { id: body.aidaCoinId as string, balance: 0n }
    : await findAdminCoin(admin, AIDA_COIN_TYPE, aidaAmount)
  const tokenCoin = body?.tokenCoinId
    ? { id: body.tokenCoinId as string, balance: 0n }
    : await findAdminCoin(admin, tokenType, tokenAmount)

  if (!aidaCoin || !tokenCoin) {
    return NextResponse.json({
      error: 'admin wallet has no suitable coins',
      aidaCoinFound: !!aidaCoin,
      tokenCoinFound: !!tokenCoin,
      admin,
    }, { status: 409 })
  }

  let metadataObjId: string
  try {
    const meta = await rpc('suix_getCoinMetadata', [tokenType])
    if (!meta?.id) throw new Error('CoinMetadata missing id')
    metadataObjId = meta.id
  } catch (e: any) {
    return NextResponse.json({ error: `CoinMetadata lookup failed: ${e.message}` }, { status: 502 })
  }

  const tx = new Transaction()
  tx.setSender(admin)
  tx.setGasBudget(500_000_000)

  const aidaArg = aidaAmount !== undefined
    ? tx.splitCoins(tx.object(aidaCoin.id), [tx.pure.u64(aidaAmount)])[0]
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
    return NextResponse.json({
      ok,
      status: ok ? 'migrated' : 'error',
      digest: result.digest,
      poolId,
      tokenType,
      admin,
      effectsStatus: result.effects?.status,
    }, { status: ok ? 200 : 502 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message, admin, poolId, tokenType }, { status: 500 })
  }
}
