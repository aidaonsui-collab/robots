'use client'

/**
 * Tiny window-scoped event bus for the Culture (airdrops) surface.
 *
 * SendForm and the claim page emit `emitCultureRefresh()` after a
 * successful on-chain mutation; GiftsDashboard, PublicFeed and
 * ClaimSearch subscribe via `useCultureRefresh` to re-run their
 * `fetchAllGifts` queries without a page reload.
 */

import { useEffect, useRef } from 'react'

const EVENT = 'culture:refresh'

export function emitCultureRefresh() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(EVENT))
}

export function useCultureRefresh(cb: () => void) {
  const ref = useRef(cb)
  useEffect(() => { ref.current = cb })
  useEffect(() => {
    const handler = () => ref.current()
    window.addEventListener(EVENT, handler)
    return () => window.removeEventListener(EVENT, handler)
  }, [])
}
