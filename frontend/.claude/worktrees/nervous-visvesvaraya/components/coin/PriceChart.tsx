'use client'

import { useEffect, useRef } from 'react'

interface PriceChartProps {
  symbol?: string
}

declare global {
  interface Window {
    TradingView: any
  }
}

export default function PriceChart({ symbol = "BINANCE:BTCUSDT" }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    
    // Create widget container
    container.innerHTML = `
      <div class="tradingview-widget-container" style="height:100%;width:100%">
        <div id="tradingview_chart" style="height:100%;width:100%"></div>
      </div>
    `

    // Load TradingView widget script
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/tv.js'
    script.type = 'text/javascript'
    script.async = true
    
    script.onload = () => {
      if ((window as any).TradingView) {
        new (window as any).TradingView.widget({
          "autosize": true,
          "symbol": "BINANCE:BTCUSDT",
          "interval": "60",
          "timezone": "Etc/UTC",
          "theme": "dark",
          "style": "1",
          "locale": "en",
          "toolbar_bg": "#0a0a0f",
          "enable_publishing": false,
          "allow_symbol_change": true,
          "container_id": "tradingview_chart",
          "hide_side_toolbar": false,
          "hide_legend": false,
          "save_image": false,
          "hide_top_toolbar": false,
          "studies": ["Volume@tv-basicstudies"],
          "show_popup_button": true,
          "popup_width": "1000",
          "popup_height": "650",
          "backgroundColor": "rgba(10, 10, 15, 1)",
          "gridColor": "rgba(31, 31, 46, 1)",
          "Overrides": {
            "mainSeriesProperties.candleStyle.upColor": "#22c55e",
            "mainSeriesProperties.candleStyle.downColor": "#ef4444",
            "mainSeriesProperties.candleStyle.borderUpColor": "#22c55e",
            "mainSeriesProperties.candleStyle.borderDownColor": "#ef4444",
            "mainSeriesProperties.candleStyle.wickUpColor": "#22c55e",
            "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444"
          }
        })
      }
    }
    
    document.head.appendChild(script)

    return () => {
      container.innerHTML = ''
    }
  }, [symbol])

  return (
    <div ref={containerRef} className="w-full h-[500px] rounded-xl overflow-hidden bg-[#0a0a0f] border border-gray-800/50" />
  )
}
