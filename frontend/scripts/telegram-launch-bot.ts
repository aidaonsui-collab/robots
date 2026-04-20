/**
 * Telegram Bot — Odyssey Platform Alerts
 *
 * Monitors four event types:
 *   1. New token launches (polls /api/tokens)
 *   2. Bonding curve graduations (token hits threshold → DEX)
 *   3. Staking events (on-chain events via Sui RPC)
 *   4. Olympus presale events (created, contributions, finalized, migration)
 *
 * Setup:
 *   1. Create bot via @BotFather on Telegram → get BOT_TOKEN
 *   2. Create a channel/group, add bot as admin → get CHAT_ID
 *   3. Set env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *   4. Run: npx ts-node scripts/telegram-launch-bot.ts
 *
 * Can also run on Railway/Render as a standalone service.
 */

// ─── Config ─────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const CHAT_IDS = (process.env.TELEGRAM_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean)
const ODYSSEY_API = process.env.ODYSSEY_API_URL || 'https://www.theodyssey.fun/api/tokens'
const SUI_RPC = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io'

const TOKEN_POLL_MS = 30_000   // 30s — new launches + graduations
const STAKING_POLL_MS = 15_000 // 15s — staking events
const PRICE_CACHE_TTL = 5 * 60 * 1000 // 5 min

// On-chain package IDs (events are keyed by origin package)
const PKG_LEGACY = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'
const PKG_V11 = '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813'
const PKG_V12 = '0x95bb61b03a5d476c2621b2b3f512e8fd5f0976260ce4e8d0d9a79ca64b658f4e'

// Olympus presale package (v8 — 32-field struct)
const PKG_PRESALE = '0x4c9f2fe6a524873adea66ff6f31d6caba0df10d10ffd8b28e99d0b8e26eabc76'
const PRESALE_POLL_MS = 15_000 // 15s

// AIDA token decimals (9, same as SUI); meme tokens are 6 decimals
const AIDA_DECIMALS = 9
const MEME_DECIMALS = 6
const AIDA_COIN_TYPE = '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'

// Staking config IDs for fetching total staked
const STAKE_CFG_LEGACY = '0x312216a4b80aa2665be3539667ef3749fafb0bde8c8ff529867ca0f0dc13bc18'
const STAKE_CFG_V11 = '0x59c35bc4c50631e4d4468d9964ba23c3961e1ff8d7c6df740fcf776c8936e940'
const AIDA_POOL_LEGACY = '0x2b7c1b42426abdc1ece2cea3f564e32b7809cdcebc87d08fa56b440d9eb5c3d4'

// DexScreener pair for AIDA price + market cap
const AIDA_DEX_PAIR = '0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b'

// GIF for AIDA stake alerts — replace with your hosted URL
const STAKE_GIF_URL = process.env.STAKE_GIF_URL || 'https://image2url.com/r2/default/gifs/1775814547997-bef5e1f9-e135-4062-865d-d43aabb185c7.gif'
// GIF for per-token stake alerts (optional — falls back to text if not set)
const TOKEN_STAKE_GIF_URL = process.env.TOKEN_STAKE_GIF_URL || ''

if (!BOT_TOKEN || !CHAT_IDS.length) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars')
  process.exit(1)
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface Token {
  id: string
  poolId: string
  coinType: string
  symbol: string
  name: string
  description: string
  imageUrl?: string
  twitter?: string
  telegram?: string
  website?: string
  currentPrice: number
  marketCap: number
  realSuiSui: number
  thresholdSui: number
  progress: number
  volume1h: number
  isCompleted: boolean
  createdAt: number
  creator: string
}

interface StakeEventParsed {
  token_address: string
  staking_pool: string
  staking_account: string
  staker: string
  amount: string
  timestamp: string
}

// ─── State ──────────────────────────────────────────────────────────────────

const knownTokens = new Map<string, { isCompleted: boolean }>()
const seenStakeEvents = new Set<string>()
const seenPresaleEvents = new Set<string>()
let isFirstTokenPoll = true
let isFirstStakePoll = true
let isFirstPresalePoll = true
let isPollingStaking = false  // lock to prevent concurrent pollStaking runs
let isPollingPresale = false  // lock to prevent concurrent pollPresale runs

