import { NextResponse } from 'next/server'
import { addLiquidityToPool } from '@/lib/momentum'
import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

export const dynamic = 'force-dynamic'

const RPC = 'https://fullnode.mainnet.sui.io'
const SUI_TYPE = '0x2::sui::SUI'
const SUI_DECIMALS = 9
const PLATFORM_FEE_BPS = 200n
const FEE_DENOMINATOR = 10000n

// Momentum mainnet constants
const MMT_PKG = '0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1'
const MMT_VERSION = '0x2375a0b1ec12010aaea3b2545acfa2ad34cfbba03ce4b59f4c39e1e25eed1b2a'
const CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

const PRESALE_ALL_PACKAGES: readonly string[] = [
  '0x4c9f2fe6a524873adea66ff6f31d6caba0df10d10ffd8b28e99d0b8e26eabc76', // v8
  '0xd35d85f2347cb6b3a913839d067f48852b824a1f18e8910aea7bf1ff1f944933', // v6
  '0x10bc92bae029c96b484447fb367fc38d7207580d79049cdf22d7f2c768887283', // v5
  '0xfd93d109c5045a5095d895af332fd377a44114e775e8d48109f00b483cce2b1e', // v4
  '0x7418205d6fb7c9493dcb7fdd12cea7de92737560fef1c741016bd151d7558c0f', // v3
  '0x98c139f5735c34c101121a1542ebf0f76697391571e8bc62e59cdf866afabb2c', // v2
  '0xca1a16f85e69d0c990cd393ecfc23c0ed375a55c5b125a18828157b8692c0225', // v1
] as const

async function rpc(method: string, params: any[]) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const j = await res.json()
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error))
  return j.result
}

function normalizeTokenType(t: string): string {
  if (!t) return t
  const parts = t.split('::')
  if (parts.length >= 3 && !parts[0].startsWith('0x')) parts[0] = `0x${parts[0]}`
  return parts.join('::')
}

