'use client'

import { useEffect, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { CULTURE_TOKENS, GiftEvent, normalizeCoinType } from '@/lib/culture'

// Bump this whenever the hook's logic changes so we can verify in the
// browser console that the newest bundle is loaded.
const HOOK_VERSION = 'v3-2026-04-21-diag'

export interface TokenMeta {
  decimals: number
  symbol: string
}

const cache = new Map<string, TokenMeta>()
for (const t of CULTURE_TOKENS) {
  cache.set(t.type, { decimals: t.decimals, symbol: t.symbol })
}

if (typeof window !== 'undefined') {
  console.log('[culture/useGiftTokenMeta]', HOOK_VERSION, 'loaded — cache seeded with', Array.from(cache.keys()))
}

export function useGiftTokenMeta(gifts: GiftEvent[]) {
  const suiClient = useSuiClient()
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (!gifts.length) return

    // Defensive: normalise here too, so a stray unprefixed type from any
    // upstream code path still reaches the RPC in the correct form.
    const normalized = gifts
      .map(g => normalizeCoinType(g.tokenType))
      .filter(Boolean) as string[]

    const unknown = Array.from(new Set(normalized)).filter(t => !cache.has(t))
    if (!unknown.length) {
      if (gifts.length) {
        console.log(
          '[culture/useGiftTokenMeta] all gift types already cached —',
          gifts.map(g => ({
            raw: g.tokenType,
            normalized: normalizeCoinType(g.tokenType),
            cached: cache.get(normalizeCoinType(g.tokenType)),
          }))
        )
      }
      return
    }

    console.log('[culture/useGiftTokenMeta] resolving unknown types:', unknown)

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
          const resolved = {
            decimals: r.value.decimals,
            symbol: r.value.symbol || lastSeg,
          }
          cache.set(typeStr, resolved)
          changed = true
          console.log('[culture/useGiftTokenMeta] resolved', typeStr, '→', resolved)
        } else {
          cache.set(typeStr, { decimals: 9, symbol: lastSeg })
          changed = true
          console.warn(
            '[culture/useGiftTokenMeta] FAILED to resolve',
            typeStr,
            r.status === 'rejected' ? (r.reason?.message || r.reason) : 'value=null',
            '→ falling back to 9 decimals /', lastSeg
          )
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
    return { decimals: 9, label: gift.tokenSymbol || 'TOKEN' }
  }

  return resolve
}
