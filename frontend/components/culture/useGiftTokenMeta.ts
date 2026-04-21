'use client'

import { useEffect, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { CULTURE_TOKENS, KNOWN_COIN_META, GiftEvent, normalizeCoinType, tickerFrom } from '@/lib/culture'

export interface TokenMeta {
  decimals: number
  symbol: string
}

const cache = new Map<string, TokenMeta>()
for (const t of CULTURE_TOKENS) {
  cache.set(t.type, { decimals: t.decimals, symbol: t.symbol })
}
// Safety net — ensures popular non-9-decimal coins (e.g. DEEP) render
// correctly even when the fullnode's CoinMetadata endpoint 404s.
// Seed under the normalised key so lookups (which always normalise)
// never miss due to an address-format drift.
for (const k of KNOWN_COIN_META) {
  const key = normalizeCoinType(k.type)
  if (key && !cache.has(key)) {
    cache.set(key, { decimals: k.decimals, symbol: k.symbol })
  }
}

export function useGiftTokenMeta(gifts: GiftEvent[]) {
  const suiClient = useSuiClient()
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (!gifts.length) return

    const normalized = gifts
      .map(g => normalizeCoinType(g.tokenType))
      .filter(Boolean) as string[]

    const unknown = Array.from(new Set(normalized)).filter(t => !cache.has(t))
    if (!unknown.length) return

    let cancelled = false
    ;(async () => {
      const results = await Promise.allSettled(
        unknown.map(t => suiClient.getCoinMetadata({ coinType: t }))
      )
      if (cancelled) return
      let changed = false
      results.forEach((r, i) => {
        const typeStr = unknown[i]
        const ticker = tickerFrom(typeStr)
        if (r.status === 'fulfilled' && r.value) {
          cache.set(typeStr, {
            decimals: r.value.decimals,
            symbol: tickerFrom(r.value.symbol || ticker),
          })
          changed = true
        } else {
          cache.set(typeStr, { decimals: 9, symbol: ticker })
          changed = true
        }
      })
      if (changed) setVersion(v => v + 1)
    })()

    return () => { cancelled = true }
  }, [gifts, suiClient])

  const resolve = (gift: GiftEvent): { decimals: number; label: string } => {
    const key = normalizeCoinType(gift.tokenType)
    const hit = cache.get(key)
    if (hit) return { decimals: hit.decimals, label: hit.symbol }

    // Coin-type key missed. Try matching by symbol against the KNOWN list
    // — this is the escape hatch for gifts whose DF coin-type extraction
    // failed at fetch time but whose event payload still carries a
    // recognisable ticker (e.g. "DEEP" → decimals 6). Without this a
    // 6-decimal token renders at 1/1000 of its real value.
    const sym = tickerFrom(gift.tokenSymbol || gift.tokenType)
    const known = KNOWN_COIN_META.find(k => k.symbol.toUpperCase() === sym.toUpperCase())
    if (known) return { decimals: known.decimals, label: known.symbol }

    return { decimals: 9, label: sym }
  }

  return resolve
}
