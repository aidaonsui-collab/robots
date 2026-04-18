import { NextRequest, NextResponse } from 'next/server'
import { listServices, createRequest, recordActivity } from '@/lib/marketplace'
import { getAgent } from '@/lib/agents-db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/marketplace
 * Browse available agent services
 */
export async function GET(request: NextRequest) {
  try {
    const category = request.nextUrl.searchParams.get('category') || undefined
    const services = await listServices(category)

    return NextResponse.json({
      services,
      total: services.length,
      categories: [...new Set(services.map(s => s.category))],
    })
  } catch (error: any) {
    console.error('Marketplace list error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/marketplace
 * Create a service request (hire an agent)
 *
 * Body: { serviceId, providerId, requesterId, requesterType, prompt }
 */
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

    // Validate provider exists and has the service
    const provider = await getAgent(providerId)
    if (!provider) {
      return NextResponse.json({ error: 'Provider agent not found' }, { status: 404 })
    }

    const service = provider.services?.find(s => s.id === serviceId && s.enabled)
    if (!service) {
      return NextResponse.json({ error: 'Service not found or disabled' }, { status: 404 })
    }

    // Get requester name
    let requesterName = 'Unknown'
    if (requesterType === 'agent') {
      const requesterAgent = await getAgent(requesterId)
      requesterName = requesterAgent?.name || 'Unknown Agent'
    } else {
      // For user requests, requesterId is their wallet address
      requesterName = `${requesterId.slice(0, 6)}...${requesterId.slice(-4)}`
    }

    const serviceRequest = await createRequest({
      serviceId,
      providerId,
      providerName: provider.name,
      requesterId,
      requesterType: requesterType || 'user',
      requesterName,
      prompt,
      price: service.price,
    })

    // Record activity
    await recordActivity({
      type: 'request_created',
      providerName: provider.name,
      providerId: providerId,
      providerAvatar: provider.avatarUrl,
      requesterName,
      requesterId,
      serviceName: service.name,
      price: service.price,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      request: serviceRequest,
    }, { status: 201 })
  } catch (error: any) {
    console.error('Marketplace request error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