/** Pad token type address to full 64-char hex — prevents MVR resolver misidentifying it */
function padTokenType(t: string): string {
  const parts = t.split('::')
  if (parts.length >= 3) {
    const addr = parts[0].startsWith('0x') ? parts[0] : `0x${parts[0]}`
    parts[0] = `0x${addr.slice(2).padStart(64, '0')}`
  }
  return parts.join('::')
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

/**
 * POST /api/admin/fix-pool
 *
 * Fixes a one-sided Momentum pool (tokens deposited, 0 SUI).
 *
 * Steps:
 *   1. Resolve tokenType + suiAmount from PresaleMigratingEvent
 *   2. Read pool sqrt_price → derive correct price (SUI/token = X/Y)
 *   3. Scan admin wallet for existing Position NFTs in this pool
 *   4. If found: collect fees + remove liquidity + close position (raw Move calls, no MVR)
 *   5. Wait 4s for RPC indexer
 *   6. Add fresh two-sided liquidity via addLiquidityToPool
 *
 * Body:
 *   poolId:    string  — Momentum pool object ID
 *   presaleId: string  — presale object ID to derive suiAmount + tokenType
 *
 * Auth: requires CRON_SECRET in Authorization header.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.ADMIN_WALLET_SECRET) {
    return NextResponse.json({ error: 'ADMIN_WALLET_SECRET not configured' }, { status: 503 })
  }
  if (!process.env.MOMENTUM_PACKAGE_ID) {
    return NextResponse.json({ error: 'MOMENTUM_PACKAGE_ID not configured' }, { status: 503 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { poolId, presaleId } = body
  if (!poolId || !presaleId) {
    return NextResponse.json({ error: 'poolId and presaleId are required' }, { status: 400 })
  }

  const client = new SuiClient({ url: RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  // ── Step 1: Resolve tokenType + suiAmount ────────────────────────────────────
  let tokenType = ''
  let suiAmountMist = 0n
  const tokenDecimals = 6

  for (const pkg of PRESALE_ALL_PACKAGES) {
    try {
      const result = await rpc('suix_queryEvents', [
        { MoveEventType: `${pkg}::presale::PresaleMigratingEvent` },
        null, 50, true,
      ])
      const found = (result?.data || []).find((ev: any) => ev.parsedJson?.presale_id === presaleId)
      if (found) {
        const p = found.parsedJson
        tokenType = normalizeTokenType(p.token_address || '')
        const rawSui = BigInt(p.sui_amount || '0')
        suiAmountMist = rawSui - rawSui * PLATFORM_FEE_BPS / FEE_DENOMINATOR
        break
      }
    } catch { /* try next package */ }
  }

  if (!tokenType) {
    return NextResponse.json({
      error: `No PresaleMigratingEvent found for presale ${presaleId}`,
    }, { status: 404 })
  }
  if (suiAmountMist <= 0n) {
    return NextResponse.json({ error: 'sui_amount in presale event is 0' }, { status: 400 })
  }

  // ── Step 2: Read pool sqrt_price → compute price (SUI/token, X/Y) ────────────
  const poolRes = await client.getObject({ id: poolId, options: { showContent: true } })
  const poolFields = (poolRes.data as any)?.content?.fields
  if (!poolFields) {
    return NextResponse.json({ error: `Pool ${poolId} not found` }, { status: 404 })
  }

  const sqrtPriceRaw = BigInt(poolFields.sqrt_price || '0')
  if (sqrtPriceRaw === 0n) {
    return NextResponse.json({ error: `Pool ${poolId} has sqrt_price = 0` }, { status: 400 })
  }
  const reserveX = BigInt(poolFields.reserve_x ?? poolFields.token_x_reserve ?? 0)
  const poolLiquidity = BigInt(poolFields.liquidity ?? '0')

  // Only skip if the pool has both SUI AND active liquidity at the current tick.
  // reserve_x > 0 alone is not enough — an out-of-range position has SUI but
  // pool.liquidity = 0, which means all swaps fail (aggregators see "no liquidity").
  if (reserveX > 0n && poolLiquidity > 0n) {
    return NextResponse.json({
      success: true,
      message: 'Pool already has SUI and active liquidity — no fix needed',
      poolId,
      reserveX: reserveX.toString(),
      poolLiquidity: poolLiquidity.toString(),
    })
  }

  if (reserveX > 0n && poolLiquidity === 0n) {
    console.log(`[fix-pool] Pool has SUI (${Number(reserveX) / 1e9} SUI) but pool.liquidity=0 — position is out of range, re-fixing`)
  }

  // Momentum stores sqrtPrice as sqrt(Y/X) * 2^64.
  // To get X/Y (SUI per token) price as expected by priceToSqrtPriceX64:
  //   price = 10^(tokenDecimals - SUI_DECIMALS) / sqrtPriceFloat^2
  const sqrtPriceFloat = Number(sqrtPriceRaw) / Math.pow(2, 64)
  const price = Math.pow(10, tokenDecimals - SUI_DECIMALS) / (sqrtPriceFloat * sqrtPriceFloat)

  console.log(`[fix-pool] pool ${poolId}: sqrtPriceFloat=${sqrtPriceFloat.toExponential(3)} price=${price.toExponential(3)} SUI/token`)

  // ── Step 3: Balance check ─────────────────────────────────────────────────────
  const balance = await client.getBalance({ owner: adminAddress })
  const availableMist = BigInt(balance.totalBalance)
  const GAS_BUFFER = BigInt(600_000_000) // 0.6 SUI for up to 2 TXs
  if (availableMist < suiAmountMist + GAS_BUFFER) {
    return NextResponse.json({
      error: `Admin wallet has ${Number(availableMist) / 1e9} SUI but needs ${Number(suiAmountMist + GAS_BUFFER) / 1e9} SUI`,
      walletSui: Number(availableMist) / 1e9,
      neededSui: Number(suiAmountMist + GAS_BUFFER) / 1e9,
    }, { status: 400 })
  }

  // ── Step 4: Scan for ALL existing admin positions in this pool ───────────────
  // There may be multiple out-of-range positions from previous fix attempts
  // (e.g. one with SUI-only, one with TOKEN-only). We must close ALL of them
  // so all tokens are recovered before opening one properly-ranged position.
  const normTokenType = padTokenType(tokenType)
  const existingPositions: Array<{ id: string; liquidity: bigint }> = []
  let closedDigest: string | null = null

  {
    let cursor: string | null = null
    for (let page = 0; page < 10; page++) {
      const params: any[] = [adminAddress, { options: { showType: true, showContent: true } }]
      if (cursor) params.push(cursor)
      const ownedResult = await rpc('suix_getOwnedObjects', params)
      for (const obj of (ownedResult?.data || [])) {
        const objType: string = obj.data?.type || ''
        if (objType.includes('::position::Position') && obj.data?.content?.fields?.pool_id === poolId) {
          existingPositions.push({
            id: obj.data.objectId,
            liquidity: BigInt(obj.data.content.fields?.liquidity || '0'),
          })
        }
      }
      cursor = ownedResult?.nextCursor || null
      if (!cursor) break
    }
  }

  // ── Step 5: Close ALL existing positions in one transaction ──────────────────
  if (existingPositions.length > 0) {
    console.log(`[fix-pool] Closing ${existingPositions.length} position(s): ${existingPositions.map(p => p.id).join(', ')}`)
    try {
      const tx = new Transaction()
      tx.setSender(adminAddress)
      const allCoins: any[] = []

      for (const pos of existingPositions) {
        // collect::fee — safe even if fees are 0
        const [feeCoinA, feeCoinB] = tx.moveCall({
          target: `${MMT_PKG}::collect::fee`,
          typeArguments: [SUI_TYPE, normTokenType],
          arguments: [tx.object(poolId), tx.object(pos.id), tx.object(CLOCK), tx.object(MMT_VERSION)],
        })
        allCoins.push(feeCoinA, feeCoinB)

        if (pos.liquidity > 0n) {
          const [removedA, removedB] = tx.moveCall({
            target: `${MMT_PKG}::liquidity::remove_liquidity`,
            typeArguments: [SUI_TYPE, normTokenType],
            arguments: [
              tx.object(poolId), tx.object(pos.id),
              tx.pure.u128(pos.liquidity),
              tx.pure.u64(0), tx.pure.u64(0),
              tx.object(CLOCK), tx.object(MMT_VERSION),
            ],
          })
          allCoins.push(removedA, removedB)
        }

        // close_position — NO typeArguments
        tx.moveCall({
          target: `${MMT_PKG}::liquidity::close_position`,
          arguments: [tx.object(pos.id), tx.object(MMT_VERSION)],
        })
      }

      tx.transferObjects(allCoins, tx.pure.address(adminAddress))

      const closeResult = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
      })

      if (closeResult.effects?.status?.status !== 'success') {
        return NextResponse.json({
          error: `Close positions failed: ${JSON.stringify(closeResult.effects?.status)}`,
          positions: existingPositions.map(p => p.id),
        }, { status: 500 })
      }

      closedDigest = closeResult.digest
      console.log(`[fix-pool] All positions closed: ${closedDigest}`)

      // Wait for indexer to process the closes before adding fresh liquidity
      await new Promise(r => setTimeout(r, 4000))
    } catch (e: any) {
      return NextResponse.json({
        error: `Close positions failed: ${e.message}`,
        positions: existingPositions.map(p => p.id),
      }, { status: 500 })
    }
  } else {
    console.log(`[fix-pool] No existing positions found — adding liquidity directly`)
  }

  // ── Step 6: Add fresh two-sided liquidity ─────────────────────────────────────
  console.log(`[fix-pool] Adding ${Number(suiAmountMist) / 1e9} SUI + tokens at price=${price.toExponential(3)}`)

  const result = await addLiquidityToPool({
    poolId,
    tokenType,
    tokenDecimals,
    suiAmount: suiAmountMist,
    price,
  })

  if (!result.success) {
    return NextResponse.json({
      error: result.error,
      poolId,
      closedPositions: existingPositions.map(p => p.id),
      closedDigest,
    }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    poolId: result.poolId,
    positionId: result.positionId,
    digest: result.digest,
    closedPositions: existingPositions.map(p => p.id),
    closedDigest,
    suiAdded: `${Number(suiAmountMist) / 1e9} SUI`,
  })
}
