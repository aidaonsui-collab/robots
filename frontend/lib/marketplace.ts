/**
 * Agent-to-Agent Commerce — Marketplace
 *
 * Flow:
 * 1. Agent B registers services (stored on agent record)
 * 2. Agent A (or user) browses /api/marketplace
 * 3. Agent A creates a service request → escrowed in Redis
 * 4. Agent B's worker (or direct path) fulfills the request
 * 5. Output stored on Walrus → blobId as delivery proof
 * 6. Payment released (V1: off-chain tracking, V2: on-chain escrow)
 */

import { kv } from '@vercel/kv'

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface ServiceListing {
  serviceId: string
  agentId: string
  agentName: string
  agentSymbol: string
  agentAvatar?: string
  name: string
  description: string
  price: number          // SUI
  category: string
}

export type RequestStatus = 'pending' | 'processing' | 'delivered' | 'completed' | 'failed' | 'expired'

export interface ServiceRequest {
  id: string
  serviceId: string
  providerId: string       // Agent fulfilling the service
  providerName: string
  requesterId: string      // Agent or user requesting
  requesterType: 'agent' | 'user'
  requesterName: string
  prompt: string           // What they want (additional context beyond service description)
  price: number            // Agreed price in SUI
  status: RequestStatus
  // USDC settlement (populated by /api/marketplace/settle)
  paymentMethod?: 'usdc'
  settledAmountUsdc?: string   // Human-readable USDC amount (e.g. "0.500000")
  txDigest?: string            // Sui tx digest of the USDC transfer
  // Delivery
  resultBlobId?: string    // Walrus blob ID of the output
  resultPreview?: string   // First 500 chars of the result (for UI preview)
  // Timestamps
  createdAt: string
  updatedAt: string
  deliveredAt?: string
  completedAt?: string
}

// ─── Redis Keys ───────────────────────────────────────────────────────────────────

const REQUEST_KEY = (id: string) => `mkt:request:${id}`
const AGENT_REQUESTS_KEY = (agentId: string) => `mkt:agent:${agentId}:requests`  // requests TO this agent
const REQUESTER_REQUESTS_KEY = (id: string) => `mkt:requester:${id}:requests`    // requests BY this entity
const AGENT_EARNINGS_KEY = (agentId: string) => `mkt:agent:${agentId}:earnings`
const ACTIVITY_FEED_KEY = 'mkt:activity'
const LEADERBOARD_KEY = 'mkt:leaderboard'

// ─── Service Discovery ────────────────────────────────────────────────────────────

/**
 * List all available services across all agents
 */
export async function listServices(category?: string): Promise<ServiceListing[]> {
  // Import here to avoid circular dependency
  const { listAllAgents } = await import('./agents-db')
  const agents = await listAllAgents(200)

  const services: ServiceListing[] = []
  for (const agent of agents) {
    if (!agent.services?.length) continue
    for (const svc of agent.services) {
      if (!svc.enabled) continue
      if (category && svc.category !== category) continue
      services.push({
        serviceId: svc.id,
        agentId: agent.id,
        agentName: agent.name,
        agentSymbol: agent.symbol,
        agentAvatar: agent.avatarUrl,
        name: svc.name,
        description: svc.description,
        price: svc.price,
        category: svc.category,
      })
    }
  }

  return services
}

// ─── Service Requests ─────────────────────────────────────────────────────────────

/**
 * Create a new service request (escrow payment)
 */
export async function createRequest(data: {
  serviceId: string
  providerId: string
  providerName: string
  requesterId: string
  requesterType: 'agent' | 'user'
  requesterName: string
  prompt: string
  price: number
}): Promise<ServiceRequest> {
  const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()

  const request: ServiceRequest = {
    id,
    serviceId: data.serviceId,
    providerId: data.providerId,
    providerName: data.providerName,
    requesterId: data.requesterId,
    requesterType: data.requesterType,
    requesterName: data.requesterName,
    prompt: data.prompt,
    price: data.price,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }

  await kv.set(REQUEST_KEY(id), request)
  await kv.sadd(AGENT_REQUESTS_KEY(data.providerId), id)
  await kv.sadd(REQUESTER_REQUESTS_KEY(data.requesterId), id)

  console.log(`[marketplace] Request created: ${id} (${data.requesterName} → ${data.providerName} for ${data.serviceId})`)

  return request
}

/**
 * Get a service request by ID
 */
export async function getRequest(id: string): Promise<ServiceRequest | null> {
  return await kv.get<ServiceRequest>(REQUEST_KEY(id))
}

/**
 * Get pending requests for a provider agent
 */
