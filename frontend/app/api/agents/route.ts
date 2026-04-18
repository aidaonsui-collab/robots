import { NextRequest, NextResponse } from 'next/server'
import { getAgentsByCreator, getAgentByTokenType, createAgent, listAllAgents } from '@/lib/agents-db'
import { fetchAllPoolTokens } from '@/lib/tokens'

export const dynamic = 'force-dynamic'

/**
 * Auto-discover and register AI agent tokens created by a wallet that are
 * on-chain but were never recorded in KV (e.g. legacy tokens, hardcoded fallbacks).
 */
async function discoverAndRegisterAgents(creatorAddress: string) {
  try {
    const allTokens = await fetchAllPoolTokens()
    const creatorAiTokens = allTokens.filter(
      t => t.isAiLaunched && (t.creator === creatorAddress || t.creatorFull === creatorAddress)
    )
    if (creatorAiTokens.length === 0) return []

    const registered = await Promise.all(
      creatorAiTokens.map(async (token) => {
        // Skip if already in KV
        const existing = await getAgentByTokenType(token.coinType)
        if (existing) return existing

        // Auto-register from on-chain pool data
        return createAgent({
          creatorAddress,
          tokenType: token.coinType,
          poolId: token.poolId,
          packageId: token.coinType.split('::')[0] || '',
          name: token.name,
          symbol: token.symbol,
          description: token.description || '',
          avatarUrl: token.imageUrl || '',
          twitter: '',
          telegram: '',
          website: '',
          personality: `You are ${token.name} ($${token.symbol}), an AI agent on the Odyssey platform.`,
          skills: [],
          llmModel: 'minimax',
          revenueAida: 30,
          revenueCreator: 40,
          revenuePlatform: 30,
        })
      })
    )
    return registered.filter(Boolean)
  } catch (err) {
    console.error('discoverAndRegisterAgents error:', err)
    return []
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const creator = searchParams.get('creator')
    const status = searchParams.get('status')

    let agents = creator
      ? await getAgentsByCreator(creator)
      : await listAllAgents(100)

    // If creator has no KV agents, scan on-chain for their AI tokens and auto-register
    if (creator && agents.length === 0) {
      const discovered = await discoverAndRegisterAgents(creator)
      if (discovered.length > 0) {
        agents = await getAgentsByCreator(creator) // re-fetch now they're registered
      }
    }

    // Filter by status if provided
    if (status) {
      agents = agents.filter(a => a.status === status)
    }

    return NextResponse.json({
      agents: agents.map(agent => ({
        id: agent.id,
        creatorAddress: agent.creatorAddress,
        tokenType: agent.tokenType,
        poolId: agent.poolId,
        name: agent.name,
        symbol: agent.symbol,
        description: agent.description,
        avatarUrl: agent.avatarUrl,
        llmModel: agent.llmModel,
        status: agent.status,
        createdAt: agent.createdAt,
      }))
    })
  } catch (error: any) {
    console.error('Agent fetch error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch agents' },
      { status: 500 }
    )
  }
}
