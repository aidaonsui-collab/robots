/**
 * Telegram webhook handler for per-agent bots.
 *
 * Calls MiniMax DIRECTLY from Vercel — intentionally bypasses the Railway
 * worker queue. The worker's buggy processLoop triggers 5-10 concurrent
 * MiniMax calls per message (processLoop-fix.ts documents this), which
 * exhausts the API rate limit and makes both paths fail.
 *
 * By NOT touching the worker queue, Telegram gets a clean, dedicated
 * MiniMax budget with no cross-contamination.
 *
 * POST /api/agents/[id]/telegram
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/lib/agents-db'
import { sendTelegramMessage } from '@/lib/telegram-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── Env ──────────────────────────────────────────────────────────────────────

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY
const SERPER_API_KEY  = process.env.SERPER_API_KEY
const UPSTASH_URL     = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN   = process.env.UPSTASH_REDIS_REST_TOKEN
const MINIMAX_URL     = 'https://api.minimax.io/v1/chat/completions'

// ─── Upstash helpers ─────────────────────────────────────────────────────────

async function redisCmd(cmd: (string | number)[]): Promise<any> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  })
  const json = await res.json()
  return json.result
}

const dedupKey = (agentId: string, updateId: number) => `tg:dedup:${agentId}:${updateId}`
const histKey  = (agentId: string, chatId: number)  => `telegram:hist:${agentId}:${chatId}`

// ─── Tool implementations ─────────────────────────────────────────────────────

async function webSearch(query: string): Promise<string> {
  if (!query) return 'No search query provided.'
  if (SERPER_API_KEY) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 5 }),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = await res.json()
        const parts: string[] = []
        if (data.answerBox?.answer) parts.push(`Answer: ${data.answerBox.answer}`)
        if (data.answerBox?.snippet) parts.push(data.answerBox.snippet)
        if (data.knowledgeGraph?.description) parts.push(`${data.knowledgeGraph.title}: ${data.knowledgeGraph.description}`)
        for (const r of (data.organic || []).slice(0, 5)) {
          parts.push(`${r.title}\n${r.snippet || ''}\n${r.link}`)
        }
        if (parts.length > 0) return parts.join('\n\n')
      }
    } catch {}
  }
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (res.ok) {
      const d = await res.json()
      const parts: string[] = []
      if (d.AbstractText) parts.push(`${d.Heading}: ${d.AbstractText}`)
      if (d.Answer) parts.push(`Answer: ${d.Answer}`)
      for (const t of (d.RelatedTopics || []).slice(0, 5)) {
        if (t.Text) parts.push(`- ${t.Text}`)
      }
      if (parts.length > 0) return parts.join('\n')
    }
  } catch {}
  return `No results for "${query}". Answer from knowledge but note you couldn't verify.`
}

async function cryptoPrices(symbols: string[]): Promise<string> {
  const lines: string[] = []
  try {
    const results = await Promise.all(
      symbols.map(s =>
        fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${s.toUpperCase()}USDT`, {
          signal: AbortSignal.timeout(5000),
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      )
    )
    for (const s of results) {
      if (!s?.symbol) continue
      const name = s.symbol.replace('USDT', '')
      lines.push(`${name}: $${parseFloat(s.lastPrice).toLocaleString()} | 24h: ${parseFloat(s.priceChangePercent) >= 0 ? '+' : ''}${parseFloat(s.priceChangePercent).toFixed(2)}%`)
    }
    if (lines.length > 0) return lines.join('\n')
  } catch {}
  try {
    const idMap: Record<string, string> = {
      BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', SUI: 'sui', ADA: 'cardano',
      DOT: 'polkadot', AVAX: 'avalanche-2', LINK: 'chainlink', DOGE: 'dogecoin', XRP: 'ripple',
    }
    const ids = symbols.map(s => idMap[s.toUpperCase()] || s.toLowerCase()).join(',')
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(5000), cache: 'no-store' }
    )
    if (res.ok) {
      const data = await res.json()
      for (const [id, v] of Object.entries(data) as any) {
        lines.push(`${id}: $${v.usd?.toLocaleString()} (${v.usd_24h_change >= 0 ? '+' : ''}${v.usd_24h_change?.toFixed(2)}%)`)
      }
      if (lines.length > 0) return lines.join('\n')
    }
  } catch {}
  return 'Price data temporarily unavailable.'
}

async function cryptoNews(topic?: string): Promise<string> {
  try {
    const url = topic
      ? `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${encodeURIComponent(topic)}&sortOrder=popular&limit=6`
      : 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular&limit=6'
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = await res.json()
      if (data.Data?.length > 0) {
        return data.Data.slice(0, 6).map((a: any) => {
          const ago = Math.floor((Date.now() / 1000 - a.published_on) / 60)
          const t = ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`
          return `- ${a.title} (${a.source}, ${t})`
        }).join('\n')
      }
    }
  } catch {}
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = await res.json()
      return 'Trending: ' + (data.coins || []).slice(0, 7).map((c: any) => `${c.item.name} (${c.item.symbol})`).join(', ')
    }
  } catch {}
  return 'News temporarily unavailable.'
}

async function technicalIndicators(symbol: string, interval = '1h'): Promise<string> {
  const pair = `${symbol.toUpperCase()}USDT`
  const validIntervals = ['1m', '5m', '15m', '1h', '4h', '1d']
  const tf = validIntervals.includes(interval) ? interval : '1h'
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${tf}&limit=30`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return `Could not fetch klines for ${pair}`
    const klines = await res.json()
    if (!Array.isArray(klines) || klines.length < 15) return `Not enough data for ${pair}`
    const closes = klines.map((k: any) => parseFloat(k[4]))
    const period = 14
    let gains = 0, losses = 0
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1]
      if (diff >= 0) gains += diff; else losses -= diff
    }
    let avgGain = gains / period, avgLoss = losses / period
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1]
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs)
    const price = closes[closes.length - 1]
    let signal = 'Neutral'
    if (rsi >= 70) signal = 'Overbought'
    else if (rsi >= 60) signal = 'Mildly bullish'
    else if (rsi <= 30) signal = 'Oversold'
    else if (rsi <= 40) signal = 'Mildly bearish'
    return `${symbol.toUpperCase()} (${tf}): RSI(14)=${rsi.toFixed(1)} — ${signal} | Price: $${price.toLocaleString()}`
  } catch (err: any) {
    return `Error fetching indicators for ${symbol}: ${err.message}`
  }
}

// ─── MiniMax tool definitions ─────────────────────────────────────────────────

const TG_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'Search the internet for current information. Use for news, facts, prices, or anything you are not 100% sure about.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_crypto_prices',
      description: 'Get real-time crypto prices from Binance/CoinGecko.',
      parameters: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' } } }, required: ['symbols'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_crypto_news',
      description: 'Get latest crypto news and trending coins.',
      parameters: { type: 'object', properties: { topic: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_technical_indicators',
      description: 'Get RSI(14) and technical analysis for a crypto symbol.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          interval: { type: 'string', description: '"1h", "4h", or "1d"' },
        },
        required: ['symbol'],
      },
    },
  },
]

async function executeTool(name: string, args: any): Promise<string> {
  switch (name) {
    case 'web_search':               return webSearch(args.query || '')
    case 'get_crypto_prices':        return cryptoPrices(args.symbols || ['BTC'])
    case 'get_crypto_news':          return cryptoNews(args.topic)
    case 'get_technical_indicators': return technicalIndicators(args.symbol || 'BTC', args.interval || '1h')
    default: return `Unknown tool: ${name}`
  }
}

// ─── MiniMax call with tools ──────────────────────────────────────────────────

type ChatMsg = { role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

async function mmFetch(body: object, attempt = 0): Promise<Response | null> {
  try {
    const res = await fetch(MINIMAX_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MINIMAX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    // Retry on 529 (overloaded) — up to 2 extra attempts with 3s backoff
    if (res.status === 529 && attempt < 2) {
      console.log(`[tg-minimax] 529 overloaded — retry ${attempt + 1}/2 in 3s`)
      await new Promise(r => setTimeout(r, 3000))
      return mmFetch(body, attempt + 1)
    }
    return res
  } catch (err: any) {
    console.error('[tg-minimax] fetch error:', err.message)
    return null
  }
}

async function callMiniMax(messages: ChatMsg[]): Promise<string> {
  if (!MINIMAX_API_KEY) return 'LLM not configured.'

  let current = [...messages]

  for (let round = 0; round < 4; round++) {
    const res = await mmFetch({
      model: 'MiniMax-M2.7',
      messages: current,
      // Drop tools on last round to force a text response
      ...(round < 3 ? { tools: TG_TOOLS, tool_choice: 'auto' } : {}),
      max_tokens: 1024,
      temperature: 0.7,
    })

    if (!res) return "I'm having trouble connecting right now. Please try again in a moment."

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[tg-minimax] HTTP ${res.status}:`, body.slice(0, 200))
      return `Sorry, I ran into a temporary issue (${res.status}). Please try again in a moment.`
    }

    const data = await res.json()
    const msg = data.choices?.[0]?.message
    if (!msg) return 'No response from LLM.'

    if (msg.tool_calls?.length > 0) {
      current.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls })
      for (const tc of msg.tool_calls) {
        let args: any = {}
        try { args = JSON.parse(tc.function.arguments) } catch {}
        const result = await executeTool(tc.function.name, args)
        console.log(`[tg-tool] ${tc.function.name}: ${result.slice(0, 80)}`)
        current.push({ role: 'tool', content: result, tool_call_id: tc.id })
      }
      continue
    }

    // Strip <think> tags and leaked XML tool markup
    const text = stripThinkTags(
      (msg.content || '').replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '')
    )
    return text || 'No response generated.'
  }

  return 'Too many tool rounds — try asking differently.'
}

// ─── Webhook handler ──────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params

  // 1. Load agent + validate telegram config
  const agent = await getAgent(agentId)
  if (!agent) return NextResponse.json({ ok: true })

  const cfg = (agent as any).telegramConfig
  if (!cfg?.enabled || !cfg?.botToken) return NextResponse.json({ ok: true })

  // 2. Verify Telegram secret header
  const secretHeader = request.headers.get('x-telegram-bot-api-secret-token')
  if (!secretHeader || secretHeader !== cfg.webhookSecret) {
    console.warn(`[telegram] Invalid secret for agent ${agentId}`)
    return NextResponse.json({ ok: false }, { status: 403 })
  }

  // 3. Parse update
  let update: any
  try { update = await request.json() } catch { return NextResponse.json({ ok: true }) }

  const msg = update?.message
  if (!msg?.text) return NextResponse.json({ ok: true })

  // 4. Deduplicate — Telegram retries on slow responses
  const updateId: number = update.update_id
  const acquired = await redisCmd(['SET', dedupKey(agentId, updateId), '1', 'NX', 'EX', 120])
  if (!acquired) {
    console.log(`[telegram] Duplicate update_id ${updateId} — skipping`)
    return NextResponse.json({ ok: true })
  }

  const chatId: number = msg.chat.id
  const userText: string = msg.text.trim()
  const fromUser = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || `user ${msg.from?.id}`)

  console.log(`[telegram] agent=${agentId} from=${fromUser} "${userText.slice(0, 60)}"`)

  // 5. /reset — clear conversation history
  if (userText === '/reset' || userText === '/start') {
    await redisCmd(['DEL', histKey(agentId, chatId)])
    await sendTelegramMessage(cfg, chatId, 'Chat cleared! Ask me anything.')
    return NextResponse.json({ ok: true })
  }

  // 6. Typing indicator
  fetch(`https://api.telegram.org/bot${cfg.botToken}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  }).catch(() => {})

  // 7. Build system prompt
  const agentData = agent as any
  const name = agentData.name || 'Agent'
  const symbol = agentData.symbol || 'AGENT'
  const personality = agentData.personality || ''
  const skills = Array.isArray(agentData.skills) ? agentData.skills.join(', ') : 'general'

  const systemPrompt = `You are **${name}** ($${symbol}), an AI agent on The Odyssey — a Sui blockchain DeFi launchpad.${personality ? `\n\nPersonality: ${personality}` : ''}
Skills: ${skills}

## YOUR TOOLS — USE THEM
You have real-time tools. When asked about prices, RSI, news, or any factual data, CALL the tool — do NOT say you can't access it.

- get_crypto_prices — live prices (BTC, ETH, SOL, SUI, etc.)
- get_technical_indicators — RSI(14) and technical analysis
- get_crypto_news — latest crypto news
- web_search — search anything on the internet

CRITICAL: Always call the appropriate tool for market data. Never deflect or guess.`

  // 8. Fetch conversation history from Redis
  const histRaw: string[] | null = await redisCmd(['LRANGE', histKey(agentId, chatId), 0, 9])
  const histMessages: ChatMsg[] = []
  if (histRaw?.length) {
    try {
      const parsed = histRaw
        .map(r => JSON.parse(r))
        .reverse()   // LPUSH = newest first → reverse to chronological
        .slice(-6)   // last 3 exchanges (6 messages)
      for (const h of parsed) {
        if (h.role && h.content) histMessages.push({ role: h.role, content: h.content })
      }
    } catch {}
  }

  // 9. Call MiniMax directly — no worker queue to avoid rate-limit cascade
  const messages: ChatMsg[] = [
    { role: 'system', content: systemPrompt },
    ...histMessages,
    { role: 'user', content: userText },
  ]

  const reply = await callMiniMax(messages)

  // 10. Save exchange to history
  await redisCmd(['LPUSH', histKey(agentId, chatId), JSON.stringify({ role: 'user', content: userText })])
  await redisCmd(['LPUSH', histKey(agentId, chatId), JSON.stringify({ role: 'assistant', content: reply })])
  await redisCmd(['LTRIM', histKey(agentId, chatId), 0, 19])

  // 11. Send reply — split if over Telegram's 4096 char limit
  const MAX_TG_LEN = 4096
  for (let i = 0; i < reply.length; i += MAX_TG_LEN) {
    await sendTelegramMessage(cfg, chatId, reply.slice(i, i + MAX_TG_LEN))
  }

  console.log(`[telegram] Replied to ${fromUser} (${reply.length} chars)`)
  return NextResponse.json({ ok: true })
}
