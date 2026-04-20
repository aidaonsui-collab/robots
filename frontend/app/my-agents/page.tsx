'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { Sparkles, Plus, Search, Filter, Activity, PauseCircle, PlayCircle, Settings } from 'lucide-react'
import { motion } from 'framer-motion'
import { type PairToken } from '@/lib/contracts_aida'

interface Agent {
  id: string
  name: string
  symbol: string
  avatarUrl: string
  tokenType: string
  poolId: string
  status: 'creating' | 'active' | 'paused' | 'stopped'
  llmModel: string
  createdAt: string
  // Stats
  marketCap?: number
  volume24h?: number
  trades24h?: number
  earnings?: number
  pairType?: PairToken
}

export default function MyAgentsPage() {
  const router = useRouter()
  const account = useCurrentAccount()
  const address = account?.address
  
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!address) {
      setLoading(false)
      return
    }

    async function fetchAgents() {
      try {
        // Fetch agents created by this wallet
        const response = await fetch(`/api/agents?creator=${address}`)
        
        if (!response.ok) {
          console.error('Failed to fetch agents:', response.statusText)
          setAgents([])
          setLoading(false)
          return
        }

        const { agents: backendAgents } = await response.json()
        
        // Fetch token data for each agent
        const agentsWithData = await Promise.all(
          backendAgents.map(async (agent: any) => {
            try {
              // Fetch pool data from blockchain
              const poolResponse = await fetch(`/api/pool/${agent.poolId}`)
              if (!poolResponse.ok) {
                return {
                  ...agent,
                  marketCap: 0,
                  volume24h: 0,
                  trades24h: 0,
                  earnings: 0,
                  pairType: 'SUI' as PairToken,
                }
              }

              const poolData = await poolResponse.json()
              
              // Calculate creator earnings (30% of trading fees per moonbags_aida contract constants).
              // Trading fee is 2% per trade → creator gets 30% of that = 0.6% of volume.
              const earnings = (poolData.volume24h || 0) * 0.006

              return {
                id: agent.id,
                name: agent.name,
                symbol: agent.symbol,
                avatarUrl: agent.avatarUrl,
                tokenType: agent.tokenType,
                poolId: agent.poolId,
                status: agent.status,
                llmModel: agent.llmModel,
                createdAt: agent.createdAt,
                marketCap: poolData.marketCap || 0,
                volume24h: poolData.volume24h || 0,
                trades24h: poolData.trades?.length || 0,
                earnings: earnings,
                pairType: (poolData.pairType as PairToken) || 'SUI',
              }
            } catch (error) {
              console.error('Error fetching pool data for agent:', agent.id, error)
              return {
                ...agent,
                marketCap: 0,
                volume24h: 0,
                trades24h: 0,
                earnings: 0,
                pairType: 'SUI' as PairToken,
              }
            }
          })
        )

        setAgents(agentsWithData)
      } catch (error) {
        console.error('Error fetching agents:', error)
        setAgents([])
      } finally {
        setLoading(false)
      }
    }

    fetchAgents()
  }, [address])

  const filteredAgents = agents.filter(agent => {
    if (filter !== 'all' && agent.status !== filter) return false
    if (search && !agent.name.toLowerCase().includes(search.toLowerCase()) && 
        !agent.symbol.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  if (!address) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Sparkles className="w-16 h-16 text-[#D4AF37] mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
          <p className="text-gray-400">Connect your wallet to view your AI agents</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-[#D4AF37] mb-2">My AI Agents</h1>
            <p className="text-gray-400">Manage and monitor your tokenized AI agents</p>
          </div>
          
          <button
            onClick={() => router.push('/agents/create')}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-[#D4AF37] to-[#FFD700] text-black hover:opacity-90 transition-opacity shadow-lg"
          >
            <Plus className="w-5 h-5" />
            Create Agent
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-800/50 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 text-white placeholder:text-gray-500"
            />
          </div>

          <div className="flex gap-2">
            {(['all', 'active', 'paused'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                  filter === f
                    ? 'bg-[#D4AF37] text-black'
                    : 'bg-slate-800/50 text-gray-400 hover:text-white border border-white/10'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Agent Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-12 h-12 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="text-center py-24">
            <Sparkles className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">
              {agents.length === 0 ? 'No Agents Yet' : 'No Matching Agents'}
            </h3>
            <p className="text-gray-400 mb-6">
              {agents.length === 0 
                ? 'Create your first AI agent to get started'
                : 'Try adjusting your filters'}
            </p>
            {agents.length === 0 && (
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
            {filteredAgents.map((agent, i) => {
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
                {/* Agent Header */}
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center text-white font-bold text-2xl overflow-hidden">
                    {agent.avatarUrl ? (
                      <img src={agent.avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
                    ) : (
                      agent.symbol.slice(0, 2)
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white text-lg truncate group-hover:text-[#D4AF37] transition-colors">
                      {agent.name}
                    </h3>
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

                  {/* Status Badge */}
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

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-white/5 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-1">Market Cap</div>
                    <div className="text-sm font-bold text-white">
                      ${agent.marketCap ? (agent.marketCap / 1000).toFixed(1) + 'K' : '—'}
                    </div>
                  </div>
                  
                  <div className="bg-white/5 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-1">24h Volume</div>
                    <div className="text-sm font-bold text-white">
                      {agent.volume24h ? `${agent.volume24h.toFixed(1)} ${pair}` : '—'}
                    </div>
                  </div>
                </div>

                {/* Earnings */}
                <div className="bg-gradient-to-r from-[#D4AF37]/10 to-[#FFD700]/10 border border-[#D4AF37]/20 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Your Earnings</div>
                  <div className="text-lg font-bold text-[#D4AF37]">
                    {agent.earnings ? `${agent.earnings.toFixed(3)} ${pair}` : `0.000 ${pair}`}
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      router.push(`/my-agents/${agent.id}/dashboard`)
                    }}
                    className="flex-1 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium text-white transition-colors"
                  >
                    Dashboard
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      // TODO: Quick settings
                    }}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )})}
          </div>
        )}
      </div>
    </div>
  )
}
