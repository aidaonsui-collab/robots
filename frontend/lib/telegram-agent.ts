/**
 * Telegram Bot API helpers for per-agent bots.
 * Each agent has its own bot token from @BotFather.
 */

const TG_API = (token: string) => `https://api.telegram.org/bot${token}`

export interface TelegramConfig {
  botToken: string
  botUsername?: string
  webhookSecret: string
  enabled: boolean
}

export interface TgSendResult {
  success: boolean
  messageId?: number
  error?: string
}

/** Send a message to a specific chat. Falls back to plain text if Markdown parse fails. */
export async function sendTelegramMessage(
  config: TelegramConfig,
  chatId: number | string,
  text: string,
): Promise<TgSendResult> {
  const send = async (body: Record<string, unknown>) => {
    const res = await fetch(`${TG_API(config.botToken)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  try {
    // First attempt: Markdown formatting
    const json = await send({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    })

    if (json.ok) return { success: true, messageId: json.result?.message_id }

    // Telegram rejected the Markdown (unbalanced symbols, etc.) — retry as plain text
    if (json.description?.includes('parse') || json.description?.includes('entities')) {
      const fallback = await send({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      })
      if (fallback.ok) return { success: true, messageId: fallback.result?.message_id }
      return { success: false, error: fallback.description || 'Send failed' }
    }

    return { success: false, error: json.description || 'Send failed' }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/** Register a webhook URL with Telegram so updates are pushed to our endpoint. */
export async function setTelegramWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${TG_API(botToken)}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken,
        // Only receive message updates (not edited messages, inline queries, etc.)
        allowed_updates: ['message'],
      }),
    })
    const json = await res.json()
    if (!res.ok || !json.ok) {
      return { success: false, error: json.description || `HTTP ${res.status}` }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/** Delete the webhook (used when disabling the bot). */
export async function deleteTelegramWebhook(
  botToken: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${TG_API(botToken)}/deleteWebhook`, { method: 'POST' })
    const json = await res.json()
    return json.ok ? { success: true } : { success: false, error: json.description }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/** Fetch the bot's own username (called once during setup to store botUsername). */
export async function getTelegramBotInfo(
  botToken: string,
): Promise<{ success: boolean; username?: string; error?: string }> {
  try {
    const res = await fetch(`${TG_API(botToken)}/getMe`)
    const json = await res.json()
    if (!res.ok || !json.ok) {
      return { success: false, error: json.description || `HTTP ${res.status}` }
    }
    return { success: true, username: json.result?.username }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/** Generate a cryptographically random webhook secret. */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}
