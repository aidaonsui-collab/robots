import { NextRequest, NextResponse } from 'next/server'
import { createAgent, updateAgent } from '@/lib/agents-db'
import { ensureAgentWallet } from '@/lib/agent-wallet'
import { mintFounderNft } from '@/lib/founder-nft'

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

    // Mint the Odyssey Founder NFT to the human creator. This is the
    // exclusivity mechanism: regular bonding-curve token launches via
    // /bondingcurve/coins/create never call this — only the agent
    // creation path does. Best-effort; agent creation succeeds even
    // if the mint fails (env vars not yet set, RPC blip, etc.) and
    // the NFT can be minted later by re-running with the right
    // metadata.
    if (agent.agentAddress) {
      try {
        const nftId = await mintFounderNft({
          recipient: creatorAddress,
          agentId: agent.agentAddress,
          poolId,
          agentName: name,
          agentSymbol: symbol,
          imageUrl: avatarUrl || '',
        })
        if (nftId) {
          await updateAgent(agent.id, { founderNftId: nftId })
          agent.founderNftId = nftId
        }
      } catch (e) {
        console.warn('[agent-create] Founder NFT mint failed (non-fatal):', e)
      }
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
        founderNftId: agent.founderNftId,
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
