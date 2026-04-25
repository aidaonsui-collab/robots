import { NextResponse } from 'next/server'
import { fetchPoolToken } from '@/lib/tokens'

// Edge-cache token metadata for 30s. The actual fetchPoolToken call fans
// out to Sui RPC across 6 package namespaces; without this cache, every
// browser load hammers fullnode.mainnet.sui.io from the user's IP and
// trips per-IP HTTP 429 rate limits. With this cache: one server-side
// call per slug per 30s window, served to every visitor from Vercel's
// edge — and the call originates from Vercel's IP, which the public node
// does not throttle as aggressively.
export const revalidate = 30

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
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
    },
  })
}
