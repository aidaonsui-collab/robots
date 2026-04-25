import { NextResponse } from 'next/server'
import { fetchPoolTrades } from '@/lib/tokens'

// Trades update in real time (a buy fills the curve, the txns tab + chart
// should reflect it within seconds). 5s revalidate keeps the data fresh
// while still consolidating every visitor's poll into one Vercel-IP call
// per 5s window. The coin page already polls every 5s in the foreground,
// so this caches the read perfectly.
export const revalidate = 5

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> } | { params: { slug: string } }
) {
  const { slug } = await (ctx.params as Promise<{ slug: string }>)
  const decoded = decodeURIComponent(slug)
  const trades = await fetchPoolTrades(decoded)
  return NextResponse.json(trades, {
    headers: {
      'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=30',
    },
  })
}
