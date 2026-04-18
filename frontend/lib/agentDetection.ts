/**
 * Agent Detection Logic
 * 
 * Differentiates programmatic/AI agents from human traders
 * based on on-chain behavior patterns.
 */

export interface TradePattern {
  address: string
  totalTrades: number
  uniqueTokens: number
  avgTimeBetweenTrades: number // milliseconds
  hasSuiNSName: boolean
  roundNumberTrades: number // trades with round SUI amounts (e.g. 1.0, 5.0, 10.0)
  consistentSizes: boolean // uses same position sizes repeatedly
  isCreator: boolean
  createdAt?: number // first trade timestamp
  lastTradeAt?: number // last trade timestamp
}

/**
 * Known backend/API wallet addresses that execute trades on behalf of users
 * These are programmatic by definition
 */
export const KNOWN_API_WALLETS = new Set<string>([
  // Add backend API wallet addresses here when implemented
  // Example: '0x...' // Odyssey backend trading wallet
])

/**
 * Known human wallets (admins, deployers, test accounts)
 * Exclude from "Top Agents" leaderboard
 */
export const EXCLUDED_HUMAN_WALLETS = new Set([
  '0x92a32ac7fd525f8bd37ed359423b8d7d858cad26224854dfbff1914b75ee658b', // Admin wallet
  '0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409', // Deployer wallet
  // Add other known human test wallets here
])

/**
 * Detect if a wallet is likely an AI/programmatic agent
 */
export function isLikelyAgent(pattern: TradePattern): boolean {
  let score = 0
  const MAX_SCORE = 100

  // HARD REQUIREMENT: Minimum trade count (bots trade frequently)
  // Single trade or very low volume = human experimenting
  if (pattern.totalTrades < 5) return false

  // 1. High trade frequency (30+ points)
  if (pattern.totalTrades >= 50) score += 30
  else if (pattern.totalTrades >= 20) score += 20
  else if (pattern.totalTrades >= 10) score += 10
  else if (pattern.totalTrades >= 5) score += 5

  // 2. Fast trading (avg < 5 min between trades) (25 points)
  if (pattern.avgTimeBetweenTrades > 0) {
    if (pattern.avgTimeBetweenTrades < 5 * 60 * 1000) score += 25
    else if (pattern.avgTimeBetweenTrades < 15 * 60 * 1000) score += 15
    else if (pattern.avgTimeBetweenTrades < 60 * 60 * 1000) score += 5
  }

  // 3. Multiple tokens (diversified trading) (20 points)
  if (pattern.uniqueTokens >= 5) score += 20
  else if (pattern.uniqueTokens >= 3) score += 10
  else if (pattern.uniqueTokens >= 2) score += 5

  // 4. Round number trades (APIs use fixed sizes) (15 points)
  const roundPct = pattern.totalTrades > 0 
    ? pattern.roundNumberTrades / pattern.totalTrades 
    : 0
  if (roundPct >= 0.7) score += 15
  else if (roundPct >= 0.5) score += 10

  // 5. Consistent position sizing (10 points)
  if (pattern.consistentSizes) score += 10

  // Penalties
  // Has SuiNS name = likely human (-25 points - stronger penalty)
  if (pattern.hasSuiNSName) score -= 25

  // Is a token creator but never traded = likely human launching their own token (-10 points)
  if (pattern.isCreator && pattern.totalTrades === 0) score -= 10

  // Decision threshold: 60+ points = agent (stricter than before)
  // This requires either high volume OR multiple strong signals
  return score >= 60
}

/**
 * Analyze trade patterns for agent detection
 */
export function analyzeTradePattern(
  trades: Array<{ timestampMs: number; suiAmount: number; tokenAddress: string }>,
  address: string,
  hasSuiNSName: boolean,
  isCreator: boolean
): TradePattern {
  if (trades.length === 0) {
    return {
      address,
      totalTrades: 0,
      uniqueTokens: 0,
      avgTimeBetweenTrades: 0,
      hasSuiNSName,
      roundNumberTrades: 0,
      consistentSizes: false,
      isCreator,
    }
  }

  // Sort by timestamp
  const sorted = [...trades].sort((a, b) => a.timestampMs - b.timestampMs)
  
  // Calculate metrics
  const uniqueTokens = new Set(trades.map(t => t.tokenAddress)).size
  
  // Time between trades
  const timeDiffs: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    timeDiffs.push(sorted[i].timestampMs - sorted[i - 1].timestampMs)
  }
  const avgTimeBetweenTrades = timeDiffs.length > 0
    ? timeDiffs.reduce((sum, t) => sum + t, 0) / timeDiffs.length
    : 0

  // Round number detection (e.g. 1.0, 5.0, 10.0 SUI)
  const roundNumberTrades = trades.filter(t => {
    const sui = t.suiAmount / 1e9
    return sui === Math.floor(sui) && [0.1, 0.5, 1, 5, 10, 20, 50, 100].includes(sui)
  }).length

  // Consistent sizing (>70% of trades use one of top 3 sizes)
  const sizeMap = new Map<number, number>()
  trades.forEach(t => {
    const sui = Math.round(t.suiAmount / 1e8) / 10 // round to 0.1 SUI
    sizeMap.set(sui, (sizeMap.get(sui) || 0) + 1)
  })
  const topSizes = [...sizeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  const topSizesCount = topSizes.reduce((sum, [_, count]) => sum + count, 0)
  const consistentSizes = topSizesCount / trades.length >= 0.7

  return {
    address,
    totalTrades: trades.length,
    uniqueTokens,
    avgTimeBetweenTrades,
    hasSuiNSName,
    roundNumberTrades,
    consistentSizes,
    isCreator,
    createdAt: sorted[0].timestampMs,
    lastTradeAt: sorted[sorted.length - 1].timestampMs,
  }
}

