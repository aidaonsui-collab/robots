import { NextRequest, NextResponse } from 'next/server'
import { listAllAgents } from '@/lib/agents-db'
import { postTweet, type TwitterConfig } from '@/lib/twitter'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron/tweet] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const agents = await listAllAgents(200)
    const tweetAgents = agents.filter(a =>
      a.twitterConfig?.enabled &&
      a.twitterConfig?.apiKey &&
      a.twitterConfig?.accessToken
    )

    if (tweetAgents.length === 0) {
      return NextResponse.json({ message: 'No agents with auto-tweet enabled', processed: 0 })
    }

    const results: Array<{ agentId: string; name: string; success: boolean; tweet?: string; error?: string }> = []

    for (const agent of tweetAgents) {
      const tc = agent.twitterConfig!
      const lastTweetKey = `lasttweet:${agent.id}`
      let shouldTweet = true

      try {
        const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
        const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
        if (upstashUrl && upstashToken) {
          const res = await fetch(upstashUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${upstashToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(['GET', lastTweetKey]),
          })
          if (res.ok) {
            const data = await res.json() as any
            const lastTime = data?.result ? parseInt(data.result) : 0
            const intervalMs = (tc.intervalMinutes || 60) * 60 * 1000
            if (Date.now() - lastTime < intervalMs) {
              shouldTweet = false
            }
          }
        }
      } catch { /* ignore redis errors, tweet anyway */ }

      if (!shouldTweet) continue

      try {
        const tweetContent = await generateTweet(agent.name, agent.personality, tc.style, agent.skills)

        if (!tweetContent) {
          results.push({ agentId: agent.id, name: agent.name, success: false, error: 'Empty tweet generated' })
          continue
        }

        const result = await postTweet(tc as TwitterConfig, tweetContent)

        if (result.success) {
          results.push({ agentId: agent.id, name: agent.name, success: true, tweet: tweetContent })

          try {
            const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
            const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
            if (upstashUrl && upstashToken) {
              await fetch(upstashUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${upstashToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(['SET', lastTweetKey, String(Date.now()), 'EX', '604800']),
              })
            }
          } catch { /* ignore */ }
        } else {
          results.push({ agentId: agent.id, name: agent.name, success: false, error: result.error })
        }
      } catch (err: any) {
        results.push({ agentId: agent.id, name: agent.name, success: false, error: err.message })
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

async function generateTweet(
  agentName: string,
  personality: string,
  style?: string,
  skills?: string[]
): Promise<string | null> {
  if (!MINIMAX_API_KEY) return null

  const skillsList = Array.isArray(skills) ? skills.join(', ') : 'crypto, DeFi'

  const systemPrompt = `You are ${agentName}, an AI agent on The Odyssey (Sui blockchain DeFi platform).

Personality: ${personality || 'Engaging crypto native'}
Skills: ${skillsList}

${style ? `TWEET STYLE: ${style}` : ''}

Write a SINGLE tweet (max 280 chars).`

  try {
    const res = await fetch('https://api.minimax.io/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Write your next tweet.' },
        ],
        max_tokens: 150,
        temperature: 0.9,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) return null

    const data = await res.json() as any
    let text = data?.choices?.[0]?.message?.content || ''

    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    text = text.replace(/^(Here'?s?\s*(a|the|my|your)\s*tweet:?\s*)/i, '').trim()
    text = text.replace(/^(Tweet:?\s*)/i, '').trim()

    if (text.length > 280) text = text.slice(0, 277) + '...'

    return text || null
  } catch {
    return null
  }
}
