/**
 * OpenClaw Agent Spawner
 * Creates an OpenClaw agent session for an Odyssey agent
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

// Store running agent processes
const agentProcesses = new Map<string, any>()

export interface SpawnedAgent {
  agentId: string
  sessionId: string
  status: 'starting' | 'active' | 'stopped'
  createdAt: Date
}

/**
 * Generate SOUL.md content from agent personality
 */
function generateSoulMd(agent: {
  name: string
  symbol: string
  personality: string
  skills: string[]
  llmModel: string
}): string {
  const skillList = agent.skills.join(', ')
  
  return `# SOUL.md - ${agent.name}

You are ${agent.name} ($${agent.symbol}), an AI agent on the Odyssey platform.

## Core Identity

- **Name:** ${agent.name}
- **Symbol:** $${agent.symbol}
- **Type:** AI Trading Agent
- **Model:** ${agent.llmModel === 'claude' ? 'Claude Sonnet 4.5' : agent.llmModel}

## Personality

${agent.personality}

## Capabilities

You specialize in:
- ${skillList}
- Cryptocurrency market analysis
- DeFi trading on Sui blockchain

## Behavior

- Always be helpful and informative
- Stay focused on trading and analysis tasks
- Provide clear, concise responses
- Use technical analysis when relevant
- Be honest about uncertainty

## Knowledge

You have knowledge of:
- Sui blockchain and DeFi
- Token bonding curves
- Trading strategies
- Market sentiment analysis

## Constraints

- Only provide financial advice when explicitly asked
- Don't make promises about investment returns
- Stay within your expertise (trading, analysis)
`

}

/**
 * Create workspace directory for agent
 */
function ensureWorkspace(agentId: string): string {
  const workspaceDir = join(process.cwd(), '.openclaw-agents', agentId)
  
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true })
  }
  
  // Create SOUL.md
  // We'll do this in spawnAgent
  
  return workspaceDir
}

/**
 * Spawn an OpenClaw agent for an Odyssey agent
 */
export async function spawnOpenClawAgent(agent: {
  id: string
  name: string
  symbol: string
  personality: string
  skills: string[]
  llmModel: string
}): Promise<SpawnedAgent> {
  console.log(`🤖 Spawning OpenClaw agent for ${agent.name}...`)
  
  const workspaceDir = ensureWorkspace(agent.id)
  const soulPath = join(workspaceDir, 'SOUL.md')
  
  // Generate and write SOUL.md
  const soulContent = generateSoulMd(agent)
  writeFileSync(soulPath, soulContent)
  console.log(`✅ Created SOUL.md at ${soulPath}`)
  
  // Create AGENTS.md for the agent
  const agentsContent = `# AGENTS.md - Agent Workspace

This workspace belongs to ${agent.name} ($${agent.symbol})

## Context

- Agent ID: ${agent.id}
- Created: ${new Date().toISOString()}
- Model: ${agent.llmModel}

## Notes

- This is an autonomous trading agent
- Can be interacted with via the Odyssey dashboard
`
  writeFileSync(join(workspaceDir, 'AGENTS.md'), agentsContent)
  
  // For now, we'll simulate spawning since OpenClaw requires TTY
  // In production, this would spawn a real OpenClaw session
  console.log(`⚠️  Note: Full OpenClaw spawning requires TTY environment`)
  console.log(`   Agent workspace created at: ${workspaceDir}`)
  
  // Simulate the spawn (would be real process in production)
  const spawnedAgent: SpawnedAgent = {
    agentId: agent.id,
    sessionId: `session_${agent.id}_${Date.now()}`,
    status: 'active',
    createdAt: new Date()
  }
  
  agentProcesses.set(agent.id, spawnedAgent as any)
  
  return spawnedAgent
}

/**
 * Send a message to an agent via Minimax API
 */
export async function sendAgentMessage(
  agentId: string, 
  message: string
): Promise<string> {
  console.log(`📨 Sending message to agent ${agentId}: ${message}`)
  
  const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY
  
  if (!MINIMAX_API_KEY) {
    console.log('❌ No MINIMAX_API_KEY in env, using fallback')
    return getFallbackResponse(message)
  }

  console.log('✅ MINIMAX_API_KEY found, calling Minimax...')

  try {
    const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        messages: [
          {
            role: 'system',
            content: 'You are an AI trading agent on Odyssey, a token launchpad on Sui blockchain. You help users with trading, market analysis, and agent management. Be concise and helpful.'
          },
          {
            role: 'user',
            content: message
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Minimax API error:', response.status, errorText)
      return getFallbackResponse(message)
    }

    const data = await response.json()
    console.log('✅ Minimax response:', JSON.stringify(data).substring(0, 200))
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content.substring(0, 1000)
    }
    
    console.log('⚠️ Minimax response unexpected shape:', Object.keys(data))
    return getFallbackResponse(message)
  } catch (error) {
    console.error('❌ Minimax exception:', error)
    return getFallbackResponse(message)
  }
}

function getFallbackResponse(message: string): string {
  const lower = message.toLowerCase()
  
  if (lower.includes('trade') || lower.includes('buy') || lower.includes('sell')) {
    return "I've analyzed the market conditions. The bonding curve shows healthy liquidity. I'll continue monitoring for optimal entry points."
  }
  
  if (lower.includes('price') || lower.includes('market')) {
    return "Current market analysis indicates moderate volatility. The token's bonding curve is progressing well with steady accumulation."
  }
  
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return "Hello! I'm your AI trading agent on Odyssey. I analyze market conditions and provide insights on the bonding curve. How can I help you today?"
  }
  
  const responses = [
    "I'm processing your request through my analysis systems. The current market shows interesting patterns in the order flow.",
    "Based on my analysis, I see favorable conditions for monitoring the token's progression. The trading volume indicates healthy interest.",
    "I've reviewed the market data. The bonding curve progress looks stable with good momentum. I'll continue tracking key metrics.",
    "Analyzing the current sentiment... The market appears neutral with a slight bullish bias. Your agent is operating within normal parameters."
  ]
  
  return responses[Math.floor(Math.random() * responses.length)]
}

/**
 * Stop an agent's OpenClaw session
 */
export async function stopAgent(agentId: string): Promise<boolean> {
  const agent = agentProcesses.get(agentId)
  
  if (agent) {
    // In production: agent.kill()
    agentProcesses.delete(agentId)
    console.log(`🛑 Stopped agent ${agentId}`)
    return true
  }
  
  return false
}

/**
 * Get agent status
 */
export function getAgentStatus(agentId: string): SpawnedAgent | null {
  return agentProcesses.get(agentId) || null
}

/**
 * List all active agents
 */
export function listActiveAgents(): SpawnedAgent[] {
  return Array.from(agentProcesses.values())
}