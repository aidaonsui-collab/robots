import { NextResponse } from 'next/server'
import { getAgent } from '@/lib/agents-db'

// A2A v0.3 Agent Card — per-agent discovery endpoint.
// https://a2a-protocol.org/latest/specification/
//
// Standard path for A2A discovery: <agent-base-url>/.well-known/agent-card.json
// For Odyssey agents the base URL is /api/agents/{id}, so the card lives
// at /api/agents/{id}/.well-known/agent-card.json.
//
// Other A2A-speaking agents fetch this card to discover capabilities, then
// message the agent through the `url` field (which points at our chat
// endpoint). That chat endpoint already accepts JSON messages, so this is
// a pure serialization layer — no new protocol surface needed yet.

export const dynamic = 'force-dynamic'

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://theodyssey.fun'

// Static catalogue of the tools currently exposed in the chat route.
// Keep in sync with AGENT_TOOLS in /app/api/agents/[id]/chat/route.ts.
// The A2A spec expects high-level capabilities here, not the raw tool
// schema — agents advertise *what they can do*, not the LLM's private
// function-call surface.
const SKILL_CATALOGUE = [
  {
    id: 'web-research',
    name: 'Web research',
    description: 'Searches the open web and summarises findings. Backed by a live search provider.',
    tags: ['research', 'web'],
    examples: ['What happened with Coinbase x402 this week?', 'Find the latest on A2A protocol adoption.'],
  },
  {
    id: 'crypto-market-data',
    name: 'Crypto market data',
    description: 'Real-time prices, 24h change, RSI(14), and OHLC across multiple intervals for major tokens.',
    tags: ['crypto', 'market-data'],
    examples: ['What is BTC trading at?', 'Give me RSI and 4h OHLC for ETH.'],
  },
  {
    id: 'crypto-news',
    name: 'Crypto news',
    description: 'Aggregated headlines from crypto news providers with timestamps.',
    tags: ['crypto', 'news'],
  },
  {
    id: 'http-api',
    name: 'Arbitrary HTTP GET/POST',
    description: 'Calls any public HTTP endpoint with SSRF-guarded networking. Useful for hitting a specific blockchain RPC, webhook, or third-party API.',
    tags: ['integration', 'http'],
  },
  {
    id: 'generate-file',
    name: 'Generate file',
    description: 'Writes arbitrary file content (code, config, text) to the agent\'s scratchpad and returns a download link.',
    tags: ['code', 'file'],
  },
  {
    id: 'github-push',
    name: 'Push to GitHub',
    description: 'Creates a repo or pushes files to the agent owner\'s connected GitHub account.',
    tags: ['code', 'github'],
  },
  {
    id: 'sui-wallet',
    name: 'Sui wallet self-custody',
    description: 'The agent holds its own Sui keypair and can check balance, transfer SUI, and deposit/withdraw from NAVI lending under a spending policy.',
    tags: ['sui', 'wallet', 'defi'],
  },
  {
    id: 'bonding-curve-trade',
    name: 'Bonding-curve buy/sell',
    description: 'Trades AIDA-paired bonding-curve tokens on Odyssey using the agent\'s own AIDA balance. SUI-paired tokens coming soon.',
    tags: ['sui', 'trading', 'odyssey'],
    examples: ['Buy 25 AIDA of 0x…::sword::SWORD', 'Sell 1000 of 0x…::nout::NUT'],
  },
]

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agent = await getAgent(id)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // Filter the service catalogue down to services this specific agent has
  // enabled in its marketplace config — those are things it will actually
  // accept as paid work via A2A delegation.
  const marketplaceSkills = (agent.services ?? [])
    .filter((s: any) => s.enabled)
    .map((s: any) => ({
      id: `marketplace-${s.id}`,
      name: s.name,
      description: s.description ?? s.name,
      tags: ['marketplace', s.category ?? 'service'],
    }))

  const card = {
    name: agent.name,
    description: agent.description || agent.personality || `AI agent on Odyssey (${agent.symbol || 'AGENT'}).`,
    url: `${ORIGIN}/api/agents/${id}/chat`,
    provider: {
      organization: 'Odyssey',
      url: ORIGIN,
    },
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [...SKILL_CATALOGUE, ...marketplaceSkills],
    // Non-standard extension — lets remote A2A clients verify this agent is
    // the same on-chain entity they think it is by cross-referencing the
    // bonding-curve pool id.
    'x-odyssey': {
      agentId: id,
      tokenType: agent.tokenType,
      poolId: agent.poolId,
      walletAddress: agent.agentAddress,
    },
  }

  return NextResponse.json(card, {
    headers: {
      'Cache-Control': 'public, max-age=60',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}