// Token info cache (coinType → basic metadata), refreshed alongside tokens poll
const tokenInfoCache = new Map<string, { name: string; symbol: string; imageUrl?: string; poolId: string }>()

// Price cache
let suiPriceUsd = 3.0
let aidaPriceUsd = 0.0
let aidaFdvUsd = 0.0
let priceLastFetched = 0

// ─── Price Fetching ─────────────────────────────────────────────────────────

async function refreshPrices(): Promise<void> {
  if (Date.now() - priceLastFetched < PRICE_CACHE_TTL) return
  try {
    // Fetch SUI price from CoinGecko
    const suiRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd')
    const suiData = await suiRes.json() as any
    suiPriceUsd = suiData?.sui?.usd ?? suiPriceUsd

    // Fetch AIDA price + FDV from DexScreener
    const aidaRes = await fetch(`https://api.dexscreener.com/latest/dex/pairs/sui/${AIDA_DEX_PAIR}`)
    const aidaData = await aidaRes.json() as any
    aidaPriceUsd = parseFloat(aidaData?.pair?.priceUsd || '0') || aidaPriceUsd
    aidaFdvUsd = parseFloat(aidaData?.pair?.fdv || '0') || aidaFdvUsd

    priceLastFetched = Date.now()
    console.log(`[prices] SUI=$${suiPriceUsd.toFixed(2)}, AIDA=$${aidaPriceUsd.toFixed(6)}, FDV=${formatUsd(aidaFdvUsd)}`)
  } catch (e) {
    console.error('[prices] Fetch error:', e)
  }
}

async function refreshTokenCache(): Promise<void> {
  try {
    const res = await fetch(ODYSSEY_API)
    if (!res.ok) return
    const tokens: Token[] = await res.json()
    for (const t of tokens) {
      tokenInfoCache.set(t.coinType, { name: t.name, symbol: t.symbol, imageUrl: t.imageUrl, poolId: t.poolId })
    }
  } catch (e) {
    console.error('[token-cache] refresh error:', e)
  }
}

async function getTotalStaked(): Promise<number> {
  try {
    let total = 0

    // Legacy pool
    const legacyObj = await suiRpc('sui_getObject', [AIDA_POOL_LEGACY, { showContent: true }])
    const legacyFields = legacyObj?.data?.content?.fields
    if (legacyFields) {
      const raw = legacyFields.total_supply ?? legacyFields.total_staked
        ?? (typeof legacyFields.balance === 'object' ? legacyFields.balance?.fields?.value : legacyFields.balance)
        ?? 0
      total += Number(raw)
    }

    // V11 pool — find AIDA pool from dynamic fields
    const dynFields = await suiRpc('suix_getDynamicFields', [STAKE_CFG_V11, null, 50])
    const aidaPool = (dynFields?.data ?? []).find((p: any) =>
      p.objectType?.includes('StakingPool') && p.objectType?.includes('aida::AIDA')
    )
    if (aidaPool?.objectId) {
      const v11Obj = await suiRpc('sui_getObject', [aidaPool.objectId, { showContent: true }])
      const v11Fields = v11Obj?.data?.content?.fields
      if (v11Fields) {
        const raw = v11Fields.total_supply ?? v11Fields.total_staked
          ?? (typeof v11Fields.balance === 'object' ? v11Fields.balance?.fields?.value : v11Fields.balance)
          ?? 0
        total += Number(raw)
      }
    }

    return total
  } catch (e) {
    console.error('[staking] getTotalStaked error:', e)
    return 0
  }
}

// ─── Telegram ───────────────────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<void> {
  for (const chatId of CHAT_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      })
      if (!res.ok) {
        console.error(`Telegram API error (${chatId}):`, await res.text())
      }
    } catch (e) {
      console.error(`Failed to send message to ${chatId}:`, e)
    }
  }
}

