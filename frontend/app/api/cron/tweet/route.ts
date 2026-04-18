import { NextRequest, NextResponse } from 'next/server'
import { listAllAgents } from '@/lib/agents-db'
import { postTweet, type TwitterConfig } from '@/lib/twitter'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60s for processing multiple agents

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY
const CRON_SECRET = process.env.CRON_SECRET // Optional: protect the endpoint

/**
 * GET /api/cron/tweet
 * Vercel Cron job — runs on schedule, generates and posts tweets for agents with auto-tweet enabled.
 *
 * Each agent's twitterConfig has:
 *   - enabled: true
 *   - intervalMinutes: how often to tweet (30, 60, 120, etc.)
 *   - style: tweet style instructions from the creator
 */
export async function GET(request: NextRequest) {
  // Optional auth check for Vercel Cron
  if (CRON_SECRET) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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

    console.log(`[cron/tweet] Found ${tweetAgents.length} agents with auto-tweet enabled`)

    const results: Array<{ agentId: string; name: string; success: boolean; tweet?: string; error?: string }> = []

    for (const agent of tweetAgents) {
      const tc = agent.twitterConfig!

      // Check if it's time to tweet based on interval
      // Use Redis to track last tweet time per agent
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
              console.log(`[cron/tweet] Skipping ${agent.name} — last tweet ${Math.round((Date.now() - lastTime) / 60000)}m ago (interval: ${tc.intervalMinutes}m)`)
            }
          }
        }
      } catch { /* ignore redis errors, tweet anyway */ }

      if (!shouldTweet) continue

      try {
        // Generate tweet using MiniMax
        const tweetContent = await generateTweet(agent.name, agent.personality, tc.style, agent.skills)

        if (!tweetContent) {
          results.push({ agentId: agent.id, name: agent.name, success: false, error: 'Empty tweet generated' })
          continue
        }

        // Post tweet
        const result = await postTweet(tc as TwitterConfig, tweetContent)

        if (result.success) {
          console.log(`[cron/tweet] ${agent.name} tweeted: ${tweetContent.slice(0, 80)}...`)
          results.push({ agentId: agent.id, name: agent.name, success: true, tweet: tweetContent })

          // Update last tweet time in Redis
          try {
            const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
            const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
            if (upstashUrl && upstashToken) {
              await fetch(upstashUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${upstashToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(['SET', lastTweetKey, String(Date.now()), 'EX', '604800']), // 7 day TTL
              })
            }
          } catch { /* ignore */ }
        } else {
          console.error(`[cron/tweet] ${agent.name} failed: ${result.error}`)
          results.push({ agentId: agent.id, name: agent.name, success: false, error: result.error })
        }
      } catch (err: any) {
        console.error(`[cron/tweet] Error for ${agent.name}:`, err)
        results.push({ agentId: agent.id, name: agent.name, success: false, error: err.message })
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[cron/tweet] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * Generate a tweet using MiniMax based on agent personality and creator's style instructions
 */
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

Write a SINGLE tweet (max 280 chars). Rules:
- Be authentic to your personality
- No hashtag spam (1-2 max if relevant)
- Be engaging, provocative, or insightful
- Reference current crypto/DeFi topics
- DO NOT include quotes around the tweet
- DO NOT explain what the tweet is about — just write it
- Output ONLY the tweet text, nothing else`

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
        temperature: 0.9, // Higher creativity for tweets
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) return null

    const data = await res.json() as any
    let text = data?.choices?.[0]?.message?.content || ''

    // Clean up: remove think tags, quotes, prefixes
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    text = text.replace(/^[""\u201C]|[""\u201D]$/g, '').trim()
    text = text.replace(/^(Here'?s?\s*(a|the|my|your)\s*tweet:?\s*)/i, '').trim()
    text = text.replace(/^(Tweet:?\s*)/i, '').trim()

    // Enforce 280 char limit
    if (text.length > 280) text = text.slice(0, 277) + '...'

    return text || null
  } catch (err) {
    console.error('[generateTweet] Error:', err)
    return null
  }
}
