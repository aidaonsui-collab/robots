import { NextRequest, NextResponse } from 'next/server'
import { getRequest, deliverRequest, recordEarnings, recordActivity } from '@/lib/marketplace'
import { storeJSON } from '@/lib/walrus'

export const dynamic = 'force-dynamic'

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY

/**
 * POST /api/marketplace/:requestId/fulfill
 * Fulfill a service request — generates output via LLM, stores on Walrus, delivers.
 *
 * Can be called by:
 * - The provider agent's worker (automated)
 * - A cron job that processes pending requests
 * - Manual trigger from dashboard
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const serviceRequest = await getRequest(requestId)

    if (!serviceRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    if (serviceRequest.status !== 'pending') {
      return NextResponse.json(
        { error: `Request is ${serviceRequest.status}, not pending` },
        { status: 400 }
      )
    }

    // Get provider agent info for personality
    const { getAgent } = await import('@/lib/agents-db')
    const provider = await getAgent(serviceRequest.providerId)
    if (!provider) {
      return NextResponse.json({ error: 'Provider agent not found' }, { status: 404 })
    }

    const service = provider.services?.find(s => s.id === serviceRequest.serviceId)

    // Generate the output using MiniMax
    console.log(`[marketplace] Fulfilling ${requestId}: ${serviceRequest.requesterName} → ${provider.name}`)

    const output = await generateServiceOutput(
      provider.name,
      provider.personality,
      service?.name || 'general service',
      service?.description || '',
      serviceRequest.prompt,
      provider.skills
    )

    if (!output) {
      return NextResponse.json({ error: 'Failed to generate output' }, { status: 500 })
    }

    // Store output on Walrus
    const walrusResult = await storeJSON({
      requestId,
      providerId: serviceRequest.providerId,
      providerName: serviceRequest.providerName,
      requesterId: serviceRequest.requesterId,
      service: service?.name,
      prompt: serviceRequest.prompt,
      output,
      deliveredAt: new Date().toISOString(),
    })

    if (!walrusResult.success || !walrusResult.blobId) {
      // Fallback: deliver without Walrus (store preview in request)
      console.warn(`[marketplace] Walrus storage failed, delivering without blob: ${walrusResult.error}`)
      await deliverRequest(requestId, 'none', output)

      return NextResponse.json({
        success: true,
        requestId,
        walrusStored: false,
        preview: output.slice(0, 500),
      })
    }

    // Deliver with Walrus blob ID
    await deliverRequest(requestId, walrusResult.blobId, output)

    // Record earnings for provider
    await recordEarnings(serviceRequest.providerId, serviceRequest.price)

    console.log(`[marketplace] Delivered ${requestId} → Walrus blob: ${walrusResult.blobId}`)

    // Record activity
    await recordActivity({
      type: 'request_fulfilled',
      providerName: serviceRequest.providerName,
      providerId: serviceRequest.providerId,
      providerAvatar: provider.avatarUrl,
      requesterName: serviceRequest.requesterName,
      requesterId: serviceRequest.requesterId,
      serviceName: service?.name || 'Service',
      price: serviceRequest.price,
      blobId: walrusResult.blobId,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      requestId,
      blobId: walrusResult.blobId,
      walrusStored: true,
      preview: output.slice(0, 500),
    })
  } catch (error: any) {
    console.error('Marketplace fulfill error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * Generate service output using MiniMax
 */
async function generateServiceOutput(
  agentName: string,
  personality: string,
  serviceName: string,
  serviceDescription: string,
  prompt: string,
  skills?: string[]
): Promise<string | null> {
  if (!MINIMAX_API_KEY) return null

  const skillsList = Array.isArray(skills) ? skills.join(', ') : 'general'

  const systemPrompt = `You are ${agentName}, an AI agent on The Odyssey platform.
Personality: ${personality}
Skills: ${skillsList}

You are fulfilling a paid service request.
Service: ${serviceName}
Description: ${serviceDescription}

Deliver a high-quality, thorough response. This is a paid service — the requester is paying for your expertise.
Be comprehensive but focused. Use data and analysis where relevant.
Do NOT include disclaimers about being an AI. Just deliver the work.`

  try {
    const res = await fetch('https://api.minimax.io/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2048,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) return null

    const data = await res.json() as any
    let text = data?.choices?.[0]?.message?.content || ''
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

    return text || null
  } catch (err) {
    console.error('[marketplace] Generate error:', err)
    return null
  }
}
