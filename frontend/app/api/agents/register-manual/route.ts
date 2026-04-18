import { NextRequest, NextResponse } from 'next/server'
import { createAgent, getAgentByTokenType, updateAgent } from '@/lib/agents-db'
import { ensureAgentWallet } from '@/lib/agent-wallet'
import { fetchPoolToken } from '@/lib/tokens'

export const dynamic = 'force-dynamic'

/**
 * Manually register an agent that was launched but never recorded in KV.
 *
 * POST /api/agents/register-manual
 * Body: { tokenType, creatorAddress, name?, symbol?, poolId?, personality?, llmModel? }
 *
 * If poolId / name / symbol are omitted, they're auto-discovered from on-chain data.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tokenType, creatorAddress } = body

    if (!tokenType || !creatorAddress) {
      return NextResponse.json(
        { error: 'tokenType and creatorAddress are required' },
        { status: 400 }
      )
    }

    // Check if already registered
    const existing = await getAgentByTokenType(tokenType)
    if (existing) {
      return NextResponse.json({
        success: true,
        alreadyExists: true,
        agent: { id: existing.id, tokenType: existing.tokenType, name: existing.name },
      })
    }

    // Auto-discover pool data from on-chain if not provided
    let poolId = body.poolId as string | undefined
    let name = body.name as string | undefined
    let symbol = body.symbol as string | undefined

    if (!poolId || !name || !symbol) {
      const poolToken = await fetchPoolToken(tokenType)
      if (!poolToken) {
        return NextResponse.json(
          { error: `Token not found on-chain for type: ${tokenType}` },
          { status: 404 }
        )
      }
      poolId = poolId || poolToken.poolId
      name = name || poolToken.name
      symbol = symbol || poolToken.symbol
    }

    const packageId = tokenType.split('::')[0] || ''

    const agent = await createAgent({
      creatorAddress,
      tokenType,
      poolId,
      packageId,
      name,
      symbol,
      description: body.description || '',
      avatarUrl: body.avatarUrl || '',
      twitter: body.twitter || '',
      telegram: body.telegram || '',
      website: body.website || '',
      personality: body.personality || `You are ${name}, an AI agent on the Odyssey platform.`,
      skills: body.skills || [],
      llmModel: body.llmModel || 'minimax',
      revenueAida: body.revenueAida ?? 30,
      revenueCreator: body.revenueCreator ?? 40,
      revenuePlatform: body.revenuePlatform ?? 30,
    })

    // Generate a dedicated Sui keypair for this agent
    try {
      const wallet = await ensureAgentWallet(agent.id)
      await updateAgent(agent.id, { agentAddress: wallet.address })
      agent.agentAddress = wallet.address
    } catch (e) {
      console.warn('[register-manual] Wallet generation skipped:', e)
    }

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
      },
    }, { status: 201 })
  } catch (error: any) {
    console.error('Manual register error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to register agent' },
      { status: 500 }
    )
  }
}
