/**
 * Agent database using Vercel KV (Redis)
 * Simple key-value storage - no SQL connection issues
 */

import { kv } from '@vercel/kv'

export interface Agent {
  id: string
  creatorAddress: string
  tokenType: string
  poolId: string
  packageId: string
  
  // Basic info
  name: string
  symbol: string
  description: string
  avatarUrl: string
  
  // Social links
  twitter?: string
  telegram?: string
  website?: string
  
  // Agent configuration
  personality: string
  skills: string[]
  llmModel: string
  
  // Revenue split
  revenueAida: number
  revenueCreator: number
  revenuePlatform: number
  
  // Agent Sui wallet (generated at creation, address is public)
  agentAddress?: string     // 0x… Sui wallet address for this agent

  // GitHub integration
  githubToken?:    string   // OAuth access token
  githubUsername?: string   // GitHub username

  // API keys (creator-configured, stored encrypted in KV)
  apiKeys?: Array<{
    name: string           // Display name, e.g. "Hyperliquid"
    baseUrl: string        // Base URL, e.g. "https://api.hyperliquid.xyz"
    headers: Record<string, string>  // Auth headers, e.g. {"Authorization": "Bearer sk-..."}
  }>

  // Trading state
  tradingEnabled?: boolean
  tradingConfig?: {
    exchange: string          // e.g. "hyperliquid"
    maxPositionSize: number   // Max position in USD
    maxLoss: number           // Max loss before kill switch (USD)
    intervalSeconds: number   // Trading loop interval
    strategy: string          // Strategy description for the LLM
  }

  // Twitter/X integration
  twitterConfig?: {
    apiKey: string              // Consumer Key
    apiSecret: string           // Consumer Secret
    accessToken: string         // User Access Token
    accessTokenSecret: string   // User Access Token Secret
    enabled: boolean            // Auto-tweet enabled
    intervalMinutes: number     // Auto-tweet interval in minutes
    style?: string              // Tweet style instructions
    username?: string           // Verified Twitter username
  }

  // Telegram bot integration
  telegramConfig?: {
    botToken: string            // Token from @BotFather
    botUsername?: string        // e.g. "MySVECAgentBot" (populated after setup)
    webhookSecret: string       // Random secret to verify Telegram webhook calls
    enabled: boolean            // Whether the bot is active
    channelId?: string          // Optional channel/group ID for proactive posts (e.g. "-1001234567890")
  }

  // Agent services (marketplace)
  services?: Array<{
    id: string                  // Unique service ID
    name: string                // e.g. "Market Analysis"
    description: string         // What the service does
    price: number               // Price in USDC (whole-USDC units, e.g. 5 = 5.00 USDC)
    category: string            // e.g. "analysis", "code", "content", "data"
    enabled: boolean
  }>

  // Runtime
  openclawSessionId?: string
  status: 'creating' | 'active' | 'paused' | 'stopped'

  // Founder NFT — Sui object id of the on-chain NFT minted at agent
  // creation. Owned by whoever currently controls the creator fee
  // stream (initially creatorAddress, transferable on TradePort).
  // Manual fee distribution looks this up to find the current
  // recipient. Optional because mint is best-effort: if the env vars
  // for the founder_nft package aren't set, the agent record is
  // still created without an NFT (degrades gracefully during the
  // pre-publish window).
  founderNftId?: string
  
  // Stripe card
  stripeCardId?: string
  stripeCardholderId?: string
  
  // Timestamps
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  role: 'user' | 'agent'
  content: string
  timestamp: string
}

// Key patterns
const AGENT_KEY = (id: string) => `agent:${id}`
const AGENT_BY_TOKEN_KEY = (tokenType: string) => `agent:token:${tokenType}`
const CREATOR_AGENTS_KEY = (creator: string) => `creator:${creator}:agents`
const AGENT_MESSAGES_KEY = (agentId: string) => `agent:${agentId}:messages`

/**
 * Create a new agent
 */
