import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'

/**
 * Debug endpoint to manually fix KV indexes for agents
 * Use this when an agent was registered but the token index is missing
 */
export async function POST(request: NextRequest) {
  try {
    const { agentId, tokenType } = await request.json()

    if (!agentId || !tokenType) {
      return NextResponse.json(
        { error: 'Missing agentId or tokenType' },
        { status: 400 }
      )
    }

    // Set the index: agent:token:{tokenType} = agentId
    await kv.set(`agent:token:${tokenType}`, agentId)
    
    console.log(`✅ Fixed index for ${tokenType} → ${agentId}`)

    return NextResponse.json({ 
      success: true,
      message: `Index created: agent:token:${tokenType} = ${agentId}`
    })
  } catch (error: any) {
    console.error('Fix index error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fix index' },
      { status: 500 }
    )
  }
}
