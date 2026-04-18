import { NextRequest, NextResponse } from 'next/server'
import { createAgent, updateAgent } from '@/lib/agents-db'
import { ensureAgentWallet } from '@/lib/agent-wallet'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const {
      creatorAddress,
      tokenType,
      poolId,
      packageId,
      name,
      symbol,
      description,
      avatarUrl,
      twitter,
      telegram,
      website,
      personality,
      skills,
      llmModel,
      revenueAida,
      revenueCreator,
      revenuePlatform,
    } = body

    // Validation
    if (!creatorAddress || !tokenType || !poolId || !packageId || !name || !symbol || !personality || !llmModel) {
      return NextResponse.json({
        error: 'Missing required fields',
        required: ['creatorAddress', 'tokenType', 'poolId', 'packageId', 'name', 'symbol', 'personality', 'llmModel']
      }, { status: 400 })
    }

    // Create agent in KV first — we need the agent ID before storing the wallet
    const agent = await createAgent({
      creatorAddress,
      tokenType,
      poolId,
      packageId,
      name,
      symbol,
      description: description || '',
      avatarUrl: avatarUrl || '',
      twitter,
      telegram,
      website,
      personality,
      skills: skills || [],
      llmModel,
      revenueAida: revenueAida || 30,
      revenueCreator: revenueCreator || 40,
      revenuePlatform: revenuePlatform || 30,
    })

    // Generate a dedicated Sui keypair for this agent (idempotent — safe to retry)
    // Stored encrypted in Redis under agent:{id}:wallet:secret; address stored on agent record
    try {
      const wallet = await ensureAgentWallet(agent.id)
      await updateAgent(agent.id, { agentAddress: wallet.address })
      agent.agentAddress = wallet.address
    } catch (e) {
      console.warn('[agent-create] Wallet generation skipped (AGENT_WALLET_MASTER_KEY not set?):', e)
    }

    // TODO: Spawn OpenClaw session
    // const sessionId = await spawnOpenClawSession(agent)
    // await updateAgent(agent.id, { openclawSessionId: sessionId, status: 'active' })

    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        tokenType: agent.tokenType,
        poolId: agent.poolId,
        name: agent.name,
        symbol: agent.symbol,
        status: agent.status,
        agentAddress: agent.agentAddress,
      }
    }, { status: 201 })
  } catch (error: any) {
    console.error('Agent creation error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create agent' },
      { status: 500 }
    )
  }
}
