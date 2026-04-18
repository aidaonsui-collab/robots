import { NextRequest, NextResponse } from 'next/server'
import { fetchPoolTrades } from '@/lib/tokens'

export const dynamic = 'force-dynamic'

export interface Holder {
  rank: number
  address: string
  balance: string
  percentage: number
  isDev?: boolean
}

const RPC = 'https://fullnode.mainnet.sui.io'
const DECIMALS = 6

async function getCoinBalance(address: string, coinType: string): Promise<bigint> {
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getCoins', params: [address, coinType, null, 50] }),
      signal: AbortSignal.timeout(7000),
      cache: 'no-store',
    })
    const j = await res.json()
    return (j.result?.data ?? []).reduce(
      (s: bigint, c: any) => s + BigInt(c.balance ?? '0'), 0n
    )
  } catch {
    return 0n
  }
}

// Sui RPC can serialize Coin<T>'s inner balance in two ways:
//   1. Direct string:  field.fields.balance = "1234567890"
//   2. Nested struct:  field.fields.balance = { type: "0x2::balance::Balance<T>", fields: { value: "1234567890" } }
// Handle both, and never throw.
function readBalanceField(field: any): bigint {
  if (!field) return 0n
  try {
    const b = field.fields?.balance
    if (b === null || b === undefined) {
      return BigInt(field.fields?.value ?? '0')
    }
    if (typeof b === 'object') {
      // Nested Balance<T>: { type: "...", fields: { value: "..." } }
      return BigInt(b.fields?.value ?? b.value ?? '0')
    }
    return BigInt(b)
  } catch {
    return 0n
  }
}

// Compute circulating supply from the pool object.
//
// In the Moonbags pool (verified from moonbags.move):
//   remain_token_reserves = fixed LP allocation = R_initial (constant until graduation)
//   real_token_reserves   = trading pool (starts at R_initial, decreases as tokens sold)
//
// Therefore: circulating = remain − real = R_initial − (R_initial − sold) = sold
//
// Config-agnostic: works regardless of what R_initial was at pool creation.
// circulating supply denominator = total minted supply
// (matches SuiVision/Suiscan: % of total supply, not % of wallets-only)
async function getCirculatingFromPool(poolId: string, coinType: string): Promise<bigint | null> {
  if (!poolId || !coinType) return null
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 100,
        method: 'suix_getTotalSupply',
        params: [coinType],
      }),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    const j = await res.json()
    const total = BigInt(j.result?.value ?? '0')
    console.log(`[holders] suix_getTotalSupply=${total}`)
    return total > 0n ? total : null
  } catch (e) {
    console.warn('[holders] getTotalSupply failed:', e)
    return null
  }
}

function toPercent(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0
  return Math.round(Number((numerator * 10000n) / denominator)) / 100
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const coinType       = searchParams.get('coinType') ?? ''
  const poolId         = searchParams.get('poolId') ?? ''
  const creatorAddress = (searchParams.get('creatorAddress') ?? '').toLowerCase()

  if (!coinType) return NextResponse.json({ error: 'coinType required' }, { status: 400 })

  // Fetch circulating supply from pool upfront — shared by both paths below.
  // Without this, Suiscan's own percentage uses total-minted as denominator
  // (which gives ~1.5% when SuiVision shows ~3.25%).
  const circulatingRaw = await getCirculatingFromPool(poolId, coinType)

  // ── 1. Suiscan ────────────────────────────────────────────────────────────
  try {
    const res = await fetch(
      `https://suiscan.xyz/api/sui/mainnet/coins/${encodeURIComponent(coinType)}/holders?sortBy=AMOUNT&orderBy=DESC&page=0&size=10`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) }
    )
    if (res.ok) {
      const data = await res.json()
      const raw: any[] = data?.content ?? data?.data ?? data?.holders ?? []
      if (raw.length > 0) {
        const suiscanTotal = data?.totalElements ?? data?.total ?? data?.totalCount ?? null
        console.log(`[holders] Suiscan found ${raw.length} holders, total=${suiscanTotal}`)

        const holders = raw.slice(0, 10).map((h: any, i: number) => {
          const amountVal = h.amount ?? h.balance ?? 0

          // Suiscan amount field: detect whether it's raw (>1e12 → divide by 1e6)
          // or already in token units (multiply by 1e6 to get raw).
          const amountRaw: bigint = amountVal > 1e12
            ? BigInt(Math.round(amountVal))
            : BigInt(Math.round(amountVal * 10 ** DECIMALS))

          // Recompute percentage from pool circulating (not Suiscan's total-minted basis)
          const percentage = circulatingRaw && circulatingRaw > 0n
            ? toPercent(amountRaw, circulatingRaw)
            : Number(h.percentage ?? h.percent ?? 0)

          return {
            rank: i + 1,
            address: h.address ?? h.owner ?? '',
            balance: (Number(amountRaw) / 10 ** DECIMALS).toLocaleString(undefined, { maximumFractionDigits: 0 }),
            percentage,
            isDev: creatorAddress ? (h.address ?? '').toLowerCase() === creatorAddress : false,
          }
        })

        return NextResponse.json({
          total: typeof suiscanTotal === 'number' ? suiscanTotal : raw.length,
          holders,
        })
      }
      console.log(`[holders] Suiscan returned empty for ${coinType}`)
    }
  } catch (e) {
    console.error('[holders] Suiscan error:', e)
  }

  // ── 2. On-chain via fetchPoolTrades + coin balance lookup ─────────────────
  if (!poolId) {
    console.log('[holders] No poolId, cannot do on-chain fallback')
    return NextResponse.json({ holders: [] })
  }

  try {
    const trades = await fetchPoolTrades(poolId)
    console.log(`[holders] fetchPoolTrades returned ${trades.length} trades`)

    const addresses = new Set<string>()
    // Always include the dead/burn wallet — it receives tokens but never trades
    addresses.add('0x0000000000000000000000000000000000000000000000000000000000000000')
    if (creatorAddress) addresses.add(creatorAddress)
    for (const trade of trades) {
      if (trade.user) addresses.add(trade.user.toLowerCase())
    }

    console.log(`[holders] ${addresses.size} unique addresses`)

    if (addresses.size === 0) {
      return NextResponse.json({ holders: [], error: 'No trade events found for pool' })
    }

    const userAddresses = [...addresses].filter(a => a.startsWith('0x') && a.length >= 42)
    const balances = await Promise.all(
      userAddresses.map(async addr => ({
        address: addr,
        balance: await getCoinBalance(addr, coinType),
        isDev: addr === creatorAddress,
      }))
    )

    const nonZero = balances
      .filter(b => b.balance > 0n)
      .sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0))

    console.log(`[holders] ${nonZero.length} non-zero balances`)

    if (nonZero.length === 0) {
      return NextResponse.json({ holders: [], error: 'All balances are zero' })
    }

    // Use pool circulating if available; fall back to sum of found balances
    const denominator = circulatingRaw && circulatingRaw > 0n
      ? circulatingRaw
      : nonZero.reduce((s, b) => s + b.balance, 0n)

    return NextResponse.json({
      total: nonZero.length,
      holders: nonZero.slice(0, 10).map((b, i) => ({
        rank: i + 1,
        address: b.address,
        balance: (Number(b.balance) / 10 ** DECIMALS).toLocaleString(undefined, { maximumFractionDigits: 0 }),
        percentage: toPercent(b.balance, denominator),
        isDev: b.isDev,
      })),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    })
  } catch (e: any) {
    console.error('[holders] On-chain fallback error:', e)
    return NextResponse.json({ holders: [], error: e.message })
  }
}
