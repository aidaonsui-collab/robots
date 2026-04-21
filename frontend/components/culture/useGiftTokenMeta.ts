'use client'

import { useEffect, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { CULTURE_TOKENS, GiftEvent } from '@/lib/culture'

export interface TokenMeta {
  decimals: number
  symbol: string
}

// Module-level cache shared across every mount so each unknown coin type
// is only fetched once per session. Seeded with the built-in SUI / AIDA /
// USDC configs so presets are resolved synchronously on first render.
const cache = new Map<string, TokenMeta>()
for (const t of CULTURE_TOKENS) {
  cache.set(t.type, { decimals: t.decimals, symbol: t.symbol })
}

/**
 * Look up display metadata (decimals + symbol) for the coin types carried
 * by a list of gifts, falling back to the gift's stored symbol + 9 decimals
 * while the chain lookup is in flight.
 *
 * Returns a stable `resolve(gift)` helper; the component re-renders once
 * any newly-fetched metadata lands in the cache.
 */
export function useGiftTokenMeta(gifts: GiftEvent[]) {
  const suiClient = useSuiClient()
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (!gifts.length) return
    const unknown = Array.from(
      new Set(gifts.map(g => g.tokenType).filter(Boolean))
    ).filter(t => !cache.has(t))
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
        const lastSeg = typeStr.split('::').pop() || 'TOKEN'
        if (r.status === 'fulfilled' && r.value) {
          cache.set(typeStr, {
            decimals: r.value.decimals,
            symbol: r.value.symbol || lastSeg,
          })
          changed = true
        } else {
          // Cache a best-guess so we stop re-fetching a type whose
          // creator never published CoinMetadata on chain.
          cache.set(typeStr, { decimals: 9, symbol: lastSeg })
          changed = true
        }
      })
      if (changed) setVersion(v => v + 1)
    })()

    return () => { cancelled = true }
  }, [gifts, suiClient])

  const resolve = (gift: GiftEvent): { decimals: number; label: string } => {
    const hit = cache.get(gift.tokenType)
    if (hit) return { decimals: hit.decimals, label: hit.symbol }
    return { decimals: 9, label: gift.tokenSymbol || 'TOKEN' }
  }

  return resolve
}
