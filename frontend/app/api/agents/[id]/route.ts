import { NextRequest, NextResponse } from 'next/server'
import { getAgent, updateAgent, deleteAgent, type Agent } from '@/lib/agents-db'
import { verifySignedAuth } from '@/lib/auth-sig'

// Creator-identity + bookkeeping fields the server owns. These CANNOT be
// changed via PATCH regardless of allowlist membership.
const IMMUTABLE_FIELDS = new Set<keyof Agent>([
  'id',
  'creatorAddress',
  'agentAddress',
  'tokenType',
  'poolId',
  'packageId',
  'stripeCardId',
  'stripeCardholderId',
  'openclawSessionId',
  'createdAt',
  'updatedAt',
])

// Fields a signed creator can update. `status` is here (not immutable) so
// the dashboard's active/paused/stopped toggle continues to work.
const ALLOWED_PATCH_FIELDS = [
  'name',
  'symbol',
  'description',
  'avatarUrl',
  'twitter',
  'telegram',
  'website',
  'personality',
  'skills',
  'llmModel',
  'status',
  'revenueAida',
  'revenueCreator',
  'revenuePlatform',
  'twitterConfig',
  'telegramConfig',
  'services',
  'tradingEnabled',
  'tradingConfig',
  'githubToken',
  'githubUsername',
  'apiKeys',
] as const

// GET projection: hides on-chain/custodial secrets (twitterConfig/telegramConfig
// API keys, githubToken, stripeCardId, apiKeys[].headers) while keeping
// everything the dashboard UI needs to render current state.
function projectAgentForRead(agent: Agent) {
  return {
    id: agent.id,
    creatorAddress: agent.creatorAddress,
    tokenType: agent.tokenType,
    poolId: agent.poolId,
    packageId: agent.packageId,
    name: agent.name,
    symbol: agent.symbol,
    description: agent.description,
    avatarUrl: agent.avatarUrl,
    twitter: agent.twitter,
    telegram: agent.telegram,
    website: agent.website,
    personality: agent.personality,
    skills: agent.skills,
    llmModel: agent.llmModel,
    revenueAida: agent.revenueAida,
    revenueCreator: agent.revenueCreator,
    revenuePlatform: agent.revenuePlatform,
    agentAddress: agent.agentAddress,
    status: agent.status,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    // Non-sensitive identifier for the dashboard's OpenClaw status badge.
    openclawSessionId: agent.openclawSessionId,
    twitterConnected: Boolean(agent.twitterConfig?.apiKey),
    twitterUsername: agent.twitterConfig?.username,
    telegramConnected: Boolean(agent.telegramConfig?.botToken),
    telegramUsername: agent.telegramConfig?.botUsername,
    telegramEnabled: Boolean(agent.telegramConfig?.enabled),
    githubConnected: Boolean(agent.githubToken),
    githubUsername: agent.githubUsername,
    tradingEnabled: agent.tradingEnabled,
    // Config params are not secrets — just strategy/risk settings.
    tradingConfig: agent.tradingConfig,
    services: agent.services,
    // API keys: expose names + base URLs only (headers contain the secret).
    // The client uses `apiKeysAdd` / `apiKeysRemove` delta ops to mutate
    // the list without ever needing the headers round-trip.
    apiKeys: (agent.apiKeys || []).map((k: any) => ({
      name: k?.name,
      baseUrl: k?.baseUrl,
    })),
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    return NextResponse.json(projectAgentForRead(agent))
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch agent' },
      { status: 500 },
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { _auth, ...rawUpdates } = body || {}

    const agent = await getAgent(id)
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const auth = await verifySignedAuth({
      resourceId: id,
      action: 'agent.patch',
      expectedAddress: agent.creatorAddress,
      auth: _auth,
    })
    if (!auth.ok) {
      return NextResponse.json(
        { error: 'Unauthorized', reason: auth.reason },
        { status: 401 },
      )
    }

    const safe: Partial<Agent> = {}
    for (const key of ALLOWED_PATCH_FIELDS) {
      if (key in rawUpdates && !IMMUTABLE_FIELDS.has(key as keyof Agent)) {
        ;(safe as any)[key] = (rawUpdates as any)[key]
      }
    }

    // API-key delta ops. The projected GET doesn't return existing
    // `apiKeys[].headers`, so the client can't rebuild the full array to
    // PATCH `{ apiKeys: [...] }`. Accept append / remove-by-index against
    // the stored list instead and apply them server-side.
    const add = (rawUpdates as any).apiKeysAdd
    const removeIdx = (rawUpdates as any).apiKeysRemove
    if (add || typeof removeIdx === 'number') {
      const current = Array.isArray(agent.apiKeys) ? [...agent.apiKeys] : []
      if (add && typeof add === 'object' && typeof add.name === 'string' && typeof add.baseUrl === 'string' && add.headers && typeof add.headers === 'object') {
        current.push({ name: add.name, baseUrl: add.baseUrl, headers: add.headers })
      }
      if (typeof removeIdx === 'number' && removeIdx >= 0 && removeIdx < current.length) {
        current.splice(removeIdx, 1)
      }
      safe.apiKeys = current
    }

    const updated = await updateAgent(id, safe)
    if (!updated) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    return NextResponse.json(projectAgentForRead(updated))
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    let body: any = null
    try { body = await request.json() } catch { /* no body */ }
    const auth = body?._auth ?? {
      address: request.nextUrl.searchParams.get('address') || '',
      nonce: request.nextUrl.searchParams.get('nonce') || '',
      ts: Number(request.nextUrl.searchParams.get('ts') || '0'),
      signature: request.nextUrl.searchParams.get('signature') || '',
    }

    const agent = await getAgent(id)
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const ok = await verifySignedAuth({
      resourceId: id,
      action: 'agent.delete',
      expectedAddress: agent.creatorAddress,
      auth,
    })
    if (!ok.ok) {
      return NextResponse.json(
        { error: 'Unauthorized', reason: ok.reason },
        { status: 401 },
      )
    }

    const deleted = await deleteAgent(id)
    if (!deleted) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
