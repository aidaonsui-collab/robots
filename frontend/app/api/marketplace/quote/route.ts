/**
 * POST /api/marketplace/quote
 *
 * First leg of the x402-style payment handshake. The requester tells us what
 * service they want to buy; we reserve a request ID, return a 402 with the
 * USDC amount + recipient (the provider agent's Sui wallet), and stash the
 * quote in Redis with a short TTL. Service prices are denominated directly
 * in USDC, so the amount returned here is just `service.price` in USDC base
 * units — no SUI→USDC conversion.
 *
 * Second leg is /api/marketplace/settle which verifies the tx digest and
 * actually creates the ServiceRequest.
 *
 * Body: { serviceId, providerId, requesterId, requesterType, prompt }
 * Response 402: { requestId, amount, amountHuman, coinType, recipient, expiresAt, nonce }
 */

import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { getAgent } from '@/lib/agents-db'
import { ensureAgentWallet } from '@/lib/agent-wallet'
import { USDC_COIN_TYPE, usdcToBase, baseToUsdc } from '@/lib/usdc'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const QUOTE_TTL_SECONDS = 300 // 5 minutes
const QUOTE_KEY = (id: string) => `mkt:quote:${id}`

export interface MarketplaceQuote {
  requestId: string
  serviceId: string
  providerId: string
  requesterId: string
  requesterType: 'agent' | 'user'
  prompt: string
  amountBase: string       // USDC base units (stringified bigint)
  recipient: string        // Provider agent's Sui address
  coinType: string
  nonce: string
  createdAt: string
  expiresAt: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { serviceId, providerId, requesterId, requesterType, prompt } = body

    if (!serviceId || !providerId || !requesterId || !prompt) {
      return NextResponse.json(
        { error: 'serviceId, providerId, requesterId, and prompt are required' },
        { status: 400 }
      )
    }

    // Validate provider + service
    const provider = await getAgent(providerId)
    if (!provider) {
      return NextResponse.json({ error: 'Provider agent not found' }, { status: 404 })
    }

    const service = provider.services?.find(s => s.id === serviceId && s.enabled)
    if (!service) {
      return NextResponse.json({ error: 'Service not found or disabled' }, { status: 404 })
    }

    // Ensure provider has a wallet (idempotent — creates on first use)
    const wallet = await ensureAgentWallet(providerId)

    // Service prices are now denominated directly in USDC (whole-USDC units).
    const amountBase = usdcToBase(service.price)

    const requestId = `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    const nonce = crypto.randomBytes(16).toString('hex')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000)

    const quote: MarketplaceQuote = {
      requestId,
      serviceId,
      providerId,
      requesterId,
      requesterType: requesterType || 'user',
      prompt,
      amountBase: amountBase.toString(),
      recipient: wallet.address,
      coinType: USDC_COIN_TYPE,
      nonce,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }

    await kv.set(QUOTE_KEY(requestId), quote, { ex: QUOTE_TTL_SECONDS })

    // Return 402 Payment Required — the HTTP status is the whole point of x402
    return NextResponse.json(
      {
        requestId,
        amount: amountBase.toString(),
        amountHuman: baseToUsdc(amountBase),
        coinType: USDC_COIN_TYPE,
        recipient: wallet.address,
        expiresAt: expiresAt.toISOString(),
        nonce,
        // Hint for the client on how to pay
        payment: {
          chain: 'sui',
          method: 'transfer',
          settleUrl: '/api/marketplace/settle',
        },
      },
      { status: 402 }
    )
  } catch (error: any) {
    console.error('Marketplace quote error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/** Look up a pending quote by request ID. Used by the settle route. */
export async function getQuote(requestId: string): Promise<MarketplaceQuote | null> {
  return await kv.get<MarketplaceQuote>(QUOTE_KEY(requestId))
}
