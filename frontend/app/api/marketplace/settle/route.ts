/**
 * POST /api/marketplace/settle
 *
 * Second leg of the x402 handshake. The requester has signed + submitted a
 * Sui tx transferring USDC to the provider agent's wallet. They now hand us
 * the tx digest; we verify it on-chain and materialize the ServiceRequest.
 *
 * Body: { requestId, txDigest }
 * Response 201: { success: true, request }
 * Response 4xx: { error, stage }
 */

import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { getAgent } from '@/lib/agents-db'
import { createRequest, updateRequest, recordActivity } from '@/lib/marketplace'
import { verifyUsdcPayment } from '@/lib/sui-verify'
import { baseToUsdc } from '@/lib/usdc'
import { getQuote } from '../quote/route'

export const dynamic = 'force-dynamic'

// Idempotency: once a digest has settled a quote, we refuse to use it again
const DIGEST_USED_KEY = (digest: string) => `mkt:digest:${digest}`
const DIGEST_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { requestId, txDigest } = body

    if (!requestId || !txDigest) {
      return NextResponse.json(
        { error: 'requestId and txDigest are required', stage: 'validation' },
        { status: 400 }
      )
    }

    // 1. Load the quote
    const quote = await getQuote(requestId)
    if (!quote) {
      return NextResponse.json(
        { error: 'Quote not found or expired', stage: 'quote_lookup' },
        { status: 404 }
      )
    }

    if (new Date(quote.expiresAt).getTime() < Date.now()) {
      return NextResponse.json(
        { error: 'Quote expired — request a new one', stage: 'quote_expired' },
        { status: 410 }
      )
    }

    // 2. Idempotency check — no double-settling with the same digest
    const alreadyUsed = await kv.get<string>(DIGEST_USED_KEY(txDigest))
    if (alreadyUsed) {
      return NextResponse.json(
        { error: 'Tx digest already used', stage: 'idempotency' },
        { status: 409 }
      )
    }

    // 3. Verify on-chain
    const proof = await verifyUsdcPayment(
      txDigest,
      quote.recipient,
      BigInt(quote.amountBase),
    )
    if (!proof.ok) {
      return NextResponse.json(
        { error: `Payment verification failed: ${proof.reason}`, stage: 'verify' },
        { status: 402 } // Still 402 — payment wasn't accepted
      )
    }

    // TODO: optional — require proof.sender matches the connected wallet that
    // called this endpoint (prevent one user settling another's quote)

    // 4. Claim the digest (prevent double-settle)
    await kv.set(DIGEST_USED_KEY(txDigest), requestId, { ex: DIGEST_TTL_SECONDS })

    // 5. Materialize the ServiceRequest
    const provider = await getAgent(quote.providerId)
    if (!provider) {
      // Payment went through but provider vanished — should be impossible
      return NextResponse.json(
        { error: 'Provider agent disappeared post-payment', stage: 'post_verify' },
        { status: 500 }
      )
    }

    const service = provider.services?.find(s => s.id === quote.serviceId)

    let requesterName = 'Unknown'
    if (quote.requesterType === 'agent') {
      const requesterAgent = await getAgent(quote.requesterId)
      requesterName = requesterAgent?.name || 'Unknown Agent'
    } else {
      requesterName = `${quote.requesterId.slice(0, 6)}...${quote.requesterId.slice(-4)}`
    }

    const serviceRequest = await createRequest({
      serviceId: quote.serviceId,
      providerId: quote.providerId,
      providerName: provider.name,
      requesterId: quote.requesterId,
      requesterType: quote.requesterType,
      requesterName,
      prompt: quote.prompt,
      price: service?.price || 0, // Legacy field, kept for UI
    })

    // Stamp USDC settlement metadata on the request
    await updateRequest(serviceRequest.id, {
      paymentMethod: 'usdc',
      settledAmountUsdc: baseToUsdc(BigInt(quote.amountBase)),
      txDigest,
    })

    await recordActivity({
      type: 'request_created',
      providerName: provider.name,
      providerId: quote.providerId,
      providerAvatar: provider.avatarUrl,
      requesterName,
      requesterId: quote.requesterId,
      serviceName: service?.name || 'Service',
      price: service?.price || 0,
    }).catch(() => {})

    return NextResponse.json(
      {
        success: true,
        request: serviceRequest,
        settlement: {
          txDigest,
          amountUsdc: baseToUsdc(BigInt(quote.amountBase)),
          recipient: quote.recipient,
        },
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Marketplace settle error:', error)
    return NextResponse.json(
      { error: error.message, stage: 'exception' },
      { status: 500 }
    )
  }
}
