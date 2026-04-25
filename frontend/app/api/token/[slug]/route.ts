import { NextResponse } from 'next/server'
import { fetchPoolToken } from '@/lib/tokens'

// Edge-cache token metadata for 60s. The actual fetchPoolToken call fans
// out to Sui RPC across 6 package namespaces; without this cache, every
// browser load hammers fullnode.mainnet.sui.io from the user's IP and
// trips per-IP HTTP 429 rate limits. With this cache: one server-side
// call per slug per 60s window, served to every visitor from Vercel's
// edge — and the call originates from Vercel's IP, which the public node
// does not throttle as aggressively.
//
// 60s (was 30s) is comfortable for token metadata: name/symbol/icon/
// curve reserves all change slowly, and trades fast-path through
// /api/trades/[slug] which has its own tighter cache. Doubling the
// window halves Vercel function invocations on this route at no
// user-visible cost.
export const revalidate = 60

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> } | { params: { slug: string } }
) {
  const { slug } = await (ctx.params as Promise<{ slug: string }>)
  const decoded = decodeURIComponent(slug)
  const token = await fetchPoolToken(decoded)
  if (!token) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  // BigInt → string so JSON.stringify doesn't throw. The browser-side
  // helper rehydrates these back to bigint.
  const safe = {
    ...token,
    virtualSuiReserves: token.virtualSuiReserves.toString(),
    virtualTokenReserves: token.virtualTokenReserves.toString(),
  }
  return NextResponse.json(safe, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  })
}
