import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2'

function resolutionToGecko(resolution: string): { timeframe: string; aggregate: number } {
  const map: Record<string, { timeframe: string; aggregate: number }> = {
    '1':   { timeframe: 'minute', aggregate: 1 },
    '5':   { timeframe: 'minute', aggregate: 5 },
    '15':  { timeframe: 'minute', aggregate: 15 },
    '60':  { timeframe: 'hour',   aggregate: 1 },
    '240': { timeframe: 'hour',   aggregate: 4 },
    '1D':  { timeframe: 'day',    aggregate: 1 },
  }
  return map[resolution] ?? { timeframe: 'minute', aggregate: 5 }
}

/**
 * GET /api/momentum-ohlcv?tokenType=0xPKG::module::TYPE&resolution=5
 *
 * Looks up the Momentum DEX pool for a given Sui token type via GeckoTerminal,
 * then returns OHLCV candles in the same format as /api/ohlcv so the existing
 * PriceChart component can render it without modification.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const tokenType = searchParams.get('tokenType')
  const resolution = searchParams.get('resolution') ?? '5'

  if (!tokenType) {
    return NextResponse.json({ error: 'tokenType required' }, { status: 400 })
  }

  // Step 1: Find the Momentum DEX pool for this token via GeckoTerminal
  let poolAddress: string | null = null
  try {
    const poolsUrl = `${GECKO_BASE}/networks/sui/tokens/${encodeURIComponent(tokenType)}/pools?page=1`
    const poolsRes = await fetch(poolsUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (poolsRes.ok) {
      const poolsData = await poolsRes.json()
      const pools: any[] = poolsData?.data ?? []
      // Prefer Momentum pool; fall back to first pool on Sui
      const momentumPool =
        pools.find((p: any) =>
          p?.relationships?.dex?.data?.id?.toLowerCase().includes('momentum') ||
          p?.attributes?.name?.toLowerCase().includes('momentum')
        ) ?? pools[0]
      poolAddress = momentumPool?.attributes?.address ?? null
    }
  } catch (e) {
    console.error('[momentum-ohlcv] Pool lookup failed:', e)
  }

  if (!poolAddress) {
    // Token not yet indexed — pool may still be propagating
    return NextResponse.json(
      { candles: [], poolFound: false },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' } }
    )
  }

  // Step 2: Fetch OHLCV from GeckoTerminal
  const { timeframe, aggregate } = resolutionToGecko(resolution)
  const ohlcvUrl = `${GECKO_BASE}/networks/sui/pools/${encodeURIComponent(poolAddress)}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=500&currency=usd`

  let candles: any[] = []
  try {
    const ohlcvRes = await fetch(ohlcvUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (ohlcvRes.ok) {
      const ohlcvData = await ohlcvRes.json()
      // GeckoTerminal format: [timestamp_sec, open, high, low, close, volume_usd]
      const list: [number, number, number, number, number, number][] =
        ohlcvData?.data?.attributes?.ohlcv_list ?? []
      candles = list
        .filter(([, o, h, l, c]) => o > 0 || h > 0 || l > 0 || c > 0)
        .map(([time, open, high, low, close, volume]) => ({
          time,
          open,
          high,
          low,
          close,
          volume,
          buyVolume: 0,
        }))
      // GeckoTerminal returns newest-first; sort oldest-first for our chart
      candles.sort((a, b) => a.time - b.time)
    }
  } catch (e) {
    console.error('[momentum-ohlcv] OHLCV fetch failed:', e)
  }

  return NextResponse.json(
    { candles, poolAddress, poolFound: true },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' } }
  )
}
