import { NextRequest, NextResponse } from 'next/server'
import { getAgent, updateAgent } from '@/lib/agents-db'
import { postTweet, getMyTweets, verifyCredentials, type TwitterConfig } from '@/lib/twitter'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agents/:id/twitter
 * Get Twitter config status + recent tweets
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const tc = agent.twitterConfig
    if (!tc?.apiKey) {
      return NextResponse.json({
        connected: false,
        message: 'Twitter not connected',
      })
    }

    // Fetch recent tweets
    const tweetsResult = await getMyTweets(tc as TwitterConfig, 10)

    return NextResponse.json({
      connected: true,
      username: tc.username,
      enabled: tc.enabled,
      intervalMinutes: tc.intervalMinutes,
      style: tc.style,
      tweets: tweetsResult.success ? tweetsResult.tweets : [],
    })
  } catch (error: any) {
    console.error('Error fetching twitter:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/agents/:id/twitter
 * Post a tweet on behalf of the agent
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { text } = await request.json()

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }

    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const tc = agent.twitterConfig
    if (!tc?.apiKey) {
      return NextResponse.json({ error: 'Twitter not connected' }, { status: 400 })
    }

    const result = await postTweet(tc as TwitterConfig, text)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      tweetId: result.tweetId,
      tweetUrl: result.tweetUrl,
    })
  } catch (error: any) {
    console.error('Error posting tweet:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * PATCH /api/agents/:id/twitter
 * Update Twitter config (connect, update settings, disconnect)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const agent = await getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Disconnect
    if (body.disconnect) {
      await updateAgent(id, { twitterConfig: undefined } as any)
      return NextResponse.json({ success: true, connected: false })
    }

    // Connect or update
    const existing = agent.twitterConfig || {} as Record<string, any>
    const updated: Record<string, any> = {
      ...existing,
      ...(body.apiKey !== undefined && { apiKey: body.apiKey }),
      ...(body.apiSecret !== undefined && { apiSecret: body.apiSecret }),
      ...(body.accessToken !== undefined && { accessToken: body.accessToken }),
      ...(body.accessTokenSecret !== undefined && { accessTokenSecret: body.accessTokenSecret }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.intervalMinutes !== undefined && { intervalMinutes: body.intervalMinutes }),
      ...(body.style !== undefined && { style: body.style }),
    }

    // If all 4 API keys are present, verify credentials
    if (updated.apiKey && updated.apiSecret && updated.accessToken && updated.accessTokenSecret) {
      const verification = await verifyCredentials(updated as TwitterConfig)
      if (!verification.valid) {
        return NextResponse.json({
          error: `Invalid Twitter credentials: ${verification.error}`,
        }, { status: 400 })
      }
      updated.username = verification.username
    }

    await updateAgent(id, { twitterConfig: updated } as any)

    return NextResponse.json({
      success: true,
      connected: !!updated.username,
      username: updated.username,
    })
  } catch (error: any) {
    console.error('Error updating twitter config:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
