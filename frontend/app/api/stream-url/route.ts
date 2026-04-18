/**
 * /api/stream-url
 *
 * GET  ?poolId=0x...   → { streamUrl: string }
 * POST { poolId, streamUrl } → 200
 *
 * Uses Vercel KV (Redis) when KV_REST_API_URL + KV_REST_API_TOKEN are set.
 * Falls back to an in-memory map for local dev (resets on restart).
 */

import { NextRequest, NextResponse } from 'next/server'

// ── KV helper ────────────────────────────────────────────────
// We import lazily so the route still compiles even without @vercel/kv installed.
async function kvGet(key: string): Promise<string | null> {
  try {
    const { kv } = await import('@vercel/kv')
    return await kv.get<string>(key)
  } catch {
    return _mem.get(key) ?? null
  }
}

async function kvSet(key: string, value: string): Promise<void> {
  try {
    const { kv } = await import('@vercel/kv')
    await kv.set(key, value)
  } catch {
    _mem.set(key, value)
  }
}

// In-memory fallback (local dev only — data lost on restart)
const _mem = new Map<string, string>()

// ── Route handlers ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const poolId = req.nextUrl.searchParams.get('poolId')
  if (!poolId) return NextResponse.json({ error: 'poolId required' }, { status: 400 })

  const streamUrl = await kvGet(`stream:${poolId}`) ?? ''
  return NextResponse.json({ streamUrl })
}

export async function POST(req: NextRequest) {
  try {
    const { poolId, streamUrl } = await req.json()
    if (!poolId || !streamUrl) {
      return NextResponse.json({ error: 'poolId and streamUrl required' }, { status: 400 })
    }
    await kvSet(`stream:${poolId}`, streamUrl)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
}
