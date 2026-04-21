/**
 * Culture (Airdrops) — shared constants + on-chain helpers.
 *
 * Contract layout note: `Gift` is a non-generic shared object. The coin
 * lives on a **dynamic field** named `"balance"` attached to the gift's
 * UID (`df::add(&mut gift.id, b"balance", Balance<A>)`), so the coin
 * type is only visible via `getDynamicFields`, not the gift object's
 * own `content.fields`.
 */

import { SuiClient } from '@mysten/sui/client'

// ── Addresses (mainnet) ──────────────────────────────────────────────────
export const CULTURE_ORIG_PKG   = '0xc8a3c68f5703bcd41021abe2537d084a7f4f984e9db94f9c328024be6e38cf45'
export const CULTURE_LATEST_PKG = '0x1cfef124e33d31ed662ab74c15654fdcc95a410a84faaac301706ed63a1efafe'

export const CULTURE_CONFIG_ID = (
  process.env.NEXT_PUBLIC_CULTURE_CONFIG_ID
  || '0x81983380c48232e50cbbe115217635adbbc6278cb555e0a79488b11ec15cda0a'
).trim()

export const SUI_CLOCK   = '0x0000000000000000000000000000000000000000000000000000000000000006'
export const SUI_COIN_TYPE  = '0x2::sui::SUI'
export const AIDA_COIN_TYPE = '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'
export const USDC_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

export interface CultureTokenOption {
  symbol: string
  type: string
  decimals: number
  label: string
}

export const CULTURE_TOKENS: CultureTokenOption[] = [
  { symbol: 'SUI',  type: SUI_COIN_TYPE,  decimals: 9, label: 'SUI'  },
  { symbol: 'AIDA', type: AIDA_COIN_TYPE, decimals: 9, label: 'AIDA' },
  { symbol: 'USDC', type: USDC_COIN_TYPE, decimals: 6, label: 'USDC' },
]

// ── Coin-type normalisation ──────────────────────────────────────────────

export function normalizeCoinType(raw: unknown): string {
  if (raw == null) return ''
  let s: string
  if (typeof raw === 'string') {
    s = raw
  } else if (typeof raw === 'object' && raw !== null) {
    const asAny = raw as any
    if (typeof asAny.name === 'string') s = asAny.name
    else if (Array.isArray(asAny) || ArrayBuffer.isView(asAny)) {
      try { s = new TextDecoder().decode(new Uint8Array(asAny)) } catch { s = String(raw) }
    } else {
      s = String(raw)
    }
  } else {
    s = String(raw)
  }

  s = s.trim()
  if (!s) return ''
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1)
  const genericInner = s.match(/<(.+)>$/)?.[1]
  if (genericInner) s = genericInner

  const parts = s.split('::')
  if (parts.length < 3) return ''
  const [addr, ...rest] = parts
  const normalizedAddr = addr.startsWith('0x') ? addr : `0x${addr}`
  return [normalizedAddr, ...rest].join('::')
}

// ── Shared CoinMetadata cache ────────────────────────────────────────────

export interface TokenMeta {
  decimals: number
  symbol: string
}

const coinMetaCache = new Map<string, TokenMeta>()
for (const t of CULTURE_TOKENS) {
  coinMetaCache.set(t.type, { decimals: t.decimals, symbol: t.symbol })
}
const coinMetaInflight = new Map<string, Promise<TokenMeta>>()

export async function resolveCoinMeta(client: SuiClient, typeStr: string): Promise<TokenMeta> {
  const norm = normalizeCoinType(typeStr)
  const hit = coinMetaCache.get(norm)
  if (hit) return hit
  const existing = coinMetaInflight.get(norm)
  if (existing) return existing
  const ticker = tickerFrom(norm)
  const p = (async () => {
    try {
      const meta = await client.getCoinMetadata({ coinType: norm })
      const resolved: TokenMeta = meta
        ? { decimals: meta.decimals, symbol: tickerFrom(meta.symbol || ticker) }
        : { decimals: 9, symbol: ticker }
      coinMetaCache.set(norm, resolved)
      return resolved
    } catch {
      const fb: TokenMeta = { decimals: 9, symbol: ticker }
      coinMetaCache.set(norm, fb)
      return fb
    } finally {
      coinMetaInflight.delete(norm)
    }
  })()
  coinMetaInflight.set(norm, p)
  return p
}

