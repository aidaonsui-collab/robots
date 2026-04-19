// TradingView UDF-compatible datafeed
// Wraps /api/ohlcv (which reads on-chain TradedEventV2 events) into the
// IBasicDataFeed interface that TradingView charting_library expects.
//
// Bars use Unix timestamps in SECONDS (TradingView standard).
// periodParams.from / periodParams.to are also in seconds.

export interface TVBar {
  time: number     // Unix seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const SUPPORTED_RESOLUTIONS = ['1', '5', '15', '60', '240', '1D']

export function createDatafeed(poolId: string, symbol: string, pairType: 'SUI' | 'AIDA' = 'SUI') {
  const subscriptions = new Map<string, ReturnType<typeof setInterval>>()

  async function fetchCandles(resolution: string): Promise<TVBar[]> {
    const res = await fetch(`/api/ohlcv?poolId=${poolId}&resolution=${resolution}`, {
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.candles ?? []) as TVBar[]
  }

  return {
    onReady(callback: (config: object) => void) {
      setTimeout(() => callback({
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        supports_search: false,
        supports_group_request: false,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: false,
        currency_codes: [pairType],
      }), 0)
    },

    searchSymbols() {
      // Not needed — we resolve a single symbol per page
    },

    resolveSymbol(
      _symbolName: string,
      onResolve: (info: object) => void,
      onError: (err: string) => void,
    ) {
      setTimeout(() => {
        if (!poolId) { onError('No pool ID provided'); return }
        onResolve({
          name: `${symbol}/${pairType}`,
          ticker: `${symbol}/${pairType}`,
          description: `${symbol} / ${pairType}`,
          type: 'crypto',
          session: '24x7',
          timezone: 'Etc/UTC',
          minmov: 1,
          // Dynamic pricescale: supports prices as small as 1e-9 (9 decimals)
          pricescale: 1_000_000_000,
          has_intraday: true,
          intraday_multipliers: ['1', '5', '15', '60', '240'],
          has_daily: true,
          supported_resolutions: SUPPORTED_RESOLUTIONS,
          volume_precision: 3,
          data_status: 'streaming',
          exchange: 'Odyssey',
          listed_exchange: 'Odyssey',
          format: 'price',
        })
      }, 0)
    },

    async getBars(
      _symbolInfo: object,
      resolution: string,
      periodParams: { from: number; to: number; firstDataRequest: boolean; countBack: number },
      onResult: (bars: TVBar[], meta: { noData: boolean }) => void,
      onError: (err: string) => void,
    ) {
      try {
        const candles = await fetchCandles(resolution)

        if (!candles.length) {
          onResult([], { noData: true })
          return
        }

        // Filter to requested time window.
        // periodParams.from/to are Unix seconds; candle.time is Unix milliseconds.
        const fromMs = periodParams.from * 1000
        const toMs   = periodParams.to   * 1000
        const bars = candles.filter(c => c.time >= fromMs && c.time <= toMs)

        if (!bars.length) {
          // If first request and nothing in range, return all history so chart shows something
          if (periodParams.firstDataRequest) {
            onResult(candles, { noData: false })
          } else {
            onResult([], { noData: true })
          }
          return
        }

        onResult(bars, { noData: false })
      } catch (e: any) {
        onError(e?.message ?? 'Failed to fetch OHLCV bars')
      }
    },

    subscribeBars(
      _symbolInfo: object,
      resolution: string,
      onTick: (bar: TVBar) => void,
      listenerGuid: string,
    ) {
      // Poll every 8s, emit the latest bar as an update tick
      const interval = setInterval(async () => {
        try {
          const candles = await fetchCandles(resolution)
          if (!candles.length) return
          const last = candles[candles.length - 1]
          onTick(last)
        } catch {}
      }, 8_000)
      subscriptions.set(listenerGuid, interval)
    },

    unsubscribeBars(listenerGuid: string) {
      const interval = subscriptions.get(listenerGuid)
      if (interval !== undefined) {
        clearInterval(interval)
        subscriptions.delete(listenerGuid)
      }
    },
  }
}
