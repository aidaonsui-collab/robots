'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Search, TrendingUp, Clock, ChevronDown, Zap, Users, BarChart3, Coins } from 'lucide-react'
import TokenCard, { SpotlightCard } from '@/components/TokenCard'
import { MOCK_TOKENS, MOCK_TXNS, ODYSSEY_CONTRACT } from '@/lib/contracts'
import { shortenAddress } from '@/lib/utils'
import { getTokenCount } from '@/lib/tokens'

type FilterType = 'all' | 'new' | 'featured' | 'trending' | 'graduating'
type SortType = 'marketcap' | 'newest' | 'progress' | 'holders'

const PLATFORM_STATS = [
  { label: 'Total Volume', value: '3,241 SUI', icon: BarChart3, color: 'text-purple-400' },
  { label: 'Tokens Launched', value: '47', icon: Zap, color: 'text-cyan-400' },
  { label: 'Traders Today', value: '892', icon: Users, color: 'text-green-400' },
  { label: 'Fees Distributed', value: '96.4 SUI', icon: Coins, color: 'text-pink-400' },
]

// Build ticker items from txns
const TICKER_ITEMS = [
  { type: 'buy', addr: '0x4f...bb14', amount: '5.2 SUI', token: 'WOJAK' },
  { type: 'sell', addr: '0x9f...3c7d', amount: '1.1 SUI', token: 'DAI' },
  { type: 'buy', addr: '0x1a...90b6', amount: '8.0 SUI', token: 'MSUI' },
  { type: 'sell', addr: '0xf1...e2d3', amount: '0.5 SUI', token: 'AQUA' },
  { type: 'buy', addr: '0xaa...bb11', amount: '12.4 SUI', token: 'RKTS' },
  { type: 'sell', addr: '0xc0...ffee', amount: '2.9 SUI', token: 'NYAN' },
  { type: 'buy', addr: '0x5e...8a1d', amount: '3.7 SUI', token: 'PRL' },
  { type: 'buy', addr: '0xde...ad42', amount: '6.1 SUI', token: 'SCAT' },
  { type: 'sell', addr: '0x3c...7d9e', amount: '1.8 SUI', token: 'SPEP' },
  { type: 'buy', addr: '0x74...2d35', amount: '9.3 SUI', token: 'SELON' },
]

