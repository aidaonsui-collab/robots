import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

async function upstashCmd(cmd: string[]): Promise<any> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

/**
 * GET /api/agents/[id]/trading
 * Returns live trading state and recent trade log
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params

  const [stateRes, tradesRes] = await Promise.all([
    upstashCmd(['GET', `trading:agent:${agentId}`]),
    upstashCmd(['LRANGE', `trades:agent:${agentId}`, '0', '19']),
  ])

  const state = stateRes?.result ? JSON.parse(stateRes.result) : null
  const trades = (tradesRes?.result || []).map((t: string) => {
    try { return JSON.parse(t) } catch { return null }
  }).filter(Boolean)

  return NextResponse.json({
    state,
    trades,
    timestamp: new Date().toISOString(),
  })
}

/**
 * POST /api/agents/[id]/trading
 * Actions: reset kill switch, clear state
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  const { action } = await request.json()

  if (action === 'reset-kill-switch') {
    const stateRes = await upstashCmd(['GET', `trading:agent:${agentId}`])
    if (stateRes?.result) {
      const state = JSON.parse(stateRes.result)
      state.killSwitchTriggered = false
      state.enabled = true
      await upstashCmd(['SET', `trading:agent:${agentId}`, JSON.stringify(state)])
      return NextResponse.json({ success: true, state })
    }
    return NextResponse.json({ error: 'No trading state' }, { status: 404 })
  }

  if (action === 'clear-state') {
    await upstashCmd(['DEL', `trading:agent:${agentId}`])
    await upstashCmd(['DEL', `trades:agent:${agentId}`])
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
