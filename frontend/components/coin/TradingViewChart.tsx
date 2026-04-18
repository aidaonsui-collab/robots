'use client'

import { useEffect, useRef, useState } from 'react'
import { createDatafeed } from '@/lib/tvDatafeed'

declare global {
  interface Window {
    TradingView: any
  }
}

interface Props {
  poolId: string
  symbol: string
  height?: number
  onMissing?: () => void
}

// Attempt to load the charting_library script. Tries standalone bundle first,
// then falls back to the regular entry point.
function loadScript(onLoad: () => void, onError: () => void) {
  if (typeof window === 'undefined') return
  if (window.TradingView) { onLoad(); return }

  const candidates = [
    '/charting_library/charting_library/charting_library.standalone.js',
    '/charting_library/charting_library/charting_library.js',
  ]
  let idx = 0

  function tryNext() {
    if (idx >= candidates.length) { onError(); return }
    const s = document.createElement('script')
    s.src = candidates[idx++]
    s.async = true
    s.onload = () => { if (window.TradingView) onLoad(); else tryNext() }
    s.onerror = tryNext
    document.head.appendChild(s)
  }

  tryNext()
}

export default function TradingViewChart({ poolId, symbol, height = 480, onMissing }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef    = useRef<any>(null)
  const [ready, setReady]   = useState(false)
  const [missing, setMissing] = useState(false)

  // Load TV library once
  useEffect(() => {
    loadScript(() => setReady(true), () => {
      setMissing(true)
      onMissing?.()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Init / reinit widget when poolId or symbol changes
  useEffect(() => {
    if (!ready || !containerRef.current || !window.TradingView) return

    // Destroy previous instance
    if (widgetRef.current) {
      try { widgetRef.current.remove() } catch {}
      widgetRef.current = null
    }

    widgetRef.current = new window.TradingView.widget({
      // Target container element (not a string ID — direct DOM ref)
      container: containerRef.current,

      datafeed: createDatafeed(poolId, symbol),
      library_path: '/charting_library/charting_library/',

      symbol: `${symbol}/SUI`,
      interval: '5',
      timezone: 'Etc/UTC',
      theme: 'Dark',
      style: '1',         // Candles
      locale: 'en',

      autosize: true,
      height,

      // Match Odyssey colour palette
      toolbar_bg: '#0d0f1a',
      overrides: {
        'paneProperties.background':          '#0d1117',
        'paneProperties.backgroundType':      'solid',
        'paneProperties.vertGridProperties.color': 'rgba(255,255,255,0.05)',
        'paneProperties.horzGridProperties.color': 'rgba(255,255,255,0.05)',
        'scalesProperties.textColor':         '#6b7280',
        'scalesProperties.lineColor':         'rgba(255,255,255,0.08)',
        // Green/red candles (when user switches to Candle mode)
        'candleStyle.upColor':           '#00e5a0',
        'candleStyle.downColor':         '#f03a6e',
        'candleStyle.borderUpColor':     '#00e5a0',
        'candleStyle.borderDownColor':   '#f03a6e',
        'candleStyle.wickUpColor':       '#00e5a0',
        'candleStyle.wickDownColor':     '#f03a6e',
        // Area chart colors
        'areaStyle.color1':              'rgba(0, 229, 160, 0.28)',
        'areaStyle.color2':              'rgba(0, 229, 160, 0.02)',
        'areaStyle.linecolor':           '#00e5a0',
        'areaStyle.linewidth':           2,
        // Volume bars
        'volumePaneSize': 'medium',
      },

      disabled_features: [
        'use_localstorage_for_settings',  // don't persist layout per symbol
        'header_symbol_search',
        'header_compare',
        'display_market_status',
        'go_to_date',
      ],
      enabled_features: [
        'hide_last_na_study_output',
        'dont_show_boolean_study_arguments',
        'move_logo_to_main_pane',
        'volume_force_overlay',
      ],
    })

    return () => {
      if (widgetRef.current) {
        try { widgetRef.current.remove() } catch {}
        widgetRef.current = null
      }
    }
  }, [ready, poolId, symbol, height])

  if (missing) return null   // Caller falls back to canvas chart

  if (!ready) return (
    <div
      style={{ height }}
      className="flex items-center justify-center bg-[#0d1117] rounded-xl border border-white/[0.06]"
    >
      <div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
    </div>
  )

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="rounded-xl overflow-hidden border border-white/[0.06]"
    />
  )
}
