import { NextResponse } from 'next/server'
import { fetchPoolTrades } from '@/lib/tokens'

// Trades update in real time (a buy fills the curve, the txns tab + chart
// should reflect it within seconds). 10s revalidate keeps the data fresh
// while still consolidating every visitor's poll into one Vercel-IP call
// per 10s window. Pair with bumping the coin page's foreground poll
// interval to 10s as well so cache hit rate stays high.
//
// Was 5s — doubling the window halves invocations on the busiest catalog
// route at the cost of ~5s extra latency on a new trade landing in the
// txns tab, which is below the noticeable threshold.
export const revalidate = 10

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> } | { params: { slug: string } }
) {
  const { slug } = await (ctx.params as Promise<{ slug: string }>)
  const decoded = decodeURIComponent(slug)
  const trades = await fetchPoolTrades(decoded)
  return NextResponse.json(trades, {
    headers: {
      'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60',
    },
  })
}
