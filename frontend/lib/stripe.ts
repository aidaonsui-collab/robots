import Stripe from 'stripe'

// Lazy initialization to avoid build-time errors when key is missing
let _stripe: Stripe | null = null

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set')
    }
    _stripe = new Stripe(key, {
      apiVersion: '2026-03-25.dahlia',
      typescript: true,
    })
  }
  return _stripe
}

export const stripe = {
  get issuing() { return getStripe().issuing },
  get checkout() { return getStripe().checkout },
  getCard: (cardId: string) => getStripe().issuing.cards.retrieve(cardId),
  createCardholder: (params: any) => getStripe().issuing.cardholders.create(params),
  createCard: (params: any) => getStripe().issuing.cards.create(params),
  updateCard: (cardId: string, params: any) => getStripe().issuing.cards.update(cardId, params),
  listTransactions: (cardId: string, params?: Record<string, unknown>) => getStripe().issuing.transactions.list({ card: cardId, ...params } as any),
}

/**
 * Create a virtual card for an AI agent
 */
export async function createAgentCard(params: {
  agentId: string
  agentName: string
  cardholderName: string
  cardholderEmail: string
  initialBalance: number // in USD cents (e.g., 5000 = $50)
}) {
  try {
    // Step 1: Create a cardholder (required for issuing)
    const cardholder = await stripe.createCardholder({
      name: params.cardholderName,
      email: params.cardholderEmail,
      type: 'individual',
      individual: {
        first_name: params.cardholderName.split(' ')[0] || params.cardholderName,
        last_name: params.cardholderName.split(' ')[1] || 'Agent',
      },
      billing: {
        address: {
          line1: '123 Agent Street',
          city: 'San Francisco',
          state: 'CA',
          postal_code: '94102',
          country: 'US',
        },
      },
      metadata: {
        agent_id: params.agentId,
        agent_name: params.agentName,
      },
    })

    // Step 2: Create a virtual card
    const card = await stripe.createCard({
      cardholder: cardholder.id,
      currency: 'usd',
      type: 'virtual',
      spending_controls: {
        spending_limits: [
          {
            amount: params.initialBalance * 2, // Set monthly limit to 2x initial balance
            interval: 'monthly',
          },
        ],
      },
      metadata: {
        agent_id: params.agentId,
        agent_name: params.agentName,
      },
    })

    // Step 3: Fund the card (simulate initial balance)
    // Note: In production, you'd use Stripe Connect or a funding source
    // For now, we'll track balance separately in our database

    return {
      cardId: card.id,
      cardholderId: cardholder.id,
      last4: card.last4,
      expMonth: card.exp_month,
      expYear: card.exp_year,
      status: card.status,
    }
  } catch (error) {
    console.error('Error creating agent card:', error)
    throw error
  }
}

/**
 * Get card details
 */
export async function getCard(cardId: string) {
  return await stripe.getCard(cardId)
}

/**
 * Get card transactions
 */
export async function getCardTransactions(cardId: string, limit = 10) {
  const transactions = await stripe.listTransactions(cardId, { limit })
  return transactions.data
}

/**
 * Update card status (activate, freeze, cancel)
 */
export async function updateCardStatus(cardId: string, status: 'active' | 'inactive' | 'canceled') {
  return await stripe.updateCard(cardId, { status })
}

/**
 * Update spending limits
 */
export async function updateSpendingLimits(cardId: string, monthlyLimit: number) {
  return await stripe.updateCard(cardId, {
    spending_controls: {
      spending_limits: [
        {
          amount: monthlyLimit,
          interval: 'monthly',
        },
      ],
    },
  })
}
