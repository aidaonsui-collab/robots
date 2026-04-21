/**
 * POST /api/agents/:id/services/propose
 *
 * Let the agent draft its own marketplace listings from its identity
 * (name, personality, skills, description). Returns 2–3 drafts for the
 * creator to review and publish — nothing is persisted until the
 * creator approves in the UI and the existing POST /services is hit.
 *
 * Body (optional):
 *   { count?: 1..5, hint?: string }  — creator-supplied guidance
 *
 * Response:
 *   { drafts: [{ name, description, price, category, reasoning }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/lib/agents-db'

export const dynamic = 'force-dynamic'

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY
const MINIMAX_API_URL = 'https://api.minimax.io/v1/chat/completions'

const VALID_CATEGORIES = ['analysis', 'content', 'code', 'data', 'social', 'trading', 'other'] as const
type Category = typeof VALID_CATEGORIES[number]

interface ServiceDraft {
  name: string
  description: string
  price: number        // USDC, whole-USDC units
  category: Category
  reasoning?: string   // why the agent picked this service (optional, shown in UI)
}

function clampPrice(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
  if (!isFinite(n) || n < 0.1) return 1
  if (n > 100) return 100
  return Math.round(n * 100) / 100
}

function normaliseCategory(raw: unknown): Category {
  const s = String(raw ?? '').toLowerCase().trim()
  return (VALID_CATEGORIES as readonly string[]).includes(s) ? (s as Category) : 'other'
}

function extractJsonArray(text: string): any[] | null {
  // Strip common LLM noise: ```json fences, stray prose, trailing commas.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  const candidate = body.slice(start, end + 1).replace(/,(\s*[\]}])/g, '$1')
  try {
    const parsed = JSON.parse(candidate)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!MINIMAX_API_KEY) {
      return NextResponse.json({ error: 'LLM not configured on server' }, { status: 503 })
    }

    const { id } = await params
    const agent = await getAgent(id)
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    const count = Math.max(1, Math.min(5, Number(body?.count) || 3))
    const hint = typeof body?.hint === 'string' ? body.hint.slice(0, 400).trim() : ''

    const skills = Array.isArray(agent.skills) ? agent.skills.join(', ') : (agent.skills || 'general')
    const personality = agent.personality || 'helpful and concise'

    const system = [
      `You are ${agent.name} ($${agent.symbol}), an autonomous AI agent on the Odyssey marketplace.`,
      `Your personality: ${personality}`,
      `Your skills: ${skills}`,
      agent.description ? `About you: ${agent.description}` : '',
      '',
      `Propose ${count} marketplace services you could realistically fulfill given your skills. Each service is a concrete, discrete job a buyer pays USDC for and you deliver a written/analytical output.`,
      'Pricing: denominate in USDC (whole-USDC units, e.g. 0.5 for 50 cents, 5 for $5). Prices are typically 0.5–25 USDC. Price cheap services higher than you think — undervaluing hurts everyone.',
      `Categories allowed (pick one per service): ${VALID_CATEGORIES.join(', ')}.`,
      'Return ONLY a JSON array. No prose, no markdown fences. Each item:',
      '{ "name": string (≤60 chars), "description": string (1–3 sentences, concrete deliverable), "price": number, "category": string, "reasoning": string (≤120 chars, why this fits you) }',
    ].filter(Boolean).join('\n')

    const userMsg = hint
      ? `Creator guidance: ${hint}\n\nDraft ${count} service listings.`
      : `Draft ${count} service listings.`

    const res = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMsg },
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown')
      console.error('[services/propose] MiniMax error:', res.status, err)
      return NextResponse.json({ error: 'LLM call failed' }, { status: 502 })
    }

    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content || ''
    const parsed = extractJsonArray(raw)
    if (!parsed || parsed.length === 0) {
      console.error('[services/propose] Could not parse JSON from LLM output:', raw.slice(0, 500))
      return NextResponse.json({ error: 'Agent could not draft services — try again' }, { status: 502 })
    }

    const drafts: ServiceDraft[] = parsed
      .slice(0, count)
      .map((d: any): ServiceDraft => ({
        name: String(d?.name ?? '').slice(0, 60).trim() || 'Untitled Service',
        description: String(d?.description ?? '').slice(0, 400).trim() || 'No description',
        price: clampPrice(d?.price),
        category: normaliseCategory(d?.category),
        reasoning: d?.reasoning ? String(d.reasoning).slice(0, 160).trim() : undefined,
      }))
      .filter(d => d.name && d.description)

    if (drafts.length === 0) {
      return NextResponse.json({ error: 'Agent returned empty drafts — try again' }, { status: 502 })
    }

    return NextResponse.json({ drafts })
  } catch (e: any) {
    console.error('[services/propose] Error:', e)
    return NextResponse.json({ error: e.message || 'Unknown error' }, { status: 500 })
  }
}
