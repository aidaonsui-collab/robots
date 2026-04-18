/**
 * Agent Worker Client
 *
 * Communicates with the odyssey-agent-worker on Railway via Upstash Redis.
 * Handles agent provisioning, message queuing, response polling, and status tracking.
 *
 * Redis Key Patterns (matching the worker):
 *   queue:agent:{agentId}     - Message queue (LPUSH/RPOP)
 *   response:agent:{agentId}  - Latest response (SET with 300s TTL)
 *   status:agent:{agentId}    - Agent runtime status (SET with 300s TTL)
 *   memory:agent:{agentId}    - Conversation memory (LIST, max 50)
 *   config:agent:{agentId}    - Agent configuration for worker (SET)
 */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

// ─── Redis Commands via Upstash REST API ─────────────────────────────────────

async function redis(cmd: string[]): Promise<any> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    console.warn('[agent-worker] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN')
    return null
  }

  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[agent-worker] Redis error:', res.status, text)
    return null
  }

  return res.json()
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string
  name: string
  symbol: string
  personality: string
  skills: string[]
  llmModel: string
  status: 'active' | 'paused' | 'stopped'
  avatarUrl?: string
  twitter?: string
  telegram?: string
  website?: string
  creatorAddress?: string
}

export interface WorkerStatus {
  agentId: string
  status: 'idle' | 'processing' | 'active' | 'error' | 'stopped'
  lastHeartbeat?: string
  lastMessage?: string
  sessionId?: string
  error?: string
  uptime?: number
  messagesProcessed?: number
}

export interface QueuedMessage {
  agentId: string
  role: 'user' | 'system'
  content: string
  timestamp: string
  messageId?: string
}

// ─── Agent Provisioning ──────────────────────────────────────────────────────

/**
 * Provision an agent on the Railway worker by writing its config to Redis.
 * The worker polls for new agent configs and spawns AgentRunner instances.
 */
export async function provisionAgent(config: AgentConfig): Promise<boolean> {
  const configData = JSON.stringify({
    ...config,
    provisionedAt: new Date().toISOString(),
    version: 2, // Odyssey 2.0 provisioning format
  })

  // Write agent config that the worker picks up
  const result = await redis(['SET', `config:agent:${config.id}`, configData])
  if (!result) return false

  // Set initial status
  await redis(['SET', `status:agent:${config.id}`, JSON.stringify({
    agentId: config.id,
    status: 'idle',
    provisionedAt: new Date().toISOString(),
  }), 'EX', '600'])

  // Send a system message to trigger the worker to initialize
  await queueMessage(config.id, 'system', `Agent ${config.name} ($${config.symbol}) has been provisioned on Odyssey 2.0. Initialize with personality: ${config.personality?.slice(0, 200) || 'default'}. Skills: ${config.skills?.join(', ') || 'none'}.`)

  console.log(`[agent-worker] Provisioned agent ${config.name} (${config.id})`)
  return true
}

/**
 * Update an agent's config on the worker (for settings changes).
 */
export async function updateAgentConfig(agentId: string, updates: Partial<AgentConfig>): Promise<boolean> {
  // Read existing config
  const existing = await redis(['GET', `config:agent:${agentId}`])
  let config: any = {}

  if (existing?.result) {
    try { config = JSON.parse(existing.result) } catch {}
  }

  // Merge updates
  const updated = {
    ...config,
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  const result = await redis(['SET', `config:agent:${agentId}`, JSON.stringify(updated)])
  if (!result) return false

  // Notify the worker of config change
  await queueMessage(agentId, 'system', `CONFIG_UPDATE: ${JSON.stringify(updates)}`)

  return true
}

/**
 * Deprovision (stop) an agent on the worker.
 */
export async function deprovisionAgent(agentId: string): Promise<boolean> {
  await redis(['DEL', `config:agent:${agentId}`])
  await redis(['DEL', `status:agent:${agentId}`])
  await redis(['DEL', `queue:agent:${agentId}`])
  await redis(['DEL', `response:agent:${agentId}`])
  await redis(['DEL', `memory:agent:${agentId}`])
  return true
}

// ─── Message Queue ───────────────────────────────────────────────────────────

/**
 * Queue a message for the worker to process.
 * Worker picks up via RPOP on `queue:agent:{agentId}`.
 */
export async function queueMessage(
  agentId: string,
  role: 'user' | 'system',
  content: string
): Promise<{ queued: boolean; messageId: string }> {
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // Clear stale response first
  await redis(['DEL', `response:agent:${agentId}`])

  const entry: QueuedMessage = {
    agentId,
    role,
    content,
    timestamp: new Date().toISOString(),
    messageId,
  }

  const result = await redis(['LPUSH', `queue:agent:${agentId}`, JSON.stringify(entry)])

  return {
    queued: result !== null,
    messageId,
  }
}

/**
 * Poll for agent's response from the worker.
 * Returns null if no response yet.
 */
export async function pollResponse(agentId: string): Promise<{
  message: string | null
  timestamp: string | null
}> {
  const result = await redis(['GET', `response:agent:${agentId}`])

  if (!result?.result) {
    return { message: null, timestamp: null }
  }

  try {
    const data = JSON.parse(result.result)
    // Consume-once: delete after reading
    if (data.message) {
      await redis(['DEL', `response:agent:${agentId}`])
    }
    return {
      message: data.message || null,
      timestamp: data.timestamp || null,
    }
  } catch {
    return { message: null, timestamp: null }
  }
}

// ─── Agent Status ────────────────────────────────────────────────────────────

/**
 * Get agent's runtime status from the worker.
 */
export async function getWorkerStatus(agentId: string): Promise<WorkerStatus | null> {
  const result = await redis(['GET', `status:agent:${agentId}`])

  if (!result?.result) return null

  try {
    return JSON.parse(result.result)
  } catch {
    return null
  }
}

/**
 * Check if the worker is alive by checking a known key.
 */
export async function isWorkerHealthy(): Promise<boolean> {
  const result = await redis(['PING'])
  return result?.result === 'PONG'
}

/**
 * Get all provisioned agent IDs.
 */
export async function getProvisionedAgents(): Promise<string[]> {
  const result = await redis(['KEYS', 'config:agent:*'])
  if (!result?.result) return []
  return (result.result as string[]).map((key: string) => key.replace('config:agent:', ''))
}

// ─── Conversation Memory ─────────────────────────────────────────────────────

/**
 * Store a message in agent memory (for worker context).
 */
export async function storeMemory(
  agentId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const entry = JSON.stringify({
    role,
    content,
    timestamp: new Date().toISOString(),
  })

  await redis(['LPUSH', `memory:agent:${agentId}`, entry])
  // Trim to last 50 entries
  await redis(['LTRIM', `memory:agent:${agentId}`, '0', '49'])
}

/**
 * Get conversation memory for an agent.
 */
export async function getMemory(
  agentId: string,
  limit = 20
): Promise<Array<{ role: string; content: string; timestamp: string }>> {
  const result = await redis(['LRANGE', `memory:agent:${agentId}`, '0', String(limit - 1)])
  if (!result?.result) return []

  return (result.result as string[])
    .map((entry: string) => {
      try { return JSON.parse(entry) } catch { return null }
    })
    .filter(Boolean)
    .reverse() // LPUSH means newest first, we want chronological
}

/**
 * Store the worker's response in Redis (used when frontend processes directly
 * but wants to keep the worker in sync).
 */
export async function storeResponse(agentId: string, message: string): Promise<void> {
  const entry = JSON.stringify({ message, timestamp: new Date().toISOString() })
  await redis(['SET', `response:agent:${agentId}`, entry, 'EX', '300'])
}