async function sendTelegramPhoto(imageUrl: string, caption: string): Promise<void> {
  for (const chatId of CHAT_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: imageUrl,
          caption,
          parse_mode: 'HTML',
        }),
      })
      if (!res.ok) {
        console.error(`sendPhoto failed (${chatId}), falling back to text:`, await res.text())
        await sendTelegramToOne(chatId, caption)
      }
    } catch (e) {
      console.error(`sendPhoto error (${chatId}), falling back to text:`, e)
      await sendTelegramToOne(chatId, caption)
    }
  }
}

/** Send a GIF/animation with caption. Falls back to text-only if it fails. */
async function sendTelegramAnimation(animationUrl: string, caption: string): Promise<void> {
  for (const chatId of CHAT_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendAnimation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          animation: animationUrl,
          caption,
          parse_mode: 'HTML',
        }),
      })
      if (!res.ok) {
        console.error(`sendAnimation failed (${chatId}), falling back to text:`, await res.text())
        await sendTelegramToOne(chatId, caption)
      }
    } catch (e) {
      console.error(`sendAnimation error (${chatId}), falling back to text:`, e)
      await sendTelegramToOne(chatId, caption)
    }
  }
}

async function sendTelegramToOne(chatId: string, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }),
    })
  } catch {}
}

// ─── Sui RPC Helper ─────────────────────────────────────────────────────────

async function suiRpc(method: string, params: any[]): Promise<any> {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json()
  return json.result
}

async function queryEvents(eventType: string, limit: number = 50): Promise<any[]> {
  const result = await suiRpc('suix_queryEvents', [
    { MoveEventType: eventType },
    null,
    limit,
    true,
  ])
  return result?.data ?? []
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || 'Unknown'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatTokenName(typeAddr: string): string {
  const parts = typeAddr.split('::')
  return parts.length >= 3 ? parts[2] : typeAddr
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n > 0) return `$${n.toFixed(4)}`
  return '$0.00'
}

