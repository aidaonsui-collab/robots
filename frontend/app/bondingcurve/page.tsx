'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Search, TrendingUp, Clock, ChevronDown, Zap, Users, BarChart3, Coins, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import Link from 'next/link'
import TokenCard, { SpotlightCard } from '@/components/TokenCard'
import { shortenAddress } from '@/lib/utils'
import { fetchPoolTrades, PoolToken } from '@/lib/tokens'
import { type PresaleToken } from '@/lib/presale'
import { getPairType, type PairToken } from '@/lib/contracts_aida'

type FilterType = 'all' | 'new' | 'featured' | 'trending' | 'graduating'
type SortType = 'marketcap' | 'newest' | 'progress' | 'volume'

interface ActivityItem {
  type: 'buy' | 'sell'
  address: string
  amount: number
  token: string
  pair: PairToken
  timestampMs: number
}

function formatTimeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

export default function BondingCurvePage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [sort, setSort] = useState<SortType>('marketcap')
  const [sortOpen, setSortOpen] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [realTokens, setRealTokens] = useState<PoolToken[]>([])
  const [loadingTokens, setLoadingTokens] = useState(true)
  const [graduatedPresales, setGraduatedPresales] = useState<PresaleToken[]>([])
  const [aidaStakedUsd, setAidaStakedUsd] = useState<string>('—')
  const [aidaStakedDollar, setAidaStakedDollar] = useState<string>('')
  const [feesDistributed, setFeesDistributed] = useState<string>('—')
  // AIDA-pair trading fees accrue in AIDA, not SUI — kept in a separate
  // state so the stat card can render them on their own line rather than
  // incorrectly aggregated into the SUI total.
  const [feesDistributedAida, setFeesDistributedAida] = useState<string>('')
  const sortRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/tokens').then(async (res) => {
      const tokens: PoolToken[] = await res.json()
      setLoadingTokens(false)
      const now = Date.now()
      const oneHourAgo  = now - 60 * 60 * 1000
      const oneDayAgo   = now - 24 * 60 * 60 * 1000

      const tradeArrays = await Promise.all(
        tokens.map(t => fetchPoolTrades(t.poolId).then(trades => {
          // Compute volume1h
          const vol1h = trades
            .filter(tr => tr.timestampMs >= oneHourAgo)
            .reduce((sum, tr) => sum + tr.suiAmount, 0)
          // All-time trade volume (survives graduation — live sui_raised is drained to 0 on migration)
          const volAll = trades.reduce((sum, tr) => sum + tr.suiAmount, 0)

          // Compute 24h price change
          const tradesAsc = [...trades].sort((a, b) => a.timestampMs - b.timestampMs)
          const dayStartTrade = tradesAsc.find(tr => tr.timestampMs >= oneDayAgo)
          const priceChange24h = dayStartTrade && t.currentPrice > 0
            ? ((t.currentPrice - dayStartTrade.price) / dayStartTrade.price) * 100
            : 0

          // Enrich token with computed stats
          t.volume1h = vol1h
          ;(t as any).volumeAll = volAll
          t.priceChange24h = priceChange24h

          const tokenPair: PairToken = t.pairType ?? (t as any).pairToken ?? getPairType(t.moonbagsPackageId ?? (t as any).moonbagsPackageId)
          return trades.map(tr => ({
            type: tr.isBuy ? 'buy' as const : 'sell' as const,
            address: tr.user ? `${tr.user.slice(0, 6)}...${tr.user.slice(-4)}` : 'unknown',
            amount: tr.suiAmount,
            token: t.symbol,
            pair: tokenPair,
            timestampMs: tr.timestampMs,
          }))
        }))
      )
      setRealTokens([...tokens]) // trigger re-render with enriched data
      const allTrades = tradeArrays.flat().sort((a, b) => b.timestampMs - a.timestampMs)
      setActivity(allTrades)
    })
  }, [])

  // Fetch AIDA staking TVL + fees distributed
  useEffect(() => {
    const RPC = 'https://fullnode.mainnet.sui.io'
    const AIDA_POOL = '0x2b7c1b42426abdc1ece2cea3f564e32b7809cdcebc87d08fa56b440d9eb5c3d4'
    // Query fees from legacy, v11, v12 (both publishes), and AIDA-fork
    // (both publishes). Each publish era emits events under its own pkgId.
    const LEGACY_ORIGIN_PKG = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'
    const V11_PKG           = '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813'
    const V12_PKG           = '0x95bb61b03a5d476c2621b2b3f512e8fd5f0976260ce4e8d0d9a79ca64b658f4e' // 2026-04-16
    const V12_CURRENT_PKG   = '0x2ab8f764b67991acaf37966af2274dcf7214ae0e8cea3ede214078f248dce3d2' // 2026-04-21 republish

    // Fetch total fees from TradedEventV2 events across all package versions
    const fetchTradeEvents = (pkg: string) =>
      fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2,
          method: 'suix_queryEvents',
          params: [{ MoveEventType: `${pkg}::moonbags::TradedEventV2` }, null, 100, false]
        })
      }).then(r => r.json()).then(res => res?.result?.data ?? [])

    // AIDA-pair package — fees from these trades are in AIDA, not SUI, and
    // must be summed separately so the Fees Distributed card can display
    // the two currencies on their own lines.
    const AIDA_PAIR_PKG         = '0x2156ceed0866b899840871add0efdae25799b2b22df1563922b5b01c011975a8' // 2026-04-18
    const AIDA_PAIR_CURRENT_PKG = '0x593a2e87f393dcb14e0f8c88d587c04e9bc98295e13212e8992343377bf7f313' // 2026-04-21 republish
    Promise.all([
      fetchTradeEvents(LEGACY_ORIGIN_PKG),
      fetchTradeEvents(V11_PKG),
      fetchTradeEvents(V12_PKG),
      fetchTradeEvents(V12_CURRENT_PKG),
      fetchTradeEvents(AIDA_PAIR_PKG),
      fetchTradeEvents(AIDA_PAIR_CURRENT_PKG),
    ]).then(([legacyEvents, v11Events, v12Events, v12CurrentEvents, aidaPairEvents, aidaPairCurrentEvents]) => {
        const suiEvents = [...legacyEvents, ...v11Events, ...v12Events, ...v12CurrentEvents]
        const aidaEvents = [...aidaPairEvents, ...aidaPairCurrentEvents]
        const sumFee = (events: any[]) =>
          events.reduce((s: number, e: any) => s + Number(e.parsedJson?.fee ?? 0), 0) / 1e9
        const totalFeeSui  = sumFee(suiEvents)
        const totalFeeAida = sumFee(aidaEvents)
        const fmt = (n: number) =>
          n >= 1000 ? `${(n / 1000).toFixed(2)}K` : n.toFixed(4)
        setFeesDistributed(`${fmt(totalFeeSui)} SUI`)
        setFeesDistributedAida(totalFeeAida > 0 ? `${fmt(totalFeeAida)} AIDA` : '')
      }).catch(() => {})
    // Dynamically resolve AIDA StakingPool from v11 stake config (same as staking page)
    const V11_STAKE_CFG = '0x59c35bc4c50631e4d4468d9964ba23c3961e1ff8d7c6df740fcf776c8936e940'
    // AIDA-pair fork stake config — earns AIDA (not SUI) from AIDA-pair trades.
    // Match what the staking page uses so the landing-page total reflects both pools.
    const AIDA_PAIR_STK_CFG = '0xd2da7956c16dafe9e592b04085d80b19159c39034e222247315a51b9c3770c09'
    const rpc = (method: string, params: any[]) =>
      fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }).then(r => r.json()).then(j => j.result)

    const getPoolTotal = async (poolId: string) => {
      const obj = await rpc('sui_getObject', [poolId, { showContent: true }])
      const f = obj?.data?.content?.fields
      if (!f) return 0
      // StakingPool may store total as: total_supply (u64), total_staked (u64),
      // or balance (Balance<T> → nested { fields: { value: "..." } })
      const raw = f.total_supply ?? f.total_staked
        ?? (typeof f.balance === 'object' ? f.balance?.fields?.value : f.balance)
        ?? 0
      return Number(raw)
    }

    ;(async () => {
      try {
        let totalRaw = 0

        // Paginate dynamic fields until the AIDA pool is found — each
        // memecoin with staking enabled adds a field, so the first 50
        // fill up and AIDA falls off the first page.
        const findAidaPool = async (cfg: string): Promise<string | null> => {
          let cursor: string | null = null
          for (let page = 0; page < 20; page++) {
            const f: any = await rpc('suix_getDynamicFields', [cfg, cursor, 50])
            const p = (f?.data ?? []).find((x: any) =>
              x.objectType?.includes('StakingPool') && x.objectType?.includes('aida::AIDA')
            )
            if (p) return p.objectId
            if (!f?.hasNextPage || !f?.nextCursor) break
            cursor = f.nextCursor
          }
          return null
        }

        // v11/V12_PREV SUI-pair stake config
        const aidaPoolId = await findAidaPool(V11_STAKE_CFG)
        if (aidaPoolId) totalRaw += await getPoolTotal(aidaPoolId)

        // AIDA-pair fork pool (earns AIDA from AIDA-pair trades). May not exist
        // yet if no one has initialized it — quiet no-op in that case.
        const forkAidaPoolId = await findAidaPool(AIDA_PAIR_STK_CFG)
        if (forkAidaPoolId) totalRaw += await getPoolTotal(forkAidaPoolId)

        // Legacy pool (small amount, kept for completeness)
        totalRaw += await getPoolTotal(AIDA_POOL)

        const aidaStaked = totalRaw / 1e9
        if (aidaStaked >= 1_000_000) setAidaStakedUsd(`${(aidaStaked / 1_000_000).toFixed(2)}M AIDA`)
        else if (aidaStaked >= 1000) setAidaStakedUsd(`${(aidaStaked / 1000).toFixed(1)}K AIDA`)
        else setAidaStakedUsd(`${Math.round(aidaStaked * 10) / 10} AIDA`)

        // Fetch AIDA price from DexScreener
        const pairAddr = '0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b'
        const dsRes = await fetch(`https://api.dexscreener.com/latest/dex/pairs/sui/${pairAddr}`)
        if (dsRes.ok) {
          const dsData = await dsRes.json()
          const priceUsd = parseFloat(dsData?.pair?.priceUsd || dsData?.pairs?.[0]?.priceUsd || '0')
          if (priceUsd > 0) {
            const dollarValue = aidaStaked * priceUsd
            if (dollarValue >= 1_000_000) setAidaStakedDollar(`~$${(dollarValue / 1_000_000).toFixed(2)}M`)
            else if (dollarValue >= 1000) setAidaStakedDollar(`~$${(dollarValue / 1000).toFixed(2)}K`)
            else setAidaStakedDollar(`~$${dollarValue.toFixed(2)}`)
          }
        }
      } catch {}
    })()
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Fetch Olympus presales that have graduated to Momentum DEX
  useEffect(() => {
    fetch('/api/presale')
      .then(r => r.json())
      .then((all: PresaleToken[]) => {
        if (Array.isArray(all)) {
          setGraduatedPresales(all.filter(p => p.isMigrated))
        }
      })
      .catch(() => {})
  }, [])

  const filteredTokens = realTokens.filter((token) => {
    const matchesSearch =
      token.name.toLowerCase().includes(search.toLowerCase()) ||
      token.symbol.toLowerCase().includes(search.toLowerCase())
    return matchesSearch
  }).sort((a, b) => {
    switch (sort) {
      case 'progress': return b.progress - a.progress
      case 'newest': return (b.createdAt ?? 0) - (a.createdAt ?? 0)
      case 'volume': return (b.volume1h ?? 0) - (a.volume1h ?? 0)
      case 'marketcap':
      default: return (b.marketCap ?? 0) - (a.marketCap ?? 0)
    }
  })

  const spotlightToken = filteredTokens.length > 0 ? filteredTokens[0] : null
  const gridTokens = filteredTokens.length > 1 ? filteredTokens.slice(1) : []

  const sortLabels: Record<SortType, string> = {
    marketcap: 'Market Cap',
    newest: 'Newest',
    progress: 'Bonding %',
    volume: '1H Volume',
  }

  // Prefer the all-time sum of trade events — it survives pool graduation
  // (live real_sui_reserves gets drained to 0 when the bonding curve migrates
  // its liquidity to the DEX pool). Fall back to the threshold for graduated
  // pools if the trade event stream is still loading, then to the live reserve.
  const tradedAmount = (t: PoolToken) => {
    const volAll = (t as any).volumeAll
    if (typeof volAll === 'number' && volAll > 0) return volAll
    const live = t.realSuiRaised ?? (t as any).realSuiSui ?? 0
    const isCompleted = t.isCompleted ?? (t as any).isCompleted
    if (isCompleted) return t.threshold ?? (t as any).thresholdSui ?? live
    return live
  }
  const totalSuiTraded = realTokens.reduce((s, t) => {
    const isAida = (t as any).pairToken === 'AIDA' || t.pairType === 'AIDA'
    return isAida ? s : s + tradedAmount(t)
  }, 0)
  const totalAidaTraded = realTokens.reduce((s, t) => {
    const isAida = (t as any).pairToken === 'AIDA' || t.pairType === 'AIDA'
    return isAida ? s + tradedAmount(t) : s
  }, 0)

  // Sparkline data generators for stat cards
  const genSparkline = (base: number, volatility: number, points = 30) =>
    Array.from({ length: points }, (_, i) => base + Math.sin(i * 0.3) * volatility + Math.random() * volatility * 0.5 + i * (volatility * 0.02))

  return (
    <main className="min-h-screen bg-[#07070e] pb-12">

      {/* PLATFORM STATS */}
      <div className="pt-20 pb-2">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mesh-bg noise-overlay relative rounded-2xl p-4 mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 relative">
            {/* Total Volume */}
            <div className="card-lift spotlight-cursor bg-[#0d0f1a]/80 backdrop-blur-md rounded-2xl border border-white/[0.06] p-5 flex flex-col justify-between overflow-hidden relative group hover:border-white/[0.14]">
              <div className="absolute top-0 left-0 right-0 h-[2px] opacity-40 group-hover:opacity-100 transition-opacity duration-500" style={{ background: 'linear-gradient(90deg, transparent, #D4AF37, transparent)' }} />
              <div aria-hidden className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-20 group-hover:opacity-50 transition-opacity duration-700 pointer-events-none blur-2xl" style={{ background: 'radial-gradient(circle, #D4AF37 0%, transparent 70%)' }} />
              <div className="relative z-10">
                <p className="text-[11px] text-gray-500 font-semibold tracking-[0.14em] uppercase mb-3">Total Volume</p>
                <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2 value-rise glow-gold" style={{ fontVariantNumeric: 'tabular-nums' }}>{totalSuiTraded.toFixed(2)} SUI</p>
                <p className="text-sm font-semibold text-[#D4AF37] mb-2">{totalAidaTraded.toLocaleString(undefined, { maximumFractionDigits: 0 })} AIDA</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400">SUI &amp; AIDA traded</span>
                  <span className="text-[10px] text-gray-600">All time</span>
                </div>
              </div>
              <div className="mt-4 -mx-5 -mb-5">
                <svg viewBox="0 0 200 64" className="w-full" style={{ height: 64 }} preserveAspectRatio="none">
                  <defs><linearGradient id="sv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#D4AF37" stopOpacity="0.3"/><stop offset="100%" stopColor="#D4AF37" stopOpacity="0.02"/></linearGradient></defs>
                  {(() => { const d = genSparkline(totalSuiTraded + totalAidaTraded / 1_000_000 || 100, 30); const h = 64; const mx = Math.max(...d); const mn = Math.min(...d); const rg = mx - mn || 1; const pts = d.map((v: number, i: number) => ({ x: (i / (d.length - 1)) * 200, y: h - ((v - mn) / rg) * (h * 0.85) - h * 0.05 })); const line = pts.map((p: {x: number; y: number}, i: number) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' '); return (<><path d={`${line} L200,${h} L0,${h} Z`} fill="url(#sv)"/><path d={line} fill="none" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></>); })()}
                </svg>
              </div>
            </div>

            {/* Tokens Launched */}
            <div className="card-lift spotlight-cursor bg-[#0d0f1a]/80 backdrop-blur-md rounded-2xl border border-white/[0.06] p-5 flex flex-col justify-between overflow-hidden relative group hover:border-white/[0.14]">
              <div className="absolute top-0 left-0 right-0 h-[2px] opacity-40 group-hover:opacity-100 transition-opacity duration-500" style={{ background: 'linear-gradient(90deg, transparent, #06b6d4, transparent)' }} />
              <div aria-hidden className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-20 group-hover:opacity-50 transition-opacity duration-700 pointer-events-none blur-2xl" style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)' }} />
              <div className="relative z-10">
                <p className="text-[11px] text-gray-500 font-semibold tracking-[0.14em] uppercase mb-3">Tokens Launched</p>
                <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2 value-rise glow-cyan" style={{ fontVariantNumeric: 'tabular-nums' }}>{realTokens.length || 0}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400">▲ Launched</span>
                  <span className="text-[10px] text-gray-600">All time</span>
                </div>
              </div>
              <div className="mt-4 -mx-5 -mb-5">
                <svg viewBox="0 0 200 64" className="w-full" style={{ height: 64 }} preserveAspectRatio="none">
                  <defs><linearGradient id="st" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity="0.3"/><stop offset="100%" stopColor="#06b6d4" stopOpacity="0.02"/></linearGradient></defs>
                  {(() => { const d = genSparkline(realTokens.length || 1, 2); const h = 64; const mx = Math.max(...d); const mn = Math.min(...d); const rg = mx - mn || 1; const pts = d.map((v: number, i: number) => ({ x: (i / (d.length - 1)) * 200, y: h - ((v - mn) / rg) * (h * 0.85) - h * 0.05 })); const line = pts.map((p: {x: number; y: number}, i: number) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' '); return (<><path d={`${line} L200,${h} L0,${h} Z`} fill="url(#st)"/><path d={line} fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></>); })()}
                </svg>
              </div>
            </div>

            {/* AIDA Staked */}
            <div className="card-lift spotlight-cursor bg-[#0d0f1a]/80 backdrop-blur-md rounded-2xl border border-white/[0.06] p-5 flex flex-col justify-between overflow-hidden relative group hover:border-white/[0.14]">
              <div className="absolute top-0 left-0 right-0 h-[2px] opacity-40 group-hover:opacity-100 transition-opacity duration-500" style={{ background: 'linear-gradient(90deg, transparent, #10b981, transparent)' }} />
              <div aria-hidden className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-20 group-hover:opacity-50 transition-opacity duration-700 pointer-events-none blur-2xl" style={{ background: 'radial-gradient(circle, #10b981 0%, transparent 70%)' }} />
              <div className="relative z-10">
                <p className="text-[11px] text-gray-500 font-semibold tracking-[0.14em] uppercase mb-3">AIDA Staked</p>
                <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-1 value-rise glow-emerald" style={{ fontVariantNumeric: 'tabular-nums' }}>{aidaStakedUsd}</p>
                {aidaStakedDollar && <p className="text-sm text-gray-400 mb-2" style={{ fontVariantNumeric: 'tabular-nums' }}>{aidaStakedDollar}</p>}
                {!aidaStakedDollar && <div className="mb-2" />}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400">▲ TVL</span>
                  <span className="text-[10px] text-gray-600">Live</span>
                </div>
              </div>
              <div className="mt-4 -mx-5 -mb-5">
                <svg viewBox="0 0 200 64" className="w-full" style={{ height: 64 }} preserveAspectRatio="none">
                  <defs><linearGradient id="sa" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity="0.3"/><stop offset="100%" stopColor="#10b981" stopOpacity="0.02"/></linearGradient></defs>
                  {(() => { const d = genSparkline(50, 10); const h = 64; const mx = Math.max(...d); const mn = Math.min(...d); const rg = mx - mn || 1; const pts = d.map((v: number, i: number) => ({ x: (i / (d.length - 1)) * 200, y: h - ((v - mn) / rg) * (h * 0.85) - h * 0.05 })); const line = pts.map((p: {x: number; y: number}, i: number) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' '); return (<><path d={`${line} L200,${h} L0,${h} Z`} fill="url(#sa)"/><path d={line} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></>); })()}
                </svg>
              </div>
            </div>

            {/* Fees Distributed */}
            <div className="card-lift spotlight-cursor bg-[#0d0f1a]/80 backdrop-blur-md rounded-2xl border border-white/[0.06] p-5 flex flex-col justify-between overflow-hidden relative group hover:border-white/[0.14]">
              <div className="absolute top-0 left-0 right-0 h-[2px] opacity-40 group-hover:opacity-100 transition-opacity duration-500" style={{ background: 'linear-gradient(90deg, transparent, #ec4899, transparent)' }} />
              <div aria-hidden className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-20 group-hover:opacity-50 transition-opacity duration-700 pointer-events-none blur-2xl" style={{ background: 'radial-gradient(circle, #ec4899 0%, transparent 70%)' }} />
              <div className="relative z-10">
                <p className="text-[11px] text-gray-500 font-semibold tracking-[0.14em] uppercase mb-3">Fees Distributed</p>
                {/* SUI + AIDA lines are rendered with identical classes so
                    the two currencies read as equally-weighted siblings
                    — same size, color, weight, and pink-glow background. */}
                <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-1 value-rise glow-pink" style={{ fontVariantNumeric: 'tabular-nums' }}>{feesDistributed}</p>
                {feesDistributedAida && (
                  <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2 value-rise glow-pink" style={{ fontVariantNumeric: 'tabular-nums' }}>{feesDistributedAida}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400">▲ Fees</span>
                  <span className="text-[10px] text-gray-600">Cumulative</span>
                </div>
              </div>
              <div className="mt-4 -mx-5 -mb-5">
                <svg viewBox="0 0 200 64" className="w-full" style={{ height: 64 }} preserveAspectRatio="none">
                  <defs><linearGradient id="sf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ec4899" stopOpacity="0.3"/><stop offset="100%" stopColor="#ec4899" stopOpacity="0.02"/></linearGradient></defs>
                  {(() => { const d = genSparkline(20, 5); const h = 64; const mx = Math.max(...d); const mn = Math.min(...d); const rg = mx - mn || 1; const pts = d.map((v: number, i: number) => ({ x: (i / (d.length - 1)) * 200, y: h - ((v - mn) / rg) * (h * 0.85) - h * 0.05 })); const line = pts.map((p: {x: number; y: number}, i: number) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' '); return (<><path d={`${line} L200,${h} L0,${h} Z`} fill="url(#sf)"/><path d={line} fill="none" stroke="#ec4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></>); })()}
                </svg>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* TOP 10 TOKENS BY MARKET CAP */}
      {realTokens.length > 0 && (
        <div className="bg-[#07070e] border-b border-white/[0.04] overflow-hidden">
          <div className="flex items-center h-10">
            <div className="flex-shrink-0 flex items-center gap-2 bg-gradient-to-r from-[#D4AF37]/20 to-transparent border-r border-[#D4AF37]/20 px-4 h-full z-10">
              <TrendingUp className="w-4 h-4 text-[#D4AF37]" />
              <span className="text-[11px] text-[#D4AF37] font-bold uppercase tracking-widest">Top 10</span>
            </div>
            <div className="flex overflow-hidden flex-1 relative">
              <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-[#07070e] to-transparent z-10 pointer-events-none" />
              <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-[#07070e] to-transparent z-10 pointer-events-none" />
              <div className="flex ticker-tape-slow whitespace-nowrap items-center">
                {[...realTokens].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 10).concat(
                  [...realTokens].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 10)
                ).map((token, i) => (
                  <span key={i} className="inline-flex items-center gap-2 px-5 text-[11px] font-medium">
                    <span className="text-gray-500 font-bold">#{(i % 10) + 1}</span>
                    <span className="text-[#D4AF37] font-bold">{token.symbol}</span>
                    <span className="text-gray-700">·</span>
                    <span className="text-white font-semibold">MC: ${((token.marketCap || 0) / 1000).toFixed(1)}K</span>
                    {token.priceChange24h !== undefined && (
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${token.priceChange24h >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {token.priceChange24h >= 0 ? '+' : ''}{token.priceChange24h.toFixed(1)}%
                      </span>
                    )}
                    <span className="text-gray-800 mx-2">|</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Projects</h1>
            <p className="text-sm text-gray-500 mt-1">Discover and trade AI agent tokens on the bonding curve</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 bg-emerald-400 rounded-full pulse-dot" />
              <span className="text-xs text-emerald-400 font-semibold">{realTokens.length} token{realTokens.length !== 1 ? 's' : ''} live</span>
            </div>
            <span className="text-[10px] font-medium text-gray-500 bg-white/5 px-2.5 py-1 rounded-full border border-white/5">Mainnet</span>
          </div>
        </div>

        {/* Search + Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-7">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600 group-focus-within:text-[#D4AF37] transition-colors" />
            <input
              type="text"
              placeholder="Search tokens by name or ticker..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#0d0f1a] border border-white/[0.06] rounded-xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/60 focus:border-[#D4AF37]/30 placeholder:text-gray-600 transition-all text-gray-200"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            {(['all'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all duration-200 ${
                  filter === f
                    ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/25'
                    : 'bg-white/[0.03] border border-white/[0.04] text-gray-500 hover:text-gray-300 hover:bg-white/[0.06]'
                }`}
              >
                {f === 'all' ? 'All' : f}
              </button>
            ))}

            <div className="relative" ref={sortRef}>
              <button
                onClick={() => setSortOpen(!sortOpen)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white/[0.03] border border-white/[0.04] text-gray-400 hover:text-gray-200 hover:bg-white/[0.06] transition-all"
              >
                <span>{sortLabels[sort]}</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${sortOpen ? 'rotate-180' : ''}`} />
              </button>
              {sortOpen && (
                <div className="absolute right-0 top-full mt-2 w-44 bg-[#0d0f1a] border border-white/[0.06] rounded-xl shadow-2xl shadow-black/50 z-20 overflow-hidden">
                  {(Object.entries(sortLabels) as [SortType, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setSort(key); setSortOpen(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-white/5 ${
                        sort === key ? 'text-[#D4AF37] bg-[#D4AF37]/10 font-semibold' : 'text-gray-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Token Grid */}
          <div className="lg:col-span-3">
            {/* Olympus Launches (graduated presale tokens) */}
            {graduatedPresales.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-white font-semibold text-sm">Olympus Launches</h2>
                  <span className="text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">
                    LIVE ON DEX
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {graduatedPresales.map((p) => (
                    <Link key={p.id} href={`/olympus/${p.id}`}>
                      <div className="group bg-[#0d0f1a] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/5 cursor-pointer">
                        <div className="relative h-32 bg-gradient-to-br from-blue-500/10 to-[#0d0f1a] flex items-center justify-center overflow-hidden">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] flex items-center justify-center text-black text-xl font-bold">
                              {p.symbol?.slice(0, 2)}
                            </div>
                          )}
                          <div className="absolute top-2 right-2">
                            <span className="text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">LAUNCHED</span>
                          </div>
                        </div>
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <p className="text-white font-semibold text-sm truncate">{p.name}</p>
                              <p className="text-gray-500 text-xs">${p.symbol}</p>
                            </div>
                            <span className="text-[10px] bg-white/[0.04] text-gray-400 px-2 py-0.5 rounded-md shrink-0">Olympus</span>
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{(p.totalRaisedMist / 1e9).toFixed(1)} SUI raised</span>
                            <span>{p.contributorCount} holders</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {loadingTokens ? (
              <div className="flex flex-col items-center justify-center py-24 text-center fade-in">
                <div className="w-10 h-10 rounded-full border-2 border-[#D4AF37]/30 border-t-[#D4AF37] animate-spin mb-4" />
                <h3 className="text-sm font-medium text-gray-400">Loading tokens...</h3>
              </div>
            ) : filteredTokens.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center fade-in">
                <div className="text-5xl mb-4">🚀</div>
                <h3 className="text-lg font-semibold text-gray-300 mb-2">No tokens launched yet</h3>
                <p className="text-gray-600 text-sm">Be the first to launch a token!</p>
              </div>
            ) : (
              <>
                {spotlightToken && (
                  <SpotlightCard
                    token={{
                      id: spotlightToken.poolId,
                      name: spotlightToken.name,
                      symbol: spotlightToken.symbol,
                      logoUrl: spotlightToken.imageUrl,
                      age: 'New',
                      creatorShort: spotlightToken.creator ? spotlightToken.creator.slice(2, 8) : 'unknown',
                      creatorFull: spotlightToken.creator,
                      priceChange24h: spotlightToken.priceChange24h ?? 0,
                      volume1h: spotlightToken.volume1h ?? 0,
                      marketCap: Math.round(spotlightToken.marketCap ?? 0),
                      bondingProgress: spotlightToken.progress,
                      description: spotlightToken.description,
                      twitter: spotlightToken.twitter,
                      telegram: spotlightToken.telegram,
                      website: spotlightToken.website,
                      liveStreamUrl: spotlightToken.streamUrl,
                      coinType: spotlightToken.coinType,
                      isAiLaunched: spotlightToken.isAiLaunched,
                      moonbagsPackageId: (spotlightToken as any).moonbagsPackageId,
                      pairType: (spotlightToken as any).pairType ?? getPairType((spotlightToken as any).moonbagsPackageId),
                      isCompleted: (spotlightToken as any).isCompleted,
                    }}
                    onClick={() => router.push(`/bondingcurve/coins/${spotlightToken.coinType}`)}
                  />
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {gridTokens.map((poolToken, i) => (
                    <div key={poolToken.poolId} className="fade-in" style={{ animationDelay: `${i * 50}ms` }}>
                      <TokenCard
                        token={{
                          id: poolToken.poolId,
                          name: poolToken.name,
                          symbol: poolToken.symbol,
                          logoUrl: poolToken.imageUrl,
                          age: 'New',
                          creatorShort: poolToken.creator ? poolToken.creator.slice(2, 8) : 'unknown',
                          creatorFull: poolToken.creator,
                          priceChange24h: poolToken.priceChange24h ?? 0,
                          volume1h: poolToken.volume1h ?? 0,
                          marketCap: Math.round(poolToken.marketCap ?? 0),
                          bondingProgress: poolToken.progress,
                          description: poolToken.description,
                          twitter: poolToken.twitter,
                          telegram: poolToken.telegram,
                          website: poolToken.website,
                          liveStreamUrl: poolToken.streamUrl,
                          coinType: poolToken.coinType,
                          isAiLaunched: poolToken.isAiLaunched,
                          moonbagsPackageId: poolToken.moonbagsPackageId,
                          pairType: poolToken.pairType ?? getPairType(poolToken.moonbagsPackageId),
                          isCompleted: poolToken.isCompleted,
                        }}
                        onClick={() => router.push(`/bondingcurve/coins/${poolToken.coinType}`)}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Live Activity Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-4 sticky top-24">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#D4AF37]" />
                  <h3 className="font-bold text-sm text-white">Live Activity</h3>
                </div>
                <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full pulse-dot" />
                  <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Live</span>
                </div>
              </div>

              <div className="space-y-1">
                {activity.length === 0 && (
                  <div className="flex flex-col items-center py-10 gap-2 text-center">
                    <p className="text-xs text-gray-600">No trades yet</p>
                    <p className="text-[10px] text-gray-700">Activity will appear here</p>
                  </div>
                )}
                {activity && activity.length > 0 && activity.slice(0, 8).map((tx, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-2.5 rounded-xl transition-colors slide-in ${
                      tx.type === 'buy' ? 'hover:bg-emerald-500/5' : 'hover:bg-red-500/5'
                    }`}
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        tx.type === 'buy'
                          ? 'bg-emerald-500/15 border border-emerald-500/25'
                          : 'bg-red-500/15 border border-red-500/25'
                      }`}>
                        {tx.type === 'buy'
                          ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                          : <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />
                        }
                      </div>
                      <div>
                        <p className={`text-xs font-bold ${tx.type === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {tx.type === 'buy' ? 'Buy' : 'Sell'}
                          <span className="text-gray-500 font-normal ml-1 text-[10px]">· {tx.token}</span>
                        </p>
                        <p className="text-[10px] text-gray-600 font-mono">{tx.address}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-white tabular-nums">{tx.amount.toFixed(2)}</p>
                      <p className="text-[10px] text-gray-600">{tx.pair} · {formatTimeAgo(tx.timestampMs)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-white/[0.04] text-center">
                <p className="text-[10px] text-gray-600">on-chain · mainnet</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