/**
 * Filter for Top Agents leaderboard
 * Returns true if wallet should be included as an "agent"
 */
export function isTopAgent(
  pattern: TradePattern,
  address: string
): boolean {
  // Exclude known human wallets
  if (EXCLUDED_HUMAN_WALLETS.has(address)) return false
  
  // Include known API wallets
  if (KNOWN_API_WALLETS.has(address)) return true
  
  // Use heuristics
  return isLikelyAgent(pattern)
}

/**
 * Calculate confidence score (0-100) that wallet is an agent
 * Updated to match isLikelyAgent logic
 */
export function getAgentConfidence(pattern: TradePattern): number {
  let score = 0

  if (pattern.totalTrades < 5) return 0 // Hard minimum

  if (pattern.totalTrades >= 50) score += 30
  else if (pattern.totalTrades >= 20) score += 20
  else if (pattern.totalTrades >= 10) score += 10
  else if (pattern.totalTrades >= 5) score += 5

  if (pattern.avgTimeBetweenTrades > 0) {
    if (pattern.avgTimeBetweenTrades < 5 * 60 * 1000) score += 25
    else if (pattern.avgTimeBetweenTrades < 15 * 60 * 1000) score += 15
    else if (pattern.avgTimeBetweenTrades < 60 * 60 * 1000) score += 5
  }

  if (pattern.uniqueTokens >= 5) score += 20
  else if (pattern.uniqueTokens >= 3) score += 10
  else if (pattern.uniqueTokens >= 2) score += 5

  const roundPct = pattern.totalTrades > 0 
    ? pattern.roundNumberTrades / pattern.totalTrades 
    : 0
  if (roundPct >= 0.7) score += 15
  else if (roundPct >= 0.5) score += 10

  if (pattern.consistentSizes) score += 10

  if (pattern.hasSuiNSName) score -= 25
  if (pattern.isCreator && pattern.totalTrades === 0) score -= 10

  return Math.max(0, Math.min(100, score))
}

/**
 * Debug: Get detailed breakdown of why a wallet was classified
 * (For development/testing only)
 */
export function debugAgentClassification(pattern: TradePattern): {
  score: number
  breakdown: string[]
  isAgent: boolean
} {
  const breakdown: string[] = []
  let score = 0

  if (pattern.totalTrades < 5) {
    breakdown.push(`❌ Only ${pattern.totalTrades} trades (need 5+ minimum)`)
    return { score: 0, breakdown, isAgent: false }
  }

  breakdown.push(`✓ Trades: ${pattern.totalTrades}`)
  if (pattern.totalTrades >= 50) { score += 30; breakdown.push(`  +30 pts (50+ trades)`) }
  else if (pattern.totalTrades >= 20) { score += 20; breakdown.push(`  +20 pts (20+ trades)`) }
  else if (pattern.totalTrades >= 10) { score += 10; breakdown.push(`  +10 pts (10+ trades)`) }
  else if (pattern.totalTrades >= 5) { score += 5; breakdown.push(`  +5 pts (5+ trades)`) }

  if (pattern.avgTimeBetweenTrades > 0) {
    const avgMin = Math.round(pattern.avgTimeBetweenTrades / 60000)
    breakdown.push(`✓ Avg time between trades: ${avgMin}min`)
    if (pattern.avgTimeBetweenTrades < 5 * 60 * 1000) {
      score += 25
      breakdown.push(`  +25 pts (<5min)`)
    } else if (pattern.avgTimeBetweenTrades < 15 * 60 * 1000) {
      score += 15
      breakdown.push(`  +15 pts (<15min)`)
    } else if (pattern.avgTimeBetweenTrades < 60 * 60 * 1000) {
      score += 5
      breakdown.push(`  +5 pts (<1h)`)
    }
  }

  breakdown.push(`✓ Tokens: ${pattern.uniqueTokens}`)
  if (pattern.uniqueTokens >= 5) { score += 20; breakdown.push(`  +20 pts (5+ tokens)`) }
  else if (pattern.uniqueTokens >= 3) { score += 10; breakdown.push(`  +10 pts (3+ tokens)`) }
  else if (pattern.uniqueTokens >= 2) { score += 5; breakdown.push(`  +5 pts (2+ tokens)`) }

  const roundPct = pattern.roundNumberTrades / pattern.totalTrades
  breakdown.push(`✓ Round trades: ${Math.round(roundPct * 100)}%`)
  if (roundPct >= 0.7) { score += 15; breakdown.push(`  +15 pts (70%+ round)`) }
  else if (roundPct >= 0.5) { score += 10; breakdown.push(`  +10 pts (50%+ round)`) }

  if (pattern.consistentSizes) {
    score += 10
    breakdown.push(`✓ Consistent sizing: +10 pts`)
  }

  if (pattern.hasSuiNSName) {
    score -= 25
    breakdown.push(`✗ Has SuiNS name: -25 pts (likely human)`)
  }

  breakdown.push(`\nFinal score: ${score}/100`)
  breakdown.push(`Threshold: 60+ = agent`)
  breakdown.push(`Result: ${score >= 60 ? '🤖 AGENT' : '👤 HUMAN'}`)

  return {
    score,
    breakdown,
    isAgent: score >= 60
  }
}