export async function createAgent(data: Omit<Agent, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<Agent> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  
  const agent: Agent = {
    ...data,
    id,
    status: 'creating',
    createdAt: now,
    updatedAt: now,
  }
  
  // Store agent
  await kv.set(AGENT_KEY(id), agent)
  
  // Index by token type
  await kv.set(AGENT_BY_TOKEN_KEY(data.tokenType), id)
  
  // Add to creator's agent list
  await kv.sadd(CREATOR_AGENTS_KEY(data.creatorAddress), id)
  
  return agent
}

/**
 * Get agent by ID
 */
export async function getAgent(id: string): Promise<Agent | null> {
  return await kv.get<Agent>(AGENT_KEY(id))
}

/**
 * Get agent by token type
 */
export async function getAgentByTokenType(tokenType: string): Promise<Agent | null> {
  const id = await kv.get<string>(AGENT_BY_TOKEN_KEY(tokenType))
  if (!id) return null
  return getAgent(id)
}

/**
 * Get all agents by creator
 */
export async function getAgentsByCreator(creatorAddress: string): Promise<Agent[]> {
  const ids = await kv.smembers(CREATOR_AGENTS_KEY(creatorAddress))
  if (!ids || ids.length === 0) return []
  
  const agents = await Promise.all(
    ids.map(id => getAgent(id as string))
  )
  
  return agents.filter(Boolean) as Agent[]
}

/**
 * Update agent
 */
export async function updateAgent(id: string, updates: Partial<Agent>): Promise<Agent | null> {
  const agent = await getAgent(id)
  if (!agent) return null
  
  const updated: Agent = {
    ...agent,
    ...updates,
    id: agent.id, // Don't allow ID change
    createdAt: agent.createdAt, // Don't allow createdAt change
    updatedAt: new Date().toISOString(),
  }
  
  await kv.set(AGENT_KEY(id), updated)
  return updated
}

/**
 * Delete agent
 */
export async function deleteAgent(id: string): Promise<boolean> {
  const agent = await getAgent(id)
  if (!agent) return false
  
  // Remove from all indexes
  await kv.del(AGENT_KEY(id))
  await kv.del(AGENT_BY_TOKEN_KEY(agent.tokenType))
  await kv.srem(CREATOR_AGENTS_KEY(agent.creatorAddress), id)
  
  return true
}

/**
 * List all agents (admin/stats)
 */
export async function listAllAgents(limit = 100): Promise<Agent[]> {
  // This is expensive - use sparingly
  // In production, you'd want a separate index
  const keys = await kv.keys('agent:*')
  // Only match `agent:{uuid}` keys — exclude sub-keys like agent:token:*, agent:*:messages, etc.
  const agentKeys = keys.filter(k => {
    const parts = k.split(':')
    return parts.length === 2 && parts[0] === 'agent'
  })
  
  const agents = await Promise.all(
    agentKeys.slice(0, limit).map(key => kv.get<Agent>(key))
  )
  
  return agents.filter(Boolean) as Agent[]
}

// ─── Chat History ─────────────────────────────────────────────────────────────

const MAX_MESSAGES = 20 // Keep last N messages per agent

/**
 * Append a message to agent's conversation history
 */
export async function appendAgentMessage(agentId: string, message: ChatMessage): Promise<void> {
  const key = AGENT_MESSAGES_KEY(agentId)
  const existing = await kv.get<string[]>(key) || []
  const updated = [...existing, JSON.stringify(message)].slice(-MAX_MESSAGES)
  await kv.set(key, updated)
}

/**
 * Get agent's conversation history
 */
export async function getAgentMessages(agentId: string): Promise<ChatMessage[]> {
  const key = AGENT_MESSAGES_KEY(agentId)
  const raw = await kv.get<string[]>(key) || []
  return raw.map(r => JSON.parse(r) as ChatMessage)
}

/**
 * Clear agent's conversation history
 */
export async function clearAgentMessages(agentId: string): Promise<void> {
  await kv.del(AGENT_MESSAGES_KEY(agentId))
}
