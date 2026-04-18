import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'

// All packages that can emit TradedEventV2 — mirror EVENT_SOURCE_PACKAGES in lib/tokens.ts
const EVENT_PACKAGES = [
  '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd', // origin
  '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813', // v11
]

// How long to serve cached candles before re-fetching (seconds)
const CACHE_TTL = 8

export interface Candle {
  time: number   // unix milliseconds, bucket start (TradingView requires ms)
  open: number
  high: number
  low: number
  close: number
  volume: number    // total SUI traded
  buyVolume: number // SUI from buys only
}

async function rpc(method: string, params: any[]): Promise<any> {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  })
  const j = await res.json()
  return j.result
}

interface RawTrade {
  timestampMs: number
  openPrice: number  // price BEFORE this trade (derived from reserves + trade amounts)
  price: number      // price AFTER this trade
  suiAmount: number
  isBuy: boolean
  txDigest: string
}

// Fetch all trades for a specific pool across all known packages.
// Note: Sui mainnet does not reliably support compound event filters (MoveEventField
// in an All[] filter is broken — github.com/MystenLabs/sui/issues/10792).
// We use MoveEventType + client-side pool_id filtering with 20 pages (2000 events)
// descending so recent trades on new tokens are always captured.
async function fetchRecentTrades(poolId: string): Promise<RawTrade[]> {
  const trades: RawTrade[] = []
  const MAX_PAGES = 20 // 20 × 100 = 2000 events per package — covers full history for new tokens

  for (const pkg of EVENT_PACKAGES) {
    const eventType = `${pkg}::moonbags::TradedEventV2`
    let cursor: any = null

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await rpc('suix_queryEvents', [
        { MoveEventType: eventType },
        cursor,
        100,
        true, // descending — newest first, so this pool's recent trades are captured immediately
      ])

      const data: any[] = result?.data ?? []
      for (const e of data.filter((e: any) => e.parsedJson?.pool_id === poolId)) {
        const p = e.parsedJson
        if (!p) continue

        // Post-trade reserves (what the event records)
        const vSui    = Number(p.virtual_sui_reserves)
        const vToken  = Number(p.virtual_token_reserves)
        const suiAmt  = Number(p.sui_amount)
        const tokAmt  = Number(p.token_amount)
        const isBuy   = !!p.is_buy

        // Post-trade price
        const price = vToken > 0 ? (vSui / 1e9) / (vToken / 1e6) : 0

        // Pre-trade price: reverse the trade to get reserves before this event.
        // Buy:  user added SUI → pre_vSui = post_vSui - suiAmt, pre_vToken = post_vToken + tokAmt
        // Sell: user removed SUI → pre_vSui = post_vSui + suiAmt, pre_vToken = post_vToken - tokAmt
        const preVSui   = isBuy ? vSui - suiAmt : vSui + suiAmt
        const preVToken = isBuy ? vToken + tokAmt : vToken - tokAmt
        const openPrice = preVSui > 0 && preVToken > 0
          ? (preVSui / 1e9) / (preVToken / 1e6)
          : price  // fallback if reconstruction fails

        const ts = Number(e.timestampMs ?? 0) || Number(p.ts ?? 0)
        trades.push({
          timestampMs: ts,
          openPrice,
          price,
          suiAmount: suiAmt / 1e9,
          isBuy,
          txDigest: e.id?.txDigest ?? '',
        })
      }

      if (!result?.hasNextPage) break
      cursor = result.nextCursor
    }
  }

  return trades
}

function bucketSeconds(resolution: string): number {
  const map: Record<string, number> = {
    '1':    60,
    '5':    300,
    '15':   900,
    '60':   3600,
    '240':  14400,
    '1D':   86400,
  }
  return map[resolution] ?? 300
}

