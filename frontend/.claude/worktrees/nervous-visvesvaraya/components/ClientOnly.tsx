'use client'

import { useState, useEffect, ReactNode } from 'react'

/**
 * Renders children only on the client side (after hydration).
 * Use this to wrap components that use wallet hooks or other client-only code.
 */
export default function ClientOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return fallback || null
  }

  return <>{children}</>
}