export default function BondingCurvePage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [sort, setSort] = useState<SortType>('marketcap')
  const [sortOpen, setSortOpen] = useState(false)
  const [txns, setTxns] = useState(MOCK_TXNS)
  const [isDemoMode, setIsDemoMode] = useState(true)
  const sortRef = useRef<HTMLDivElement>(null)

  // Check if connected to real contract
  useEffect(() => {
    async function checkContract() {
      try {
        const count = await getTokenCount()
        setIsDemoMode(count === 0)
      } catch (e) {
        setIsDemoMode(true)
      }
    }
    checkContract()
  }, [])

  // Simulate real-time tx updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTxns((prev) =>
        prev.map((t) => ({
          ...t,
          time: parseInt(t.time) < 60 ? `${parseInt(t.time) + 3}s ago` : '1m ago',
        }))
      )
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  // Close sort dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredTokens = MOCK_TOKENS.filter((token) => {
    const matchesSearch =
      token.name.toLowerCase().includes(search.toLowerCase()) ||
      token.symbol.toLowerCase().includes(search.toLowerCase())
    
    if (!matchesSearch) return false
    
    switch (filter) {
      case 'new': return /^\d+[mh]$/.test(token.age) && parseInt(token.age) < 12
      case 'trending': return token.holders > 150
      case 'graduating': return token.bondingProgress >= 70
      default: return true
    }
  }).sort((a, b) => {
    switch (sort) {
      case 'newest': return 0 // keep original order as proxy for newest
      case 'progress': return b.bondingProgress - a.bondingProgress
      case 'holders': return b.holders - a.holders
      case 'marketcap':
      default: return b.marketCap - a.marketCap
    }
  })

  const spotlightToken = filteredTokens.length > 0 ? filteredTokens[0] : null
  const gridTokens = filteredTokens.length > 1 ? filteredTokens.slice(1) : []

  const sortLabels: Record<SortType, string> = {
    marketcap: 'Market Cap',
    newest: 'Newest',
    progress: 'Bonding %',
    holders: 'Most Holders',
  }

  return (
    <main className="min-h-screen pb-12">
      {/* Demo/Live Status Banner */}
      {isDemoMode && (
        <div className="bg-yellow-500/20 border-b border-yellow-500/30 pt-14">
          <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-center gap-2">
            <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
            <span className="text-yellow-400 text-sm font-medium">
              No live tokens yet on contract {ODYSSEY_CONTRACT.packageId.slice(0,10)}... — be the first to launch!
            </span>
          </div>
        </div>
      )}
      {/* ====================================== */}
      {/* PLATFORM STATS BAR */}
      {/* ====================================== */}
      <div className="bg-[#0a0a14]/80 border-b border-purple-500/10 pt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-purple-500/10">
            {PLATFORM_STATS.map((stat) => {
              const Icon = stat.icon
              return (
                <div key={stat.label} className="flex items-center gap-3 px-6 py-4 fade-in">
                  <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                    <Icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium">{stat.label}</p>
                    <p className={`text-base font-bold ${stat.color}`}>{stat.value}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ====================================== */}
      {/* LIVE TICKER TAPE */}
      {/* ====================================== */}
      <div className="bg-[#080810] border-b border-white/5 overflow-hidden">
        <div className="flex items-center">
          <div className="flex-shrink-0 flex items-center gap-1.5 bg-purple-600/20 border-r border-purple-500/20 px-4 py-2 z-10">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full pulse-dot" />
            <span className="text-xs text-purple-400 font-bold uppercase tracking-wider">Live</span>
          </div>
          <div className="flex overflow-hidden flex-1 relative">
            {/* fade edges */}
            <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#080810] to-transparent z-10" />
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#080810] to-transparent z-10" />
            <div className="flex ticker-tape whitespace-nowrap">
              {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs">
                  <span className={item.type === 'buy' ? 'text-green-400' : 'text-red-400'}>
                    {item.type === 'buy' ? '🟢' : '🔴'}
                    {item.type === 'buy' ? 'Bought' : 'Sold'}
                  </span>
                  <span className="text-gray-300 font-medium">{item.amount}</span>
                  <span className="text-gray-500">of</span>
                  <span className="text-purple-400 font-bold">{item.token}</span>
                  <span className="text-gray-600">by</span>
                  <span className="text-cyan-400/70 font-mono">{item.addr}</span>
                  <span className="text-gray-700 mx-2">•</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-7">
          <div>
            <h1 className="text-3xl font-bold gradient-text">The Odyssey</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Discover and trade fairlaunch tokens on Sui
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-2 h-2 bg-green-400 rounded-full pulse-dot" />
            <span>{MOCK_TOKENS.length} tokens live</span>
          </div>
        </div>

        {/* Search, Filters & Sort */}
        <div className="flex flex-col sm:flex-row gap-3 mb-7">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search tokens by name or ticker..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#0f0f17] border border-gray-800/60 rounded-xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 placeholder:text-gray-600 transition-all"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            {(['all', 'new', 'trending', 'graduating'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all duration-200 ${
                  filter === f
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50 shadow-sm shadow-purple-500/10'
                    : 'bg-[#0f0f17] border border-gray-800/60 text-gray-400 hover:text-gray-200 hover:border-gray-600/60'
                }`}
              >
                {f === 'graduating' ? '👑 Graduating' : f === 'new' ? '⚡ New' : f === 'trending' ? '🔥 Hot' : '🌐 All'}
              </button>
            ))}

            {/* Sort Dropdown */}
            <div className="relative" ref={sortRef}>
              <button
                onClick={() => setSortOpen(!sortOpen)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#0f0f17] border border-gray-800/60 text-gray-400 hover:text-gray-200 hover:border-gray-600/60 transition-all"
              >
                <span>{sortLabels[sort]}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
              </button>
              {sortOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-[#0f0f17] border border-gray-800/60 rounded-xl shadow-xl z-20 overflow-hidden">
                  {(Object.entries(sortLabels) as [SortType, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setSort(key); setSortOpen(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-white/5 ${
                        sort === key ? 'text-purple-400 bg-purple-500/10' : 'text-gray-400'
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
            {filteredTokens.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center fade-in">
                <div className="text-5xl mb-4">🔍</div>
                <h3 className="text-lg font-semibold text-gray-300 mb-2">No tokens found</h3>
                <p className="text-gray-500 text-sm">Try a different search or filter</p>
              </div>
            ) : (
              <>
                {/* Spotlight Card */}
                {spotlightToken && (
                  <SpotlightCard 
                    token={spotlightToken}
                    onClick={() => router.push(`/bondingcurve/coins/${spotlightToken.id}`)}
                  />
                )}

                {/* Regular Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {gridTokens.map((token, i) => (
                    <div key={token.id} className="fade-in" style={{ animationDelay: `${i * 50}ms` }}>
                      <TokenCard 
                        token={token}
                        onClick={() => router.push(`/bondingcurve/coins/${token.id}`)}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Recent Activity Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-[#0f0f17] border border-gray-800/60 rounded-xl p-4 sticky top-24">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-purple-400" />
                  <h3 className="font-semibold text-sm">Live Activity</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-green-400 rounded-full pulse-dot" />
                  <span className="text-xs text-green-400 font-medium">Live</span>
                </div>
              </div>
              <div className="space-y-2">
                {txns.map((tx, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 border-b border-gray-800/40 last:border-0 slide-in"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                          tx.type === 'buy' ? 'bg-green-500/15 border border-green-500/20' : 'bg-red-500/15 border border-red-500/20'
                        }`}
                      >
                        <TrendingUp
                          className={`w-3.5 h-3.5 ${tx.type === 'buy' ? 'text-green-400' : 'text-red-400 rotate-180'}`}
                        />
                      </div>
                      <div>
                        <p className={`text-xs font-semibold ${tx.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                          {tx.type === 'buy' ? 'Bought' : 'Sold'}
                        </p>
                        <p className="text-[10px] text-gray-600 font-mono">
                          {shortenAddress(tx.address)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-gray-200">{tx.amount} SUI</p>
                      <p className="text-[10px] text-purple-400 font-medium">{tx.token}</p>
                      <p className="text-[10px] text-gray-600">{tx.time}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer hint */}
              <div className="mt-4 pt-3 border-t border-gray-800/40 text-center">
                <p className="text-[10px] text-gray-600">Updates every 3 seconds</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
