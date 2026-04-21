/**
 * Culture (Airdrops) — shared constants + on-chain helpers.
 *
 * The Culture Fund contract lets a sender lock tokens on-chain keyed to an
 * X handle; the recipient proves ownership via X OAuth and claims the gift
 * from their connected wallet. 48-hour expiry, 2% platform fee.
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
// Sui emits TypeName values in events without the `0x` prefix on the
// address, e.g. `deeb7a4a…::deep::DEEP`. Pass those straight into
// `getCoinMetadata` and the RPC rejects them. Normalise at every read
// boundary so downstream code can trust the form.

export function normalizeCoinType(raw: string): string {
  if (!raw) return raw
  const parts = raw.split('::')
  if (parts.length < 3) return raw
  const [addr, ...rest] = parts
  const normalizedAddr = addr.startsWith('0x') ? addr : `0x${addr}`
  return [normalizedAddr, ...rest].join('::')
}

// ── Shared CoinMetadata cache ────────────────────────────────────────────
// Process-wide cache so SendForm, display components and the claim page
// all share one source of truth for a coin's decimals + symbol.

export interface TokenMeta {
  decimals: number
  symbol: string
}

const coinMetaCache = new Map<string, TokenMeta>()
for (const t of CULTURE_TOKENS) {
  coinMetaCache.set(t.type, { decimals: t.decimals, symbol: t.symbol })
}
const coinMetaInflight = new Map<string, Promise<TokenMeta>>()

/**
 * Resolve a coin type's decimals + symbol from on-chain CoinMetadata,
 * cached process-wide. Falls back to 9 decimals + the last type segment
 * as the symbol when the chain has no CoinMetadata for this type.
 */
export async function resolveCoinMeta(client: SuiClient, typeStr: string): Promise<TokenMeta> {
  const norm = normalizeCoinType(typeStr)
  const hit = coinMetaCache.get(norm)
  if (hit) return hit
  const existing = coinMetaInflight.get(norm)
  if (existing) return existing
  const lastSeg = norm.split('::').pop() || 'TOKEN'
  const p = (async () => {
    try {
      const meta = await client.getCoinMetadata({ coinType: norm })
      const resolved: TokenMeta = meta
        ? { decimals: meta.decimals, symbol: meta.symbol || lastSeg }
        : { decimals: 9, symbol: lastSeg }
      coinMetaCache.set(norm, resolved)
      return resolved
    } catch {
      const fb: TokenMeta = { decimals: 9, symbol: lastSeg }
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

/** Strip @, full URL wrappers, query strings, and lowercase. */
export function normaliseXHandle(raw: string): string {
  return raw.toLowerCase()
    .replace(/.*(?:x\.com|twitter\.com)\//, '')
    .replace(/^@/, '')
    .replace(/[/?].*$/, '')
    .trim()
}

/** Recipient-handle kind, inferred from the stored string. */
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

export function timeUntil(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000)
  if (diff <= 0) return 'Expired'
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h ${m}m`
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
    const obj = await client.getObject({ id: giftId, options: { showContent: true, showType: true } })
    const fields = (obj.data?.content as any)?.fields
    if (!fields) return null
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = Number(fields.expires_at ?? 0)
    // Object responses expose the full type at both `data.type` and
    // `data.content.type` — fall through so a future SDK tweak doesn't
    // drop the generic parameter we need.
    const typeStr: string =
      (obj.data?.content as any)?.type ||
      (obj.data as any)?.type ||
      ''
    const generic = typeStr.match(/<(.+)>$/)?.[1] || ''
    const tokenType = normalizeCoinType(generic)
    const tokenParts = tokenType.split('::')
    return {
      giftId,
      depositor:       fields.depositor,
      recipientHandle: fields.recipient_handle,
      amount:          String(fields.amount ?? '0'),
      tokenType,
      tokenSymbol:     tokenParts[tokenParts.length - 1] || 'TOKEN',
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
  const objects = await client.multiGetObjects({ ids, options: { showContent: true, showType: true } })
  const now = Math.floor(Date.now() / 1000)

  return events.data.map((e, i) => {
    const p: any = e.parsedJson
    const fields = (objects[i]?.data?.content as any)?.fields
    const expiresAt = Number(p.expires_at ?? 0)
    const tokenType = normalizeCoinType(String(p.token_type ?? ''))
    const tokenParts = tokenType.split('::')
    return {
      giftId:          p.gift_id,
      depositor:       p.depositor,
      recipientHandle: p.recipient,
      amount:          String(p.amount ?? '0'),
      tokenType,
      tokenSymbol:     tokenParts[tokenParts.length - 1] || 'TOKEN',
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
