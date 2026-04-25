// Browser-safe replacements for the heavy fetcher functions in `./tokens`.
//
// The original `fetchPoolToken` / `fetchPoolTrades` in lib/tokens.ts call
// `fullnode.mainnet.sui.io` directly via `fetch()`. When imported by a
// client component (`'use client'`), every page load fans out 20-30 RPC
// calls from the user's browser IP — which trips the public node's per-IP
// HTTP 429 ceiling within seconds and surfaces as misleading "CORS" errors.
//
// These wrappers route through the cached Vercel Route Handlers
// (`/api/token/[slug]`, `/api/trades/[slug]`) instead. The actual RPC fan-out
// runs server-side from a Vercel IP and gets cached edge-side, so:
//   - browsers stop being rate-limited
//   - N concurrent visitors collapse to 1 RPC call per cache window
//   - failures degrade gracefully (return null / [] like the originals)
//
// Same signatures as the originals — call sites only need to swap the
// import path.

import type { PoolToken, TradeEvent } from './tokens'

function rehydratePoolToken(t: any): PoolToken | null {
  if (!t || typeof t !== 'object') return null
  return {
    ...t,
    virtualSuiReserves: BigInt(t.virtualSuiReserves ?? '0'),
    virtualTokenReserves: BigInt(t.virtualTokenReserves ?? '0'),
  } as PoolToken
}

export async function fetchPoolToken(slugOrCoinType: string): Promise<PoolToken | null> {
  try {
    const res = await fetch(`/api/token/${encodeURIComponent(slugOrCoinType)}`)
    if (!res.ok) return null
    return rehydratePoolToken(await res.json())
  } catch {
    return null
  }
}

export async function fetchPoolTrades(slugOrCoinType: string): Promise<TradeEvent[]> {
  try {
    const res = await fetch(`/api/trades/${encodeURIComponent(slugOrCoinType)}`)
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json) ? (json as TradeEvent[]) : []
  } catch {
    return []
  }
}