export function getCachedCoinMeta(typeStr: string): TokenMeta | undefined {
  return coinMetaCache.get(normalizeCoinType(typeStr))
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function normaliseXHandle(raw: string): string {
  return raw.toLowerCase()
    .replace(/.*(?:x\.com|twitter\.com)\//, '')
    .replace(/^@/, '')
    .replace(/[/?].*$/, '')
    .trim()
}

export type RecipientKind = 'x' | 'sui' | 'unknown'

export function detectRecipientKind(raw: string): RecipientKind {
  const s = (raw || '').toLowerCase().trim()
  if (!s) return 'unknown'
  if (s.includes('x.com/') || s.includes('twitter.com/') || s.startsWith('@')) return 'x'
  if (s.endsWith('.sui')) return 'sui'
  return 'x'
}

export function canonicaliseRecipient(raw: string): { kind: RecipientKind; value: string } {
  const kind = detectRecipientKind(raw)
  if (kind === 'sui') {
    const cleaned = raw.toLowerCase().trim()
    return { kind, value: cleaned.endsWith('.sui') ? cleaned : `${cleaned}.sui` }
  }
  return { kind, value: normaliseXHandle(raw) }
}

export function recipientMatches(storedHandle: string, query: { kind: RecipientKind; value: string }): boolean {
  if (!query.value) return false
  const stored = (storedHandle || '').toLowerCase().trim()
  if (query.kind === 'sui') return stored === query.value
  return normaliseXHandle(stored) === query.value
}

export function shortenAddr(addr: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : ''
}

// Reduce a raw token identifier (full coin type, partial type, or stored
// symbol string) to a clean ticker suitable for UI display. Strips any
// `0x…::module::` prefix, drops non-alphanumeric garbage (e.g. a stray
// trailing `>` from a regex miscapture), and caps length.
export function tickerFrom(raw: string): string {
  if (!raw) return 'TOKEN'
  const tail = raw.includes('::') ? (raw.split('::').pop() || raw) : raw
  const cleaned = tail.replace(/[^A-Za-z0-9_]/g, '')
  return cleaned.slice(0, 12) || 'TOKEN'
}

export function timeUntil(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000)
  if (diff <= 0) return 'Expired'
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h ${m}m`
}

// ── Coin-type extraction from a Gift's dynamic fields ────────────────────

/**
 * The Gift contract stores its Coin as a dynamic field of type
 * `Balance<A>`. Pull the first DF whose `objectType` matches `Balance<T>`
 * and return T. Cached per-gift so repeated reads don't re-query.
 */
const giftCoinTypeCache = new Map<string, string>()
const giftCoinTypeInflight = new Map<string, Promise<string>>()

export async function fetchGiftCoinType(client: SuiClient, giftId: string): Promise<string> {
  const hit = giftCoinTypeCache.get(giftId)
  if (hit !== undefined) return hit
  const existing = giftCoinTypeInflight.get(giftId)
  if (existing) return existing

  const p = (async () => {
    try {
      const res = await client.getDynamicFields({ parentId: giftId })
      for (const f of res.data || []) {
        const ot: string = (f as any).objectType || ''
        // `objectType` is the wrapping Field<K, Balance<T>> type, so the
        // string ends in `>>`. A greedy match would keep one `>` inside
        // the capture — use non-greedy and stop at the first `>`, which
        // is always the closing bracket of Balance<…> for concrete coin
        // types (coin types never contain `>`).
        const m = ot.match(/::balance::Balance<(.+?)>/)
        if (m) {
          const coinType = normalizeCoinType(m[1])
          if (coinType) {
            giftCoinTypeCache.set(giftId, coinType)
            return coinType
          }
        }
      }
    } catch {
      // fall through — caller will fall back to whatever it has
    }
    giftCoinTypeCache.set(giftId, '')
    return ''
  })()
  giftCoinTypeInflight.set(giftId, p)
  try { return await p } finally { giftCoinTypeInflight.delete(giftId) }
}

// ── Gift types ───────────────────────────────────────────────────────────

export interface GiftEvent {
  giftId: string
  depositor: string
  recipientHandle: string
  amount: string
  tokenType: string
  tokenSymbol: string
  message: string
  expiresAt: number
  timestampMs: number
  claimed: boolean
  isExpired: boolean
}

export async function fetchGiftById(client: SuiClient, giftId: string): Promise<GiftEvent | null> {
  try {
    const [obj, tokenType] = await Promise.all([
      client.getObject({ id: giftId, options: { showContent: true, showType: true } }),
      fetchGiftCoinType(client, giftId),
    ])
    const fields = (obj.data?.content as any)?.fields
    if (!fields) return null
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = Number(fields.expires_at ?? 0)
    return {
      giftId,
      depositor:       fields.depositor,
      recipientHandle: fields.recipient_handle,
      amount:          String(fields.amount ?? '0'),
      tokenType,
      tokenSymbol:     tickerFrom(tokenType),
      message:         fields.message ?? '',
      expiresAt,
      timestampMs:     Number(fields.created_at ?? 0) * 1000,
      claimed:         !!fields.claimed,
      isExpired:       now >= expiresAt,
    }
  } catch {
    return null
  }
}

export async function fetchAllGifts(client: SuiClient): Promise<GiftEvent[]> {
  const events = await client.queryEvents({
    query: { MoveEventType: `${CULTURE_ORIG_PKG}::culture_fund::GiftDeposited` },
    limit: 100,
    order: 'descending',
  })
  const ids = events.data.map(e => (e.parsedJson as any)?.gift_id).filter(Boolean) as string[]
  if (ids.length === 0) return []

  // Hydrate object state (for `claimed`) and dynamic-field coin types in parallel.
  const [objects, coinTypes] = await Promise.all([
    client.multiGetObjects({ ids, options: { showContent: true, showType: true } }),
    Promise.all(ids.map(id => fetchGiftCoinType(client, id))),
  ])
  const now = Math.floor(Date.now() / 1000)

  return events.data.map((e, i) => {
    const p: any = e.parsedJson
    const fields = (objects[i]?.data?.content as any)?.fields
    const expiresAt = Number(p.expires_at ?? 0)
    const tokenType = coinTypes[i] || ''
    // Prefer the dynamic-field coin type (always the full `0x…::mod::T`);
    // fall back to the event's `token_type` string, which in older gifts
    // may be the entire coin type rather than just the ticker. `tickerFrom`
    // collapses either shape down to a clean symbol.
    return {
      giftId:          p.gift_id,
      depositor:       p.depositor,
      recipientHandle: p.recipient,
      amount:          String(p.amount ?? '0'),
      tokenType,
      tokenSymbol:     tokenType ? tickerFrom(tokenType) : tickerFrom(String(p.token_type ?? '')),
      message:         p.message ?? '',
      expiresAt,
      timestampMs:     Number(e.timestampMs ?? 0),
      claimed:         fields ? !!fields.claimed : false,
      isExpired:       now >= expiresAt,
    }
  })
}

export function formatAmount(raw: string | number, decimals: number): string {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return (n / Math.pow(10, decimals)).toFixed(Math.min(4, decimals))
}

export function tokenConfigFor(typeStr: string): CultureTokenOption | undefined {
  return CULTURE_TOKENS.find(t => t.type === normalizeCoinType(typeStr))
}
