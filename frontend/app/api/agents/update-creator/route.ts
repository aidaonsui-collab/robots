import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'

/**
 * Update agent's creator address
 */
export async function POST(request: NextRequest) {
  try {
    const { agentId, newCreatorAddress } = await request.json()

    if (!agentId || !newCreatorAddress) {
      return NextResponse.json(
        { error: 'Missing agentId or newCreatorAddress' },
        { status: 400 }
      )
    }

    // Get current agent
    const agent: any = await kv.get(`agent:${agentId}`)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Update creator address
    agent.creatorAddress = newCreatorAddress
    agent.updatedAt = new Date().toISOString()

    // Save back to KV
    await kv.set(`agent:${agentId}`, agent)

    // Also add to new creator's index
    await kv.sadd(`creator:${newCreatorAddress}:agents`, agentId)

    return NextResponse.json({ 
      success: true, 
      message: `Updated creator to ${newCreatorAddress}`,
      agent
    })
  } catch (error: any) {
    console.error('Update error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update' },
      { status: 500 }
    )
  }
}