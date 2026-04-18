import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { getAgent } from '@/lib/agents-db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/agents/:id/topup
 * Create a payment intent to top up an agent's card
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { amount } = await request.json() // Amount in cents

    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (!agent.stripeCardId) {
      return NextResponse.json({ 
        error: 'Agent does not have a card yet. Create a card first.' 
      }, { status: 400 })
    }

    // For Stripe Issuing, we can't directly load funds to a card
    // Instead, we create a payment and track it separately
    // The actual card funding would require Stripe Connect or a funding source
    
    // Create a checkout session for the top-up
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Top up for ${agent.name}`,
              description: 'Add funds to AI agent card',
            },
            unit_amount: amount, // Amount in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${request.headers.get('origin')}/my-agents/${id}/dashboard?topup=success`,
      cancel_url: `${request.headers.get('origin')}/my-agents/${id}/dashboard?topup=cancelled`,
      metadata: {
        agentId: id,
        agentName: agent.name,
        cardId: agent.stripeCardId,
      },
    })

    return NextResponse.json({ 
      sessionId: session.id,
      url: session.url,
    })
  } catch (error: any) {
    console.error('Top up error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create top-up session' },
      { status: 500 }
    )
  }
}