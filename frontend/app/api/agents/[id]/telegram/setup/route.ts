/**
 * Telegram bot setup endpoint.
 *
 * Called from the agent dashboard when the creator saves their bot token.
 * Steps:
 *   1. Validate the bot token by calling getMe
 *   2. Generate a webhook secret
 *   3. Register the webhook URL with Telegram
 *   4. Save telegramConfig to the agent record
 *
 * POST /api/agents/[id]/telegram/setup
 * Body: { botToken: string }
 *
 * DELETE /api/agents/[id]/telegram/setup
 * — Disables the bot (deletes webhook, clears config)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAgent, updateAgent } from '@/lib/agents-db'
import {
  getTelegramBotInfo,
  setTelegramWebhook,
  deleteTelegramWebhook,
  generateWebhookSecret,
} from '@/lib/telegram-agent'

export const dynamic = 'force-dynamic'

function getBaseUrl(req: NextRequest): string {
  // Explicit override first (e.g. NEXT_PUBLIC_APP_URL=https://www.theodyssey.fun)
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  // Derive from the actual request host — correct when called from the production
  // domain. Do NOT use VERCEL_URL: it's the deployment-internal URL
  // (theodyssey2-xxx.vercel.app), not the custom domain www.theodyssey.fun.
  const { protocol, host } = new URL(req.url)
  return `${protocol}//${host}`
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params

  const agent = await getAgent(agentId)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  let body: { botToken?: string; channelIds?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const botToken = body.botToken?.trim()
  if (!botToken) {
    return NextResponse.json({ error: 'botToken is required' }, { status: 400 })
  }
  const channelIds = (body.channelIds ?? []).map(c => c.trim()).filter(Boolean)

  // 1. Verify the token is valid
  const botInfo = await getTelegramBotInfo(botToken)
  if (!botInfo.success) {
    return NextResponse.json(
      { error: `Invalid bot token: ${botInfo.error}` },
      { status: 400 },
    )
  }

  // 2. Generate a fresh webhook secret
  const webhookSecret = generateWebhookSecret()

  // 3. Register webhook with Telegram
  const webhookUrl = `${getBaseUrl(request)}/api/agents/${agentId}/telegram`
  const webhookResult = await setTelegramWebhook(botToken, webhookUrl, webhookSecret)
  if (!webhookResult.success) {
    return NextResponse.json(
      { error: `Failed to set webhook: ${webhookResult.error}` },
      { status: 500 },
    )
  }

  // 4. Save config to agent
  const updated = await updateAgent(agentId, {
    telegramConfig: {
      botToken,
      botUsername: botInfo.username,
      webhookSecret,
      enabled: true,
      ...(channelIds.length ? { channelIds } : {}),
    },
  } as any)

  if (!updated) {
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
  }

  console.log(`[telegram-setup] Configured bot @${botInfo.username} for agent ${agentId}`)

  return NextResponse.json({
    ok: true,
    botUsername: botInfo.username,
    webhookUrl,
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params

  const agent = await getAgent(agentId)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const cfg = (agent as any).telegramConfig
  if (cfg?.botToken) {
    await deleteTelegramWebhook(cfg.botToken).catch(() => {})
  }

  await updateAgent(agentId, { telegramConfig: undefined } as any)

  console.log(`[telegram-setup] Disconnected Telegram bot for agent ${agentId}`)
  return NextResponse.json({ ok: true })
}