function formatAmount(raw: string | number, decimals: number): string {
  const n = Number(raw) / 10 ** decimals
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function progressBar(pct: number): string {
  const filled = Math.min(Math.round(pct / 10), 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

/** Format tiny prices readably — e.g. 0.0000003140 → "$0.0000003140" (never scientific notation) */
function formatPrice(n: number, prefix: string = '$'): string {
  if (n === 0) return `${prefix}0.00`
  if (n >= 1) return `${prefix}${n.toFixed(4)}`
  if (n >= 0.0001) return `${prefix}${n.toFixed(6)}`
  // For very small numbers, show all significant zeros + 4 sig digits
  const str = n.toFixed(20)
  const match = str.match(/^0\.(0*)(\d{4})/)
  if (match) {
    return `${prefix}0.${match[1]}${match[2]}`
  }
  return `${prefix}${n.toFixed(10)}`
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatLaunchAlert(token: Token): string {
  const priceSui = formatPrice(token.currentPrice, '')  + ' SUI'
  const priceUsdVal = token.currentPrice * suiPriceUsd
  const priceUsd = formatPrice(priceUsdVal)
  const mcapUsd = formatUsd(token.marketCap * suiPriceUsd)
  const targetUsd = formatUsd(token.thresholdSui * suiPriceUsd)
  const raisedUsd = formatUsd(token.realSuiSui * suiPriceUsd)

  let socials = ''
  if (token.website) socials += `🌐 <a href="${token.website}">Website</a>  `
  if (token.twitter) socials += `🐦 <a href="https://x.com/${token.twitter.replace('@', '')}">Twitter</a>  `
  if (token.telegram) socials += `💬 <a href="https://t.me/${token.telegram.replace('@', '')}">Telegram</a>`

  return [
    `🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀`,
    ``,
    `🆕 <b>NEW TOKEN LAUNCH</b> 🆕`,
    ``,
    `<b>${token.name}</b> ($${token.symbol})`,
    ``,
    `💰 Price: ${priceSui} SUI (${priceUsd})`,
    `📊 Market Cap: ${mcapUsd}`,
    `🎯 Target: ${token.thresholdSui.toLocaleString()} SUI (${targetUsd})`,
    `💵 Raised: ${token.realSuiSui.toFixed(2)} SUI (${raisedUsd})`,
    `📈 Progress: ${token.progress.toFixed(1)}%`,
    `${progressBar(token.progress)}`,
    `👤 Creator: <a href="https://suivision.xyz/account/${token.creator}">${shortAddr(token.creator)}</a>`,
    ``,
    token.description ? `<i>${token.description.slice(0, 200)}</i>` : '',
    ``,
    socials ? socials : '',
    ``,
    `🔗 <a href="https://www.theodyssey.fun/bondingcurve/coins/${token.poolId}">Trade on Odyssey</a>`,
  ].filter(Boolean).join('\n')
}

function formatGraduationAlert(token: Token): string {
  const mcapUsd = formatUsd(token.marketCap * suiPriceUsd)
  const thresholdUsd = formatUsd(token.thresholdSui * suiPriceUsd)
  const priceSui = formatPrice(token.currentPrice, '') + ' SUI'
  const priceUsd = formatPrice(token.currentPrice * suiPriceUsd)

  return [
    `🎓🎓🎓🎓🎓🎓🎓🎓🎓🎓🎓🎓🎓`,
    ``,
    `🏆 <b>TOKEN GRADUATED TO DEX!</b> 🏆`,
    ``,
    `<b>${token.name}</b> ($${token.symbol})`,
    ``,
    `✅ Bonding curve completed!`,
    `💰 Threshold: ${token.thresholdSui.toLocaleString()} SUI (${thresholdUsd})`,
    `📊 Price: ${priceSui} (${priceUsd})`,
    `📈 Market Cap: ${mcapUsd}`,
    ``,
    `Now trading on DEX 🔄`,
    ``,
    `🔗 <a href="https://www.theodyssey.fun/bondingcurve/coins/${token.poolId}">View on Odyssey</a>`,
  ].join('\n')
}

async function formatStakeAlert(event: StakeEventParsed): Promise<string> {
  const tokenName = formatTokenName(event.token_address)
  const amountRaw = Number(event.amount)
  const amountHuman = amountRaw / 10 ** AIDA_DECIMALS
  const amountStr = formatAmount(event.amount, AIDA_DECIMALS)
  const amountUsd = formatUsd(amountHuman * aidaPriceUsd)

  // Fetch total staked
  const totalStakedRaw = await getTotalStaked()
  const totalStakedHuman = totalStakedRaw / 10 ** AIDA_DECIMALS
  const totalStakedStr = formatAmount(totalStakedRaw.toString(), AIDA_DECIMALS)
  const totalStakedUsd = formatUsd(totalStakedHuman * aidaPriceUsd)

  const aidaPriceStr = aidaPriceUsd > 0 ? `$${aidaPriceUsd.toFixed(6)}` : 'N/A'
  const mcapStr = aidaFdvUsd > 0 ? formatUsd(aidaFdvUsd) : 'N/A'

  return [
    `💲💲💲💲💲💲💲💲💲💲💲💲💲`,
    ``,
    `💲 <b>NEW STAKE</b> 💲`,
    ``,
    `💰 ${amountStr} ${tokenName} (${amountUsd})`,
    `👤 <a href="https://suivision.xyz/account/${event.staker}">${shortAddr(event.staker)}</a>`,
    `📊 Total Staked: ${totalStakedStr} ${tokenName} (${totalStakedUsd})`,
    `💲 ${tokenName} Price: ${aidaPriceStr}`,
    `📈 Market Cap: ${mcapStr}`,
    ``,
    `🔗 <a href="https://suivision.xyz/txblock/${event.staking_account}">Explorer</a>`,
    `💲 <a href="https://www.theodyssey.fun/staking">Stake ${tokenName}</a>`,
  ].join('\n')
}

async function formatTokenStakeAlert(event: StakeEventParsed): Promise<string> {
  const tokenInfo = tokenInfoCache.get(event.token_address)
  const symbol = tokenInfo?.symbol || formatTokenName(event.token_address)
  const name = tokenInfo?.name || symbol
  const amountStr = formatAmount(event.amount, MEME_DECIMALS)
  const poolId = tokenInfo?.poolId || ''

  return [
    `🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙`,
    ``,
    `🪙 <b>TOKEN STAKED</b> 🪙`,
    ``,
    `<b>${name}</b> ($${symbol})`,
    ``,
    `💰 ${amountStr} $${symbol} staked`,
    `👤 <a href="https://suivision.xyz/account/${event.staker}">${shortAddr(event.staker)}</a>`,
    ``,
    poolId ? `🔗 <a href="https://www.theodyssey.fun/bondingcurve/coins/${poolId}">View on Odyssey</a>` : `🔗 <a href="https://www.theodyssey.fun/bondingcurve">Odyssey</a>`,
  ].join('\n')
}

// ─── Olympus Presale Formatters ─────────────────────────────────────────────

function formatPresaleCreatedAlert(e: any): string {
  const name = e.name || 'Unknown'
  const symbol = e.symbol || '???'
  const priceSui = Number(e.price_per_token_mist || 0) / 1e9
  const minRaiseSui = Number(e.min_raise_mist || 0) / 1e9
  const maxRaiseSui = Number(e.max_raise_mist || 0) / 1e9
  const startMs = Number(e.start_time_ms || 0)
  const endMs = Number(e.end_time_ms || 0)
  const durationHrs = (endMs - startMs) / (1000 * 60 * 60)
  const presalePct = Number(e.presale_bps || 0) / 100
  const liqPct = Number(e.liquidity_bps || 0) / 100
  const creatorPct = 100 - presalePct - liqPct
  const presaleId = e.presale_id || ''

  const startDate = new Date(startMs).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })

  return [
    `⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡`,
    ``,
    `🏛️ <b>NEW OLYMPUS PRESALE</b> 🏛️`,
    ``,
    `<b>${name}</b> ($${symbol})`,
    ``,
    `💰 Price: ${priceSui.toFixed(6)} SUI`,
    `🎯 Raise: ${minRaiseSui.toLocaleString()} – ${maxRaiseSui.toLocaleString()} SUI`,
    `⏱ Duration: ${durationHrs.toFixed(1)}h`,
    `📅 Starts: ${startDate} UTC`,
    `📊 Split: ${presalePct}% sale / ${liqPct}% liq / ${creatorPct}% creator`,
    `👤 Creator: <a href="https://suivision.xyz/account/${e.creator}">${shortAddr(e.creator || '')}</a>`,
    ``,
    `🔗 <a href="https://www.theodyssey.fun/olympus/${presaleId}">View on Olympus</a>`,
  ].join('\n')
}

function formatContributionAlert(e: any, presaleName: string): string {
  const suiAmount = Number(e.sui_amount || 0) / 1e9
  const totalRaised = Number(e.total_raised || 0) / 1e9
  const totalRaisedUsd = formatUsd(totalRaised * suiPriceUsd)
  const count = Number(e.contributor_count || 0)
  const presaleId = e.presale_id || ''

  return [
    `🏛️ <b>OLYMPUS CONTRIBUTION</b>`,
    ``,
    `💰 ${suiAmount.toFixed(2)} SUI → <b>${presaleName}</b>`,
    `👤 <a href="https://suivision.xyz/account/${e.contributor}">${shortAddr(e.contributor || '')}</a>`,
    `📊 Total Raised: ${totalRaised.toFixed(2)} SUI (${totalRaisedUsd})`,
    `👥 Contributors: ${count}`,
    ``,
    `🔗 <a href="https://www.theodyssey.fun/olympus/${presaleId}">View Presale</a>`,
  ].join('\n')
}

function formatPresaleFinalizedAlert(e: any, presaleName: string): string {
  const status = Number(e.status || 0)
  const totalRaised = Number(e.total_raised || 0) / 1e9
  const totalRaisedUsd = formatUsd(totalRaised * suiPriceUsd)
  const count = Number(e.contributor_count || 0)
  const presaleId = e.presale_id || ''
  const isSuccess = status === 2

  if (isSuccess) {
    return [
      `🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆`,
      ``,
      `🏛️ <b>OLYMPUS PRESALE SUCCESSFUL!</b> 🏛️`,
      ``,
      `<b>${presaleName}</b>`,
      ``,
      `✅ Minimum raise met!`,
      `💰 Total Raised: ${totalRaised.toFixed(2)} SUI (${totalRaisedUsd})`,
      `👥 Contributors: ${count}`,
      ``,
      `⏳ DEX migration pending...`,
      ``,
      `🔗 <a href="https://www.theodyssey.fun/olympus/${presaleId}">Claim Tokens</a>`,
    ].join('\n')
  } else {
    return [
      `❌ <b>OLYMPUS PRESALE FAILED</b>`,
      ``,
      `<b>${presaleName}</b>`,
      ``,
      `Minimum raise was not met.`,
      `💰 Raised: ${totalRaised.toFixed(2)} SUI (${totalRaisedUsd})`,
      `👥 Contributors: ${count}`,
      ``,
      `🔗 <a href="https://www.theodyssey.fun/olympus/${presaleId}">Refund SUI</a>`,
    ].join('\n')
  }
}

function formatPresaleMigratingAlert(e: any, presaleName: string): string {
  const suiAmount = Number(e.sui_amount || 0) / 1e9
  const suiUsd = formatUsd(suiAmount * suiPriceUsd)
  const presaleId = e.presale_id || ''

  return [
    `🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀`,
    ``,
    `🏛️ <b>OLYMPUS → MOMENTUM DEX</b> 🏛️`,
    ``,
    `<b>${presaleName}</b> has graduated!`,
    ``,
    `💰 Liquidity: ${suiAmount.toFixed(2)} SUI (${suiUsd})`,
    `🔄 Now trading on Momentum DEX`,
    ``,
    `🔗 <a href="https://www.theodyssey.fun/olympus/${presaleId}">View Token</a>`,
  ].join('\n')
}

// ─── Poll: Tokens (launches + graduations) ──────────────────────────────────

async function pollTokens(): Promise<void> {
  try {
    await refreshPrices()

    const res = await fetch(ODYSSEY_API)
    if (!res.ok) {
      console.error(`[tokens] API returned ${res.status}`)
      return
    }

    const tokens: Token[] = await res.json()

    // Always keep token cache fresh for per-token stake alert lookups
    for (const t of tokens) {
      tokenInfoCache.set(t.coinType, { name: t.name, symbol: t.symbol, imageUrl: t.imageUrl, poolId: t.poolId })
    }

    if (isFirstTokenPoll) {
      for (const t of tokens) {
        knownTokens.set(t.poolId, { isCompleted: t.isCompleted })
      }
      console.log(`[tokens] Seeded ${knownTokens.size} existing tokens, ${tokenInfoCache.size} in cache`)
      isFirstTokenPoll = false
      return
    }

    for (const token of tokens) {
      const prev = knownTokens.get(token.poolId)

      if (!prev) {
        console.log(`[launch] ${token.name} ($${token.symbol})`)
        knownTokens.set(token.poolId, { isCompleted: token.isCompleted })
        const caption = formatLaunchAlert(token)
        if (token.imageUrl) {
          await sendTelegramPhoto(token.imageUrl, caption)
        } else {
          await sendTelegram(caption)
        }
      } else if (!prev.isCompleted && token.isCompleted) {
        console.log(`[graduated] ${token.name} ($${token.symbol})`)
        knownTokens.set(token.poolId, { isCompleted: true })
        const caption = formatGraduationAlert(token)
        if (token.imageUrl) {
          await sendTelegramPhoto(token.imageUrl, caption)
        } else {
          await sendTelegram(caption)
        }
      } else {
        knownTokens.set(token.poolId, { isCompleted: token.isCompleted })
      }
    }
  } catch (e) {
    console.error('[tokens] Poll error:', e)
  }
}

// ─── Poll: Staking Events (on-chain) ────────────────────────────────────────

async function pollStaking(): Promise<void> {
  // Prevent concurrent runs — if previous poll is still sending alerts, skip
  if (isPollingStaking) return
  isPollingStaking = true
  try {
    const [stakeLegacy, stakeV11, stakeV12] = await Promise.all([
      queryEvents(`${PKG_LEGACY}::moonbags_stake::StakeEvent`, 20),
      queryEvents(`${PKG_V11}::moonbags_stake::StakeEvent`, 20),
      queryEvents(`${PKG_V12}::moonbags_stake::StakeEvent`, 20),
    ])

    // Merge and aggressively deduplicate by txDigest BEFORE processing
    const allRaw = [...stakeLegacy, ...stakeV11, ...stakeV12]
    const txDigestSeen = new Set<string>()
    const allStakes: any[] = []
    for (const event of allRaw) {
      const tx = event.id?.txDigest
      if (tx) {
        if (txDigestSeen.has(tx)) continue
        txDigestSeen.add(tx)
      }
      allStakes.push(event)
    }

    console.log(`[staking] legacy=${stakeLegacy.length}, v11=${stakeV11.length}, v12=${stakeV12.length}, after dedup=${allStakes.length}`)

    if (isFirstStakePoll) {
      for (const e of allStakes) {
        const key = e.id?.txDigest || `${e.parsedJson?.staker}:${e.parsedJson?.amount}`
        seenStakeEvents.add(key)
      }
      console.log(`[staking] Seeded ${seenStakeEvents.size} existing events`)
      isFirstStakePoll = false
      return
    }

    for (const event of allStakes.reverse()) {
      const key = event.id?.txDigest || `${event.parsedJson?.staker}:${event.parsedJson?.amount}`
      if (seenStakeEvents.has(key)) continue
      seenStakeEvents.add(key)

      const e = event.parsedJson as StakeEventParsed
      const isAida = e.token_address === AIDA_COIN_TYPE || e.token_address?.endsWith('::aida::AIDA')
      console.log(`[stake] NEW: tx=${event.id?.txDigest?.slice(0,12)}, token=${isAida ? 'AIDA' : formatTokenName(e.token_address)}, staker=${shortAddr(e.staker)}`)
      await refreshPrices()

      if (isAida) {
        const msg = await formatStakeAlert(e)
        if (STAKE_GIF_URL) {
          await sendTelegramAnimation(STAKE_GIF_URL, msg)
        } else {
          await sendTelegram(msg)
        }
      } else {
        const tokenInfo = tokenInfoCache.get(e.token_address)
        const msg = await formatTokenStakeAlert(e)
        if (TOKEN_STAKE_GIF_URL) {
          await sendTelegramAnimation(TOKEN_STAKE_GIF_URL, msg)
        } else if (tokenInfo?.imageUrl?.startsWith('http')) {
          await sendTelegramPhoto(tokenInfo.imageUrl, msg)
        } else {
          await sendTelegram(msg)
        }
      }
    }

    if (seenStakeEvents.size > 5000) {
      const arr = Array.from(seenStakeEvents)
      const toDelete = arr.slice(0, arr.length - 3000)
      for (const k of toDelete) seenStakeEvents.delete(k)
    }
  } catch (e) {
    console.error('[staking] Poll error:', e)
  } finally {
    isPollingStaking = false
  }
}

// ─── Poll: Olympus Presale Events (on-chain) ──────────────────────────────

// Cache presale names from PresaleCreatedEvent so contribution/finalize alerts can show the name
const presaleNames = new Map<string, string>()

async function pollPresale(): Promise<void> {
  if (isPollingPresale) return
  isPollingPresale = true
  try {
    // Query all 4 event types
    const eventType = `${PKG_PRESALE}::presale::PresaleCreatedEvent`
    const [created, contributions, finalized, migrating] = await Promise.all([
      queryEvents(eventType, 20),
      queryEvents(`${PKG_PRESALE}::presale::ContributionEvent`, 30),
      queryEvents(`${PKG_PRESALE}::presale::PresaleFinalizedEvent`, 10),
      queryEvents(`${PKG_PRESALE}::presale::PresaleMigratingEvent`, 10),
    ])
    if (isFirstPresalePoll) {
      console.log(`[presale] Querying event type: ${eventType}`)
      if (created.length === 0) console.log(`[presale] WARNING: No PresaleCreatedEvent found — verify package ID is correct`)
    }

    // Merge all events, dedup by txDigest
    const allRaw = [
      ...created.map((e: any) => ({ ...e, _type: 'created' })),
      ...contributions.map((e: any) => ({ ...e, _type: 'contribution' })),
      ...finalized.map((e: any) => ({ ...e, _type: 'finalized' })),
      ...migrating.map((e: any) => ({ ...e, _type: 'migrating' })),
    ]

    const txDigestSeen = new Set<string>()
    const allEvents: any[] = []
    for (const event of allRaw) {
      const tx = event.id?.txDigest
      if (tx) {
        if (txDigestSeen.has(tx + event._type)) continue
        txDigestSeen.add(tx + event._type)
      }
      allEvents.push(event)
    }

    console.log(`[presale] created=${created.length}, contributions=${contributions.length}, finalized=${finalized.length}, migrating=${migrating.length}, after dedup=${allEvents.length}`)

    // Seed presale names from created events (always, not just first poll)
    for (const event of created) {
      const e = event.parsedJson
      if (e?.presale_id && e?.name) {
        presaleNames.set(e.presale_id, `${e.name} ($${e.symbol})`)
      }
    }

    if (isFirstPresalePoll) {
      for (const event of allEvents) {
        const key = (event.id?.txDigest || '') + ':' + event._type
        seenPresaleEvents.add(key)
      }
      console.log(`[presale] Seeded ${seenPresaleEvents.size} existing events`)
      isFirstPresalePoll = false
      return
    }

    // Process new events (oldest first)
    for (const event of allEvents.reverse()) {
      const key = (event.id?.txDigest || '') + ':' + event._type
      if (seenPresaleEvents.has(key)) continue
      seenPresaleEvents.add(key)

      const e = event.parsedJson
      if (!e) continue

      const name = presaleNames.get(e.presale_id) || 'Unknown Presale'

      await refreshPrices()

      switch (event._type) {
        case 'created': {
          console.log(`[presale] NEW PRESALE: ${e.name} ($${e.symbol})`)
          const msg = formatPresaleCreatedAlert(e)
          if (e.uri) {
            await sendTelegramPhoto(e.uri, msg)
          } else {
            await sendTelegram(msg)
          }
          break
        }
        case 'contribution': {
          const suiAmt = Number(e.sui_amount || 0) / 1e9
          console.log(`[presale] CONTRIBUTION: ${suiAmt.toFixed(2)} SUI to ${name}`)
          const msg = formatContributionAlert(e, name)
          await sendTelegram(msg)
          break
        }
        case 'finalized': {
          const status = Number(e.status || 0)
          console.log(`[presale] FINALIZED: ${name} → ${status === 2 ? 'SUCCESS' : 'FAILED'}`)
          const msg = formatPresaleFinalizedAlert(e, name)
          await sendTelegram(msg)
          break
        }
        case 'migrating': {
          console.log(`[presale] MIGRATING: ${name} → Momentum DEX`)
          const msg = formatPresaleMigratingAlert(e, name)
          await sendTelegram(msg)
          break
        }
      }
    }

    // Cleanup old events
    if (seenPresaleEvents.size > 5000) {
      const arr = Array.from(seenPresaleEvents)
      const toDelete = arr.slice(0, arr.length - 3000)
      for (const k of toDelete) seenPresaleEvents.delete(k)
    }
  } catch (e) {
    console.error('[presale] Poll error:', e)
  } finally {
    isPollingPresale = false
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Odyssey Alert Bot started`)
  console.log(`  Tokens:  ${ODYSSEY_API} every ${TOKEN_POLL_MS / 1000}s`)
  console.log(`  Staking: ${SUI_RPC} every ${STAKING_POLL_MS / 1000}s`)
  console.log(`  Presale: ${PKG_PRESALE} every ${PRESALE_POLL_MS / 1000}s`)
  console.log(`  Chats:   ${CHAT_IDS.join(', ')}`)
  console.log(`Alerts: new launches, graduations, stakes, presales`)

  await refreshPrices()
  await Promise.all([pollTokens(), pollStaking(), pollPresale()])

  console.log(`[ready] Monitoring started\n`)

  setInterval(pollTokens, TOKEN_POLL_MS)
  setInterval(pollStaking, STAKING_POLL_MS)
  setInterval(pollPresale, PRESALE_POLL_MS)
}

main().catch(console.error)
