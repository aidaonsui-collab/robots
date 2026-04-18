import { NextRequest, NextResponse } from 'next/server'
import { createAgentCard, getCard, getCardTransactions, updateCardStatus } from '@/lib/stripe'
import { getAgent, updateAgent } from '@/lib/agents-db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agents/:id/card
 * Get agent's card details and recent transactions
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const agent = await getAgent(id)

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (!agent.stripeCardId) {
      return NextResponse.json({ 
        hasCard: false,
        message: 'No card issued for this agent'
      })
    }

    // Fetch card details from Stripe
    const card = await getCard(agent.stripeCardId)
    const transactions = await getCardTransactions(agent.stripeCardId, 10)

    return NextResponse.json({
      hasCard: true,
      card: {
        id: card.id,
        last4: card.last4,
        expMonth: card.exp_month,
        expYear: card.exp_year,
        status: card.status,
        brand: card.brand,
      },
      transactions: transactions.map(tx => ({
        id: tx.id,
        amount: tx.amount / 100, // Convert cents to dollars
        currency: tx.currency,
        merchant: tx.merchant_data?.name || 'Unknown',
        category: tx.merchant_data?.category,
        created: new Date(tx.created * 1000).toISOString(),
      })),
    })
  } catch (error: any) {
    console.error('Error fetching card:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch card' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/agents/:id/card
 * Issue a new virtual card for the agent
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { initialBalance } = await request.json()

    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (agent.stripeCardId) {
      return NextResponse.json(
        { error: 'Agent already has a card' },
        { status: 400 }
      )
    }

    // Create card in Stripe
    const cardData = await createAgentCard({
      agentId: agent.id,
      agentName: agent.name,
      cardholderName: `${agent.name} (AI Agent)`,
      cardholderEmail: `agent-${agent.id}@odyssey.fun`, // Use your domain
      initialBalance: initialBalance || 5000, // Default $50
    })

    // Update agent record with card info
    await updateAgent(agent.id, {
      stripeCardId: cardData.cardId,
      stripeCardholderId: cardData.cardholderId,
    })

    return NextResponse.json({
      success: true,
      card: {
        id: cardData.cardId,
        last4: cardData.last4,
        expMonth: cardData.expMonth,
        expYear: cardData.expYear,
        status: cardData.status,
      },
    }, { status: 201 })
  } catch (error: any) {
    console.error('Error creating card:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create card' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/agents/:id/card
 * Update card status (freeze/unfreeze)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { status } = await request.json()

    if (!['active', 'inactive', 'canceled'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    if (!agent.stripeCardId) {
      return NextResponse.json({ error: 'Agent has no card' }, { status: 400 })
    }

    const updated = await updateCardStatus(agent.stripeCardId, status)

    return NextResponse.json({
      success: true,
      card: {
        id: updated.id,
        last4: updated.last4,
        status: updated.status,
      },
    })
  } catch (error: any) {
    console.error('Error updating card:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update card' },
      { status: 500 }
    )
  }
}