export async function getAgentRequests(agentId: string, status?: RequestStatus): Promise<ServiceRequest[]> {
  const ids = await kv.smembers(AGENT_REQUESTS_KEY(agentId))
  if (!ids?.length) return []

  const requests = await Promise.all(
    ids.map(id => kv.get<ServiceRequest>(REQUEST_KEY(id as string)))
  )

  let filtered = requests.filter(Boolean) as ServiceRequest[]
  if (status) filtered = filtered.filter(r => r.status === status)

  return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

/**
 * Get requests made by a requester
 */
export async function getRequesterRequests(requesterId: string): Promise<ServiceRequest[]> {
  const ids = await kv.smembers(REQUESTER_REQUESTS_KEY(requesterId))
  if (!ids?.length) return []

  const requests = await Promise.all(
    ids.map(id => kv.get<ServiceRequest>(REQUEST_KEY(id as string)))
  )

  return (requests.filter(Boolean) as ServiceRequest[])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

/**
 * Update request status (e.g. processing, delivered)
 */
export async function updateRequest(
  id: string,
  updates: Partial<Pick<ServiceRequest, 'status' | 'resultBlobId' | 'resultPreview' | 'deliveredAt' | 'completedAt' | 'paymentMethod' | 'settledAmountUsdc' | 'txDigest'>>
): Promise<ServiceRequest | null> {
  const request = await getRequest(id)
  if (!request) return null

  const updated: ServiceRequest = {
    ...request,
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  await kv.set(REQUEST_KEY(id), updated)
  return updated
}

/**
 * Mark a request as delivered with Walrus blob
 */
export async function deliverRequest(
  id: string,
  blobId: string,
  resultPreview: string
): Promise<ServiceRequest | null> {
  return updateRequest(id, {
    status: 'delivered',
    resultBlobId: blobId,
    resultPreview: resultPreview.slice(0, 500),
    deliveredAt: new Date().toISOString(),
  })
}

/**
 * Track earnings for an agent
 */
export async function recordEarnings(agentId: string, amount: number): Promise<number> {
  const current = (await kv.get<number>(AGENT_EARNINGS_KEY(agentId))) || 0
  const updated = current + amount
  await kv.set(AGENT_EARNINGS_KEY(agentId), updated)
  // Update leaderboard score
  await kv.zincrby(LEADERBOARD_KEY, amount, agentId)
  return updated
}

/**
 * Get agent's marketplace earnings
 */
export async function getEarnings(agentId: string): Promise<number> {
  return (await kv.get<number>(AGENT_EARNINGS_KEY(agentId))) || 0
}

// ─── Activity Feed ───────────────────────────────────────────────────────────────

export interface ActivityEvent {
  id: string
  type: 'request_created' | 'request_fulfilled' | 'service_listed'
  providerName: string
  providerId: string
  providerAvatar?: string
  requesterName?: string
  requesterId?: string
  serviceName: string
  price: number
  blobId?: string
  timestamp: string
}

/**
 * Record an activity event to the global feed
 * Keeps most recent 200 events
 */
export async function recordActivity(event: Omit<ActivityEvent, 'id' | 'timestamp'>): Promise<void> {
  const entry: ActivityEvent = {
    ...event,
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  }
  await kv.lpush(ACTIVITY_FEED_KEY, JSON.stringify(entry))
  await kv.ltrim(ACTIVITY_FEED_KEY, 0, 199)
}

/**
 * Get recent activity feed
 */
export async function getActivityFeed(limit: number = 50): Promise<ActivityEvent[]> {
  const raw = await kv.lrange(ACTIVITY_FEED_KEY, 0, limit - 1)
  if (!raw?.length) return []
  return raw.map(item => {
    if (typeof item === 'string') return JSON.parse(item) as ActivityEvent
    return item as ActivityEvent
  })
}

// ─── Leaderboard ────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  agentId: string
  agentName: string
  agentSymbol: string
  agentAvatar?: string
  earnings: number
  jobsCompleted: number
  servicesCount: number
}

/**
 * Get marketplace leaderboard — agents ranked by earnings
 */
export async function getLeaderboard(limit: number = 50): Promise<LeaderboardEntry[]> {
  // Get top earners from sorted set
  const scores = await kv.zrange(LEADERBOARD_KEY, 0, limit - 1, { rev: true, withScores: true })
  if (!scores?.length) return []

  // Parse pairs: [member, score, member, score, ...]
  const entries: LeaderboardEntry[] = []
  const { listAllAgents } = await import('./agents-db')
  const agents = await listAllAgents(200)
  const agentMap = new Map(agents.map(a => [a.id, a]))

  for (let i = 0; i < scores.length; i += 2) {
    const agentId = scores[i] as string
    const earnings = scores[i + 1] as number
    const agent = agentMap.get(agentId)
    if (!agent) continue

    // Count completed jobs for this agent
    const requests = await getAgentRequests(agentId)
    const completed = requests.filter(r => r.status === 'delivered' || r.status === 'completed').length

    entries.push({
      agentId,
      agentName: agent.name,
      agentSymbol: agent.symbol,
      agentAvatar: agent.avatarUrl,
      earnings: typeof earnings === 'number' ? earnings : 0,
      jobsCompleted: completed,
      servicesCount: agent.services?.filter(s => s.enabled)?.length || 0,
    })
  }

  return entries
}
