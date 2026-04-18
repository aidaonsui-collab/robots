/**
 * Agent Registry - Check if a token is an AI-launched agent
 * Fetches from backend API (/api/agents)
 */

let agentCache: Set<string> | null = null
let lastFetch = 0
const CACHE_TTL = 60_000 // 1 minute

/**
 * Check if a token type is an AI agent
 */
export async function isAiAgent(tokenType: string): Promise<boolean> {
  // Refresh cache if stale
  if (!agentCache || Date.now() - lastFetch > CACHE_TTL) {
    await refreshAgentCache()
  }
  
  return agentCache?.has(tokenType) || false
}

/**
 * Refresh the agent cache from backend
 */
async function refreshAgentCache(): Promise<void> {
  try {
    const response = await fetch('/api/agents', {
      cache: 'no-store',
      next: { revalidate: 0 },
    })
    
    if (!response.ok) {
      console.error('Failed to fetch agents:', response.statusText)
      return
    }
    
    const { agents } = await response.json()
    agentCache = new Set(agents.map((a: any) => a.tokenType))
    lastFetch = Date.now()
    
    console.log(`✅ Agent cache refreshed: ${agentCache.size} agents`)
  } catch (error) {
    console.error('Agent cache refresh error:', error)
  }
}

/**
 * Manually mark a token as an AI agent (for immediate UI updates)
 */
export function markAsAiAgent(tokenType: string): void {
  if (!agentCache) {
    agentCache = new Set()
  }
  agentCache.add(tokenType)
}

/**
 * Clear the cache (force refresh on next check)
 */
export function clearAgentCache(): void {
  agentCache = null
  lastFetch = 0
}
