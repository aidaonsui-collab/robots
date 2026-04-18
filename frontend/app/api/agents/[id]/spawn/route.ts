import { NextRequest, NextResponse } from 'next/server'
import { getAgent, updateAgent } from '@/lib/agents-db'

export const dynamic = 'force-dynamic'
import {
  provisionAgent,
  deprovisionAgent,
  getWorkerStatus,
  updateAgentConfig,
} from '@/lib/agent-worker'

/**
 * POST /api/agents/:id/spawn
 * Provision an OpenClaw agent on the Railway worker.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Provision on worker via Redis
    const provisioned = await provisionAgent({
      id: agent.id,
      name: agent.name,
      symbol: agent.symbol,
      personality: agent.personality,
      skills: agent.skills || [],
      llmModel: agent.llmModel,
      status: 'active',
      avatarUrl: agent.avatarUrl,
      twitter: agent.twitter,
      telegram: agent.telegram,
      website: agent.website,
      creatorAddress: agent.creatorAddress,
    })

    if (!provisioned) {
      return NextResponse.json(
        { error: 'Failed to provision agent — worker may be unavailable' },
        { status: 503 }
      )
    }

    // Update local DB with session info
    const sessionId = `oc_${agent.id}_${Date.now()}`
    await updateAgent(id, {
      openclawSessionId: sessionId,
      status: 'active',
    })

    return NextResponse.json({
      success: true,
      sessionId,
      status: 'active',
      message: `Agent ${agent.name} provisioned on OpenClaw worker`,
    })
  } catch (error: any) {
    console.error('Spawn error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to spawn agent' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/agents/:id/spawn
 * Get agent's worker status (runtime info from Railway worker).
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

    const workerStatus = await getWorkerStatus(id)

    return NextResponse.json({
      agentId: id,
      localStatus: agent.status,
      openclawSessionId: agent.openclawSessionId || null,
      worker: workerStatus || {
        status: agent.openclawSessionId ? 'provisioned' : 'not_provisioned',
        message: agent.openclawSessionId
          ? 'Agent provisioned but worker status unavailable'
          : 'Agent not yet provisioned on worker',
      },
    })
  } catch (error: any) {
    console.error('Status error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get status' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/agents/:id/spawn
 * Update agent config on the worker (push settings changes).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const updates = await request.json()

    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Update local DB
    await updateAgent(id, updates)

    // Push to worker
    const synced = await updateAgentConfig(id, updates)

    return NextResponse.json({
      success: true,
      synced,
      message: synced
        ? 'Settings updated and synced to worker'
        : 'Settings saved locally (worker sync pending)',
    })
  } catch (error: any) {
    console.error('Update error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update agent' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/agents/:id/spawn
 * Stop and deprovision agent on the worker.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Deprovision from worker
    await deprovisionAgent(id)

    // Update local status
    await updateAgent(id, {
      status: 'stopped',
      openclawSessionId: undefined,
    })

    return NextResponse.json({
      success: true,
      message: 'Agent stopped and deprovisioned',
    })
  } catch (error: any) {
    console.error('Stop error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to stop agent' },
      { status: 500 }
    )
  }
}
