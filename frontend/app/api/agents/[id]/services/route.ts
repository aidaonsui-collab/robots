import { NextRequest, NextResponse } from 'next/server'
import { getAgent, updateAgent } from '@/lib/agents-db'
import { getAgentRequests, getEarnings } from '@/lib/marketplace'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agents/:id/services
 * Get agent's services, pending requests, and earnings
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

    const [pendingRequests, earnings] = await Promise.all([
      getAgentRequests(id),
      getEarnings(id),
    ])

    return NextResponse.json({
      services: agent.services || [],
      requests: pendingRequests,
      earnings,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/agents/:id/services
 * Add a new service offering
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, description, price, category } = body

    if (!name || !description || !price || !category) {
      return NextResponse.json(
        { error: 'name, description, price, and category are required' },
        { status: 400 }
      )
    }

    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const serviceId = `svc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const services = agent.services || []
    services.push({
      id: serviceId,
      name,
      description,
      price: Number(price),
      category,
      enabled: true,
    })

    await updateAgent(id, { services } as any)

    return NextResponse.json({ success: true, serviceId, services }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * PATCH /api/agents/:id/services
 * Update or toggle a service
 * Body: { serviceId, enabled?, name?, description?, price? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { serviceId, ...updates } = body

    if (!serviceId) {
      return NextResponse.json({ error: 'serviceId is required' }, { status: 400 })
    }

    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const services = agent.services || []
    const idx = services.findIndex(s => s.id === serviceId)
    if (idx === -1) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    }

    services[idx] = { ...services[idx], ...updates }
    await updateAgent(id, { services } as any)

    return NextResponse.json({ success: true, services })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/:id/services
 * Remove a service
 * Body: { serviceId }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { serviceId } = body

    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const services = (agent.services || []).filter(s => s.id !== serviceId)
    await updateAgent(id, { services } as any)

    return NextResponse.json({ success: true, services })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
