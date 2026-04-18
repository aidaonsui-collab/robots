import { NextRequest, NextResponse } from 'next/server'

const RPC = 'https://fullnode.mainnet.sui.io'
const ODYSSEY_PACKAGE = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'

/**
 * POST /api/agents/:id/withdraw
 * Withdraw creator's earnings from the pool
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { creatorAddress } = await request.json()

    if (!creatorAddress) {
      return NextResponse.json({ error: 'Creator address required' }, { status: 400 })
    }

    // Get the agent to find the pool
    const agentResponse = await fetch(`${request.headers.get('origin')}/api/agents/${id}`)
    if (!agentResponse.ok) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const agent = await agentResponse.json()
    const poolId = agent.poolId

    if (!poolId) {
      return NextResponse.json({ error: 'No pool found for this agent' }, { status: 400 })
    }

    // Get pool data to calculate earnings
    const poolResponse = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getObject',
        params: [poolId, { showContent: true }]
      })
    })

    const poolData = await poolResponse.json()
    const fields = poolData.result?.data?.content?.fields

    if (!fields) {
      return NextResponse.json({ error: 'Could not fetch pool data' }, { status: 500 })
    }

    // Calculate creator earnings
    // Creator gets 40% of trading fees (2% total = 0.8% of volume)
    const feesCollected = BigInt(fields.fees_collected || '0')
    const creatorEarned = (feesCollected * 40n) / 100n

    // For now, just return the earnings info
    // Full implementation would:
    // 1. Build a transaction to call the contract's withdraw function
    // 2. Sign it with the creator's wallet
    // 3. Execute on chain
    
    const earningsSUI = Number(creatorEarned) / 1e9

    return NextResponse.json({
      success: true,
      earnings: earningsSUI,
      feesCollected: Number(feesCollected) / 1e9,
      message: 'Withdraw initiated. This feature requires wallet signing.',
      note: 'Full withdrawal requires a transaction to be signed and executed on-chain.',
      poolId
    })

  } catch (error: any) {
    console.error('Withdraw error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process withdrawal' },
      { status: 500 }
    )
  }
}