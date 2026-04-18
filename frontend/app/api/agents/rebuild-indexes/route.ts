import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { listAllAgents } from '@/lib/agents-db'

export const dynamic = 'force-dynamic'

/**
 * Rebuild all KV indexes for agents:
 *   - agent:token:{tokenType}       → agentId
 *   - creator:{address}:agents      → Set<agentId>
 *
 * Use this when an agent was created but isn't showing up in the UI.
 * POST /api/agents/rebuild-indexes
 */
export async function POST(request: NextRequest) {
  try {
    const agents = await listAllAgents(200)

    let fixed = 0
    const results: string[] = []

    for (const agent of agents) {
      // Fix token → agent index
      if (agent.tokenType) {
        await kv.set(`agent:token:${agent.tokenType}`, agent.id)
        results.push(`agent:token:${agent.tokenType} → ${agent.id}`)
      }

      // Fix creator → agents set
      if (agent.creatorAddress) {
        await kv.sadd(`creator:${agent.creatorAddress}:agents`, agent.id)
        results.push(`creator:${agent.creatorAddress}:agents += ${agent.id}`)
      }

      fixed++
    }

    return NextResponse.json({
      success: true,
      agentsProcessed: fixed,
      results,
    })
  } catch (error: any) {
    console.error('Rebuild indexes error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to rebuild indexes' },
      { status: 500 }
    )
  }
}
