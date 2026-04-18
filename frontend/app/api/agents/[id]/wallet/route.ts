import { NextRequest, NextResponse } from 'next/server'
import { getAgent, updateAgent } from '@/lib/agents-db'
import { ensureAgentWallet, getAgentWallet, getAgentSuiBalance, getAgentNaviPosition } from '@/lib/agent-wallet'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agents/:id/wallet
 * Returns the agent's Sui wallet address, SUI balance, and NAVI position.
 * Generates a wallet if one doesn't exist yet.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const agent = await getAgent(id)
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    // Ensure the agent has a wallet (idempotent)
    let wallet = await getAgentWallet(id)
    if (!wallet) {
      try {
        wallet = await ensureAgentWallet(id)
        await updateAgent(id, { agentAddress: wallet.address })
      } catch (e) {
        console.warn('[wallet] ensureAgentWallet failed:', e)
        return NextResponse.json({ error: 'Wallet generation unavailable (AGENT_WALLET_MASTER_KEY not configured)' }, { status: 503 })
      }
    }

    // Fetch balance + NAVI position in parallel
    const [suiBalance, naviPosition] = await Promise.all([
      getAgentSuiBalance(wallet.address),
      getAgentNaviPosition(wallet.address),
    ])

    return NextResponse.json({
      address: wallet.address,
      createdAt: wallet.createdAt,
      suiBalance,
      naviPosition,
    })
  } catch (error: any) {
    console.error('[wallet] GET error:', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch wallet' }, { status: 500 })
  }
}
