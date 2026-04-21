'use client'

import { useEffect, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { CULTURE_TOKENS, GiftEvent, normalizeCoinType, tickerFrom } from '@/lib/culture'

export interface TokenMeta {
  decimals: number
  symbol: string
}

const cache = new Map<string, TokenMeta>()
for (const t of CULTURE_TOKENS) {
  cache.set(t.type, { decimals: t.decimals, symbol: t.symbol })
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
    return { decimals: 9, label: tickerFrom(gift.tokenSymbol || gift.tokenType) }
  }

  return resolve
}