function buildCandles(trades: RawTrade[], bucketSec: number): Candle[] {
  const map = new Map<number, Candle>()

  for (const t of trades) {
    const timeSec = Math.floor(t.timestampMs / 1000)
    const bucket  = Math.floor(timeSec / bucketSec) * bucketSec
    const existing = map.get(bucket)
    if (!existing) {
      // First trade in this bucket: open = pre-trade price, close = post-trade price.
      // This gives every candle a visible body even with just one trade in the period.
      map.set(bucket, {
        time: bucket * 1000, // TradingView requires Unix milliseconds
        open: t.openPrice,
        high: Math.max(t.openPrice, t.price),
        low:  Math.min(t.openPrice, t.price),
        close: t.price,
        volume: t.suiAmount,
        buyVolume: t.isBuy ? t.suiAmount : 0,
      })
    } else {
      existing.high   = Math.max(existing.high, t.openPrice, t.price)
      existing.low    = Math.min(existing.low,  t.openPrice, t.price)
      existing.close  = t.price
      existing.volume += t.suiAmount
      if (t.isBuy) existing.buyVolume += t.suiAmount
    }
  }

  return Array.from(map.values()).sort((a, b) => a.time - b.time)
}

// KV schema:
//   ohlcv:{poolId}:trades:v2  → RawTrade[] (v2: includes openPrice field)
//   ohlcv:{poolId}:fetched_at → unix ms of last live fetch

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const poolId     = searchParams.get('poolId')
  const resolution = searchParams.get('resolution') ?? '5'

  if (!poolId) {
    return NextResponse.json({ error: 'poolId required' }, { status: 400 })
  }

  const bucketSec    = bucketSeconds(resolution)
  const tradesKey    = `ohlcv:${poolId}:trades:v2`
  const fetchedAtKey = `ohlcv:${poolId}:fetched_at`

  let kvAvailable   = true
  let cachedTrades: RawTrade[] = []
  let lastFetchedAt = 0

  try {
    const [tradesRaw, fetchedAt] = await Promise.all([
      kv.get<RawTrade[]>(tradesKey),
      kv.get<number>(fetchedAtKey),
    ])
    cachedTrades  = tradesRaw ?? []
    lastFetchedAt = fetchedAt ?? 0
  } catch {
    kvAvailable = false
  }

  const now   = Date.now()
  const stale = (now - lastFetchedAt) > CACHE_TTL * 1000

  if (stale || !kvAvailable) {
    try {
      const freshTrades = await fetchRecentTrades(poolId)

      if (freshTrades.length > 0) {
        // Merge with cached older history, deduplicate by txDigest.
        // Strip any stale cached entries: bad timestamps OR old "digest:seq" format keys
        // (introduced briefly in a previous deploy) since Sui txDigests never contain ':'.
        const validCached = cachedTrades.filter(
          t => t.timestampMs > 0 && !t.txDigest.includes(':')
        )
        const all  = [...validCached, ...freshTrades]
        const seen = new Set<string>()
        cachedTrades = all.filter(t => {
          if (seen.has(t.txDigest)) return false
          seen.add(t.txDigest)
          return true
        }).sort((a, b) => a.timestampMs - b.timestampMs)
      } else {
        // Purge stale entries even when no fresh trades found
        const valid = cachedTrades.filter(t => t.timestampMs > 0 && !t.txDigest.includes(':'))
        if (valid.length !== cachedTrades.length) cachedTrades = valid
      }

      if (kvAvailable) {
        Promise.all([
          kv.set(tradesKey, cachedTrades),
          kv.set(fetchedAtKey, now),
        ]).catch(() => {})
      }
    } catch (e) {
      console.error('OHLCV fetch error:', e)
    }
  }

  const candles = buildCandles(cachedTrades, bucketSec)

  return NextResponse.json(
    { candles, count: cachedTrades.length, cachedAt: lastFetchedAt },
    {
      headers: {
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=60`,
        'Access-Control-Allow-Origin': '*',
      }
    }
  )
}
