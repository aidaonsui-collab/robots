'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { Search, Sparkles, TrendingUp, Clock, Zap, Grid3x3, LayoutGrid, Plus, Activity, PauseCircle, Settings, User } from 'lucide-react'
import TokenCardPremium from '@/components/TokenCardPremium'
import { motion } from 'framer-motion'
import { fetchAllPoolTokens, PoolToken } from '@/lib/tokens'
import { type PairToken } from '@/lib/contracts_aida'

type ViewMode = 'grid' | 'large'
type FilterType = 'all' | 'ai-agents' | 'trending' | 'new' | 'graduating'
type SortType = 'marketcap' | 'newest' | 'trending' | 'progress'
type PageTab = 'all' | 'mine'

interface MyAgent {
  id: string
  name: string
  symbol: string
  avatarUrl: string
  tokenType: string
  poolId: string
  status: 'creating' | 'active' | 'paused' | 'stopped'
  llmModel: string
  createdAt: string
  marketCap?: number
  volume24h?: number
  trades24h?: number
  earnings?: number
  pairType?: PairToken
}

export default function AgentsPage() {
  const router = useRouter()
  const account = useCurrentAccount()
  const address = account?.address

  const [pageTab, setPageTab] = useState<PageTab>('all')

  // — All Agents state —
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [sort, setSort] = useState<SortType>('marketcap')
  const [tokens, setTokens] = useState<PoolToken[]>([])
  const [loading, setLoading] = useState(true)

  // — My Agents state —
  const [myAgents, setMyAgents] = useState<MyAgent[]>([])
  const [myLoading, setMyLoading] = useState(false)
  const [myFilter, setMyFilter] = useState<'all' | 'active' | 'paused'>('all')
  const [mySearch, setMySearch] = useState('')

  useEffect(() => {
    fetchAllPoolTokens().then((data) => {
      setTokens(data.filter(t => t.isAiLaunched))
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (pageTab !== 'mine' || !address) return
    setMyLoading(true)

    async function fetchMyAgents() {
      try {
        const res = await fetch(`/api/agents?creator=${address}`)
        if (!res.ok) { setMyAgents([]); setMyLoading(false); return }
        const { agents: backendAgents } = await res.json()
        const withData = await Promise.all(
          backendAgents.map(async (agent: any) => {
            try {
              const poolRes = await fetch(`/api/pool/${agent.poolId}`)
              const poolData = poolRes.ok ? await poolRes.json() : {}
              return {
                ...agent,
                marketCap: poolData.marketCap || 0,
                volume24h: poolData.volume24h || 0,
                trades24h: poolData.trades?.length || 0,
                earnings: (poolData.volume24h || 0) * 0.008,
                pairType: (poolData.pairType as PairToken) || 'SUI',
              }
            } catch { return { ...agent, marketCap: 0, volume24h: 0, trades24h: 0, earnings: 0, pairType: 'SUI' as PairToken } }
          })
        )
        setMyAgents(withData)
      } catch { setMyAgents([]) }
      finally { setMyLoading(false) }
    }
    fetchMyAgents()
  }, [pageTab, address])

  // All agents filtering/sorting
  const filteredTokens = tokens.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.symbol.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'ai-agents' && !t.isAiLaunched) return false
    if (filter === 'trending' && (t.priceChange24h || 0) < 10) return false
    if (filter === 'new' && t.age && !t.age.includes('min') && !t.age.includes('h')) return false
    if (filter === 'graduating' && (t.bondingProgress || 0) < 70) return false
    return true
  })
  const sortedTokens = [...filteredTokens].sort((a, b) => {
    switch (sort) {
      case 'marketcap': return (b.marketCap || 0) - (a.marketCap || 0)
      case 'trending': return (b.priceChange24h || 0) - (a.priceChange24h || 0)
      case 'progress': return (b.bondingProgress || 0) - (a.bondingProgress || 0)
      default: return 0
    }
  })

  // My agents filtering
  const filteredMyAgents = myAgents.filter(a => {
    if (myFilter !== 'all' && a.status !== myFilter) return false
    if (mySearch && !a.name.toLowerCase().includes(mySearch.toLowerCase()) && !a.symbol.toLowerCase().includes(mySearch.toLowerCase())) return false
    return true
  })

  const stats = {
    total: tokens.length,
    aiAgents: tokens.filter(t => t.isAiLaunched).length,
    trending: tokens.filter(t => (t.priceChange24h || 0) >= 10).length,
    graduating: tokens.filter(t => (t.bondingProgress || 0) >= 70).length,
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Hero */}
      <div className="relative border-b border-white/5 bg-gradient-to-b from-[#D4AF37]/5 to-transparent pt-20">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/20 text-[#D4AF37] text-sm font-medium mb-4">
              <Sparkles className="w-4 h-4" />
              <span>Tokenized AI Agents on Sui</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-bold text-[#D4AF37]">The Odyssey</h1>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Discover, trade, and own AI agents. Each agent is a tokenized entity that can earn, trade, and grow autonomously.
            </p>
            <div className="flex items-center justify-center gap-8 pt-8">
              <div className="text-center">
                <div className="text-3xl font-bold text-white">{stats.total}</div>
                <div className="text-sm text-gray-500">Total Agents</div>
              </div>
              <div className="w-px h-12 bg-white/10" />
              <div className="text-center">
                <div className="text-3xl font-bold bg-gradient-to-r from-[#D4AF37] to-[#B8860B] bg-clip-text text-transparent">{stats.aiAgents}</div>
                <div className="text-sm text-gray-500">AI Launched</div>
              </div>
              <div className="w-px h-12 bg-white/10" />
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-400">{stats.trending}</div>
                <div className="text-sm text-gray-500">Trending</div>
              </div>
              <div className="w-px h-12 bg-white/10" />
              <div className="text-center">
                <div className="text-3xl font-bold text-yellow-400">{stats.graduating}</div>
                <div className="text-sm text-gray-500">Graduating</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Tab Bar + Controls */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-slate-950/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Tabs */}
          <div className="flex items-center gap-1 pt-3">
            <button
              onClick={() => setPageTab('all')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-t-lg text-sm font-semibold transition-all border-b-2 ${
                pageTab === 'all'
                  ? 'border-[#D4AF37] text-[#D4AF37]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              All Agents
            </button>
            <button
              onClick={() => setPageTab('mine')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-t-lg text-sm font-semibold transition-all border-b-2 ${
                pageTab === 'mine'
                  ? 'border-[#D4AF37] text-[#D4AF37]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <User className="w-4 h-4" />
              My Agents
              {myAgents.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#D4AF37]/20 text-[#D4AF37] text-[10px] font-bold">{myAgents.length}</span>
              )}
            </button>
          </div>

          {/* Controls — All Agents tab */}
          {pageTab === 'all' && (
            <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between py-4">
              <button
                onClick={() => router.push('/agents/create')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#D4AF37] text-black font-bold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-[#D4AF37]/30"
              >
                <Plus className="w-4 h-4" />
                Create Agent
              </button>
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search agents..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]/50 transition-all"
                />
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
                {(['all', 'ai-agents', 'trending', 'new', 'graduating'] as FilterType[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                      filter === f ? 'bg-[#D4AF37] text-black shadow-lg shadow-[#D4AF37]/30' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/10'
                    }`}
                  >
                    {f === 'ai-agents' && <Sparkles className="w-4 h-4 inline mr-1.5" />}
                    {f === 'trending' && <TrendingUp className="w-4 h-4 inline mr-1.5" />}
                    {f === 'new' && <Clock className="w-4 h-4 inline mr-1.5" />}
                    {f === 'graduating' && <Zap className="w-4 h-4 inline mr-1.5" />}
                    {f.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortType)}
                  className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 appearance-none cursor-pointer"
                >
                  <option value="marketcap">Market Cap</option>
                  <option value="newest">Newest</option>
                  <option value="trending">Trending</option>
                  <option value="progress">Progress</option>
                </select>
                <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1 border border-white/10">
                  <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-[#D4AF37] text-black' : 'text-gray-500 hover:text-white'}`}>
                    <Grid3x3 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setViewMode('large')} className={`p-2 rounded-lg transition-all ${viewMode === 'large' ? 'bg-[#D4AF37] text-black' : 'text-gray-500 hover:text-white'}`}>
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Controls — My Agents tab */}
          {pageTab === 'mine' && (
            <div className="flex flex-col sm:flex-row gap-4 items-center py-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search my agents..."
                  value={mySearch}
                  onChange={(e) => setMySearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 text-sm"
                />
              </div>
              <div className="flex gap-2">
                {(['all', 'active', 'paused'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setMyFilter(f)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${myFilter === f ? 'bg-[#D4AF37] text-black' : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'}`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <button
                onClick={() => router.push('/agents/create')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#D4AF37] text-black font-bold text-sm hover:opacity-90 transition-opacity ml-auto"
              >
                <Plus className="w-4 h-4" />
                Create Agent
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* All Agents */}
        {pageTab === 'all' && (
          loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D4AF37]" />
            </div>
          ) : sortedTokens.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-2xl font-bold text-white mb-2">No agents found</h3>
              <p className="text-gray-500">Try adjusting your filters or search query</p>
            </div>
          ) : (
            <motion.div layout className={`grid gap-6 ${viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
              {sortedTokens.map((token) => (
                <TokenCardPremium key={token.id} token={token} onClick={() => router.push(`/bondingcurve/coins/${token.id}`)} />
              ))}
            </motion.div>
          )
        )}

        {/* My Agents */}
        {pageTab === 'mine' && (
          !address ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Sparkles className="w-16 h-16 text-[#D4AF37] mb-4" />
              <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
              <p className="text-gray-400">Connect your wallet to view your AI agents</p>
            </div>
          ) : myLoading ? (
            <div className="flex items-center justify-center py-24">
              <div className="w-12 h-12 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredMyAgents.length === 0 ? (
            <div className="text-center py-24">
              <Sparkles className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">
                {myAgents.length === 0 ? 'No Agents Yet' : 'No Matching Agents'}
              </h3>
              <p className="text-gray-400 mb-6">
                {myAgents.length === 0 ? 'Create your first AI agent to get started' : 'Try adjusting your filters'}
              </p>
              {myAgents.length === 0 && (
                <button
                  onClick={() => router.push('/agents/create')}
                  className="px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-[#D4AF37] to-[#FFD700] text-black hover:opacity-90 transition-opacity"
                >
                  Create Your First Agent
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredMyAgents.map((agent, i) => {
                const pair = agent.pairType || 'SUI'
                return (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  onClick={() => router.push(`/my-agents/${agent.id}/dashboard`)}
                  className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6 hover:border-[#D4AF37]/50 transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center text-white font-bold text-2xl overflow-hidden">
                      {agent.avatarUrl ? (
                        <img src={agent.avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
                      ) : (
                        agent.symbol.slice(0, 2)
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-white text-lg truncate group-hover:text-[#D4AF37] transition-colors">{agent.name}</h3>
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-gray-400">${agent.symbol}</p>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide border ${
                            pair === 'AIDA'
                              ? 'bg-[#D4AF37]/20 text-[#D4AF37] border-[#D4AF37]/40'
                              : 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                          }`}
                        >
                          {pair}
                        </span>
                      </div>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${
                      agent.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
                      agent.status === 'paused' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {agent.status === 'active' && <Activity className="w-3 h-3" />}
                      {agent.status === 'paused' && <PauseCircle className="w-3 h-3" />}
                      {agent.status.toUpperCase()}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">Market Cap</div>
                      <div className="text-sm font-bold text-white">{agent.marketCap ? '$' + (agent.marketCap >= 1_000_000 ? (agent.marketCap / 1_000_000).toFixed(2) + 'M' : agent.marketCap >= 1000 ? (agent.marketCap / 1000).toFixed(1) + 'K' : agent.marketCap.toFixed(0)) : '—'}</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">24h Volume</div>
                      <div className="text-sm font-bold text-white">{agent.volume24h ? `${agent.volume24h.toFixed(1)} ${pair}` : '—'}</div>
                    </div>
                  </div>
                  <div className="bg-gradient-to-r from-[#D4AF37]/10 to-[#FFD700]/10 border border-[#D4AF37]/20 rounded-lg p-3">
                    <div className="text-xs text-gray-400 mb-1">Your Earnings</div>
                    <div className="text-lg font-bold text-[#D4AF37]">{agent.earnings ? `${agent.earnings.toFixed(3)} ${pair}` : `0.000 ${pair}`}</div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={(e) => { e.stopPropagation(); router.push(`/my-agents/${agent.id}/dashboard`) }}
                      className="flex-1 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium text-white transition-colors"
                    >
                      Dashboard
                    </button>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              )})}
            </div>
          )
        )}
      </div>
    </div>
  )
}
