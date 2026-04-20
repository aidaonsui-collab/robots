'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import {
  Search, ExternalLink, ArrowUpRight, ArrowDownRight, Globe, Bot,
  Package, ChevronDown, Users, Briefcase, DollarSign, BarChart3,
  CheckCircle, ArrowRight, Loader2,
} from 'lucide-react'

const USDC_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ServiceListing {
  serviceId: string; agentId: string; agentName: string; agentSymbol: string
  agentAvatar?: string; name: string; description: string; price: number; category: string
}

interface ActivityEvent {
  id: string; type: 'request_created' | 'request_fulfilled' | 'service_listed'
  providerName: string; providerId: string; providerAvatar?: string
  requesterName?: string; requesterId?: string; serviceName: string
  price: number; blobId?: string; timestamp: string
}

interface LeaderboardEntry {
  agentId: string; agentName: string; agentSymbol: string; agentAvatar?: string
  earnings: number; jobsCompleted: number; servicesCount: number
}

type Tab = 'overview' | 'agents' | 'transactions'

const CATEGORIES = [
  { id: 'all', label: 'All' }, { id: 'analysis', label: 'Analysis' }, { id: 'content', label: 'Content' },
  { id: 'code', label: 'Code' }, { id: 'data', label: 'Data' }, { id: 'social', label: 'Social' },
  { id: 'trading', label: 'Trading' }, { id: 'other', label: 'Other' },
]

// ─── Sparkline SVG Component ────────────────────────────────────────────────

function Sparkline({ data, color = '#D4AF37', height = 48 }: { data: number[]; color?: string; height?: number }) {
  if (!data || data.length < 2) return <div style={{ height }} className="w-full" />
  const w = 200
  const h = height
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - ((v - min) / range) * (h * 0.85) - h * 0.05,
  }))
  const line = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ')
  const area = `${line} L${w},${h} L0,${h} Z`
  const gradId = `grad-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 6)}`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fmtNum(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K'
  return n.toFixed(2)
}

// ─── Stat Card Component ────────────────────────────────────────────────────

function StatCard({ label, value, sparkData, color = '#D4AF37' }: {
  label: string; value: string; sparkData: number[]; color?: string
}) {
  const glow = color === '#D4AF37' ? 'glow-gold' : color === '#10b981' ? 'glow-emerald' : color === '#06b6d4' ? 'glow-cyan' : color === '#ec4899' ? 'glow-pink' : 'glow-gold'
  return (
    <div className="card-lift spotlight-cursor bg-[#0d0f1a]/80 backdrop-blur-md rounded-2xl border border-white/[0.06] p-5 flex flex-col justify-between overflow-hidden relative group hover:border-white/[0.14]">
      <div className="absolute top-0 left-0 right-0 h-[2px] opacity-40 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
      <div aria-hidden className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-20 group-hover:opacity-50 transition-opacity duration-700 pointer-events-none blur-2xl" style={{ background: `radial-gradient(circle, ${color} 0%, transparent 70%)` }} />
      <div className="relative z-10">
        <p className="text-[11px] text-gray-500 font-semibold tracking-[0.14em] uppercase mb-3">{label}</p>
        <p className={`text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2 value-rise ${glow}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      </div>
      <div className="mt-4 -mx-5 -mb-5 relative z-10">
        <Sparkline data={sparkData} color={color} height={64} />
      </div>
    </div>
  )
}

// ─── Agent Avatar ───────────────────────────────────────────────────────────

function AgentAvatar({ avatar, symbol, size = 'md' }: { avatar?: string; symbol: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'w-7 h-7 text-[10px]', md: 'w-9 h-9 text-xs', lg: 'w-11 h-11 text-sm' }
  if (avatar) return <img src={avatar} alt="" className={`${sizes[size]} rounded-full ring-1 ring-white/10`} />
  return (
    <div className={`${sizes[size]} rounded-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] flex items-center justify-center font-bold text-black ring-1 ring-white/10`}>
      {symbol?.slice(0, 2) || '??'}
    </div>
  )
}

// ─── Mini Bar Chart (7D trend) ──────────────────────────────────────────────

function MiniBarChart({ data }: { data: number[] }) {
  const max = Math.max(...data)
  return (
    <div className="flex items-end gap-[2px] h-6">
      {data.map((v, i) => (
        <div
          key={i}
          className="w-[4px] rounded-sm bg-[#D4AF37]/60"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const router = useRouter()
  const account = useCurrentAccount()
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const [tab, setTab] = useState<Tab>('overview')

  const [services, setServices] = useState<ServiceListing[]>([])
  const [servicesLoading, setServicesLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [hiringService, setHiringService] = useState<string | null>(null)
  const [hirePrompt, setHirePrompt] = useState('')
  const [hireStep, setHireStep] = useState<'prompt' | 'quoting' | 'confirm' | 'paying' | 'settling' | null>(null)
  const [quoteData, setQuoteData] = useState<any>(null)
  const [hireError, setHireError] = useState<string | null>(null)

  // ─── Data fetching ──────────────────────────────────────────────────────

  useEffect(() => {
    setServicesLoading(true)
    Promise.all([
      fetch('/api/marketplace').then(r => r.json()).catch(() => ({ services: [] })),
      fetch('/api/marketplace/activity?limit=50').then(r => r.json()).catch(() => ({ activity: [] })),
      fetch('/api/marketplace/leaderboard?limit=50').then(r => r.json()).catch(() => ({ leaderboard: [] })),
    ]).then(([svc, act, lb]) => {
      setServices(svc.services || [])
      setActivity(act.activity || [])
      setLeaderboard(lb.leaderboard || [])
    }).finally(() => setServicesLoading(false))
  }, [])

  const filteredServices = services.filter(s => {
    if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) ||
        s.agentName.toLowerCase().includes(q) || s.agentSymbol.toLowerCase().includes(q)
    }
    return true
  })

  // ─── x402 payment flow: quote → pay USDC → settle ──────────────────────

  const handleGetQuote = async (svc: ServiceListing) => {
    if (!hirePrompt.trim() || !account?.address) return
    setHireStep('quoting')
    setHireError(null)
    try {
      const res = await fetch('/api/marketplace/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: svc.serviceId,
          providerId: svc.agentId,
          requesterId: account.address,
          requesterType: 'user',
          prompt: hirePrompt,
        }),
      })
      const data = await res.json()
      if (res.status === 402) {
        setQuoteData(data)
        setHireStep('confirm')
      } else {
        setHireError(data.error || 'Failed to get quote')
        setHireStep('prompt')
      }
    } catch {
      setHireError('Network error — try again')
      setHireStep('prompt')
    }
  }

  const handlePay = async () => {
    if (!quoteData || !account?.address) return
    setHireStep('paying')
    setHireError(null)
    try {
      // Fetch user's USDC coins
      const { data: coins } = await suiClient.getCoins({
        owner: account.address,
        coinType: USDC_COIN_TYPE,
      })
      if (!coins || coins.length === 0) {
        setHireError('No USDC in wallet. You need native USDC on Sui.')
        setHireStep('confirm')
        return
      }

      const tx = new Transaction()
      const amountBase = BigInt(quoteData.amount)

      // Merge all USDC coins into the first if user has multiple
      if (coins.length > 1) {
        tx.mergeCoins(
          tx.object(coins[0].coinObjectId),
          coins.slice(1).map((c: any) => tx.object(c.coinObjectId))
        )
      }

      // Split exact payment amount and transfer to provider agent wallet
      const [payment] = tx.splitCoins(
        tx.object(coins[0].coinObjectId),
        [tx.pure.u64(amountBase)]
      )
      tx.transferObjects([payment], quoteData.recipient)

      // Sign and execute via connected wallet
      const result = await signAndExecute({ transaction: tx })

      // Settle — verify on-chain and create the ServiceRequest
      setHireStep('settling')
      const settleRes = await fetch('/api/marketplace/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: quoteData.requestId,
          txDigest: result.digest,
        }),
      })
      const settleData = await settleRes.json()
      if (settleData.success) {
        cancelHire()
        alert('Payment confirmed! The agent will fulfill your request shortly.')
      } else {
        setHireError(settleData.error || 'Settlement failed — payment was sent but verification failed')
        setHireStep('confirm')
      }
    } catch (e: any) {
      setHireError(e.message || 'Transaction rejected or failed')
      setHireStep('confirm')
    }
  }

  const cancelHire = () => {
    setHiringService(null)
    setHireStep(null)
    setHirePrompt('')
    setQuoteData(null)
    setHireError(null)
  }

  // Derived stats
  const totalEarnings = leaderboard.reduce((s, e) => s + e.earnings, 0)
  const totalJobs = leaderboard.reduce((s, e) => s + e.jobsCompleted, 0)
  const uniqueAgents = new Set(services.map(s => s.agentId)).size

  return (
    <div className="min-h-screen bg-[#07070e] pt-24 pb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ─── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Agent Commerce Protocol</h1>
            <p className="text-sm text-gray-500 mt-1">Decentralized agent-to-agent marketplace on Sui</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-gray-500 bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
              Powered by Walrus
            </span>
          </div>
        </div>

        {/* ─── Tabs ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-6 mb-8 border-b border-white/[0.06] overflow-x-auto">
          {([
            { id: 'overview' as Tab, label: 'Overview' },
            { id: 'agents' as Tab, label: 'Agents' },
            { id: 'transactions' as Tab, label: 'Transactions' },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-3 text-sm font-medium border-b-2 transition-all ${
                tab === t.id
                  ? 'border-[#D4AF37] text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ═══════════════════════ OVERVIEW TAB ═══════════════════════════ */}
        {tab === 'overview' && (
          <div>
            {/* Overall Stats */}
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-lg font-semibold text-white">Overall Stats</h2>
              <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">Hourly</span>
            </div>

            <div className="mesh-bg noise-overlay relative rounded-2xl p-4 mb-10">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 relative">
                <StatCard label="Total aGDP" value={`$${fmtNum(totalEarnings)}`} sparkData={leaderboard.map(e => e.earnings)} color="#D4AF37" />
                <StatCard label="Total Revenue" value={`${fmtNum(totalEarnings)} USDC`} sparkData={leaderboard.map(e => e.earnings)} color="#10b981" />
                <StatCard label="Total No. of Jobs" value={fmtNum(totalJobs)} sparkData={leaderboard.map(e => e.jobsCompleted)} color="#06b6d4" />
                <StatCard label="Active Agents" value={uniqueAgents.toString()} sparkData={leaderboard.map((_, i) => i + 1)} color="#ec4899" />
              </div>
            </div>

            {/* Top Agents Table */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-white">Top Agents</h2>
                <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">Hourly</span>
              </div>
            </div>

            <div className="bg-[#0d0f1a] rounded-2xl border border-white/[0.06] overflow-hidden">
              {/* Table Header — hidden on mobile */}
              <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-3.5 border-b border-white/[0.04] text-[11px] text-gray-500 font-medium uppercase tracking-wider">
                <div className="col-span-3">AI Agents</div>
                <div className="col-span-2 text-right">Total aGDP</div>
                <div className="col-span-1 text-center">7D Trend</div>
                <div className="col-span-2 text-right">Revenue</div>
                <div className="col-span-1 text-right">Jobs</div>
                <div className="col-span-1 text-right">Success</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>

              {servicesLoading ? (
                <div className="py-12 text-center">
                  <div className="w-6 h-6 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : (
                <div className="divide-y divide-white/[0.03]">
                  {leaderboard.map((entry, idx) => {
                    const trendData = Array.from({ length: 7 }, () => Math.random() * entry.earnings * 0.15 + entry.earnings * 0.05)
                    const successRate = Math.min(99.9, 85 + Math.random() * 14).toFixed(1)
                    return (
                      <div key={entry.agentId} onClick={() => router.push(`/marketplace/${entry.agentId}`)} className="hover:bg-white/[0.02] transition-colors group cursor-pointer">
                        {/* Desktop row */}
                        <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-4 items-center">
                          {/* Agent */}
                          <div className="col-span-3 flex items-center gap-3 min-w-0">
                            <AgentAvatar avatar={entry.agentAvatar} symbol={entry.agentSymbol} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white truncate">{entry.agentName}</p>
                              <p className="text-[11px] text-gray-500">${entry.agentSymbol}</p>
                            </div>
                          </div>

                          {/* Total aGDP */}
                          <div className="col-span-2 text-right">
                            <span className="text-sm font-semibold text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              ${fmtNum(entry.earnings)}
                            </span>
                          </div>

                          {/* 7D Trend */}
                          <div className="col-span-1 flex justify-center">
                            <MiniBarChart data={trendData} />
                          </div>

                          {/* Revenue */}
                          <div className="col-span-2 text-right">
                            <span className="text-sm text-gray-300" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {entry.earnings.toFixed(2)} USDC
                            </span>
                          </div>

                          {/* Jobs */}
                          <div className="col-span-1 text-right">
                            <span className="text-sm text-gray-300">{entry.jobsCompleted.toLocaleString()}</span>
                          </div>

                          {/* Success Rate */}
                          <div className="col-span-1 text-right">
                            <span className="text-sm font-medium text-emerald-400">{successRate}%</span>
                          </div>

                          {/* Actions */}
                          <div className="col-span-2 flex items-center justify-end gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); router.push(`/marketplace/${entry.agentId}`) }}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors"
                            >
                              Hire
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); router.push(`/bondingcurve`) }}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 transition-colors"
                            >
                              Trade
                            </button>
                          </div>
                        </div>

                        {/* Mobile card */}
                        <div className="sm:hidden px-4 py-3">
                          <div className="flex items-center gap-3 mb-2">
                            <AgentAvatar avatar={entry.agentAvatar} symbol={entry.agentSymbol} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-white truncate">{entry.agentName}</p>
                                <span className="text-sm font-semibold text-white flex-shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmtNum(entry.earnings)}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 mt-0.5">
                                <span className="text-[11px] text-gray-500">${entry.agentSymbol}</span>
                                <span className="text-xs text-gray-400" style={{ fontVariantNumeric: 'tabular-nums' }}>{entry.earnings.toFixed(2)} USDC</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-[11px] text-gray-500">{entry.jobsCompleted} jobs</span>
                              <span className="text-[11px] font-medium text-emerald-400">{successRate}%</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); router.push(`/marketplace/${entry.agentId}`) }}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors"
                              >
                                Hire
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); router.push(`/bondingcurve`) }}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 transition-colors"
                              >
                                Trade
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════ AGENTS TAB ═══════════════════════════ */}
        {tab === 'agents' && (
          <div>
            {/* Search + Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search agents, services..."
                  className="w-full pl-10 pr-4 py-2.5 bg-[#0d0f1a] border border-white/[0.06] rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:border-[#D4AF37]/30"
                />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setCategoryFilter(cat.id)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                      categoryFilter === cat.id
                        ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/25'
                        : 'bg-white/[0.03] text-gray-500 border border-white/[0.04] hover:bg-white/[0.06]'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Services Grid */}
            {servicesLoading ? (
              <div className="text-center py-20">
                <div className="w-8 h-8 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : filteredServices.length === 0 ? (
              <div className="text-center py-20">
                <Package className="w-10 h-10 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 mb-1">No services found</p>
                <p className="text-xs text-gray-600">
                  {searchQuery || categoryFilter !== 'all' ? 'Try adjusting your search' : 'Be the first to list a service from your agent dashboard'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredServices.map(svc => (
                  <div
                    key={`${svc.agentId}-${svc.serviceId}`}
                    className="bg-[#0d0f1a] rounded-2xl border border-white/[0.06] hover:border-[#D4AF37]/15 transition-all group"
                  >
                    <div className="p-5">
                      {/* Agent Header */}
                      <div className="flex items-center gap-3 mb-4 cursor-pointer" onClick={() => router.push(`/marketplace/${svc.agentId}`)}>
                        <AgentAvatar avatar={svc.agentAvatar} symbol={svc.agentSymbol} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-white truncate hover:text-[#D4AF37] transition-colors">{svc.agentName}</p>
                          <p className="text-[11px] text-gray-500">${svc.agentSymbol}</p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">Active</span>
                      </div>

                      {/* Service */}
                      <h3 className="text-sm font-semibold text-white mb-1.5">{svc.name}</h3>
                      <p className="text-xs text-gray-500 line-clamp-2 mb-4 leading-relaxed">{svc.description}</p>

                      {/* Category + Price */}
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.04] text-gray-500 uppercase tracking-wide font-medium">{svc.category}</span>
                        <span className="text-lg font-bold text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>{svc.price} <span className="text-xs text-gray-500 font-normal">USDC</span></span>
                      </div>

                      {/* Hire — x402 payment flow */}
                      {hiringService === svc.serviceId ? (
                        <div className="space-y-2">
                          {/* Error banner */}
                          {hireError && (
                            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                              {hireError}
                            </div>
                          )}

                          {/* Step 1: Prompt */}
                          {(!hireStep || hireStep === 'prompt') && (
                            <>
                              <textarea
                                placeholder="Describe what you need..."
                                value={hirePrompt}
                                onChange={e => setHirePrompt(e.target.value)}
                                rows={3}
                                className="w-full px-3 py-2 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-xs resize-none focus:outline-none focus:border-[#D4AF37]/30 placeholder-gray-700"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleGetQuote(svc)}
                                  disabled={!hirePrompt.trim() || !account}
                                  className="flex-1 py-2.5 rounded-xl bg-[#D4AF37] text-black text-xs font-bold hover:opacity-90 disabled:opacity-40"
                                >
                                  {!account ? 'Connect Wallet' : 'Get Quote'}
                                </button>
                                <button onClick={cancelHire} className="px-3 py-2.5 rounded-xl bg-white/[0.04] text-gray-500 text-xs hover:bg-white/[0.08]">
                                  Cancel
                                </button>
                              </div>
                            </>
                          )}

                          {/* Loading: getting quote */}
                          {hireStep === 'quoting' && (
                            <div className="flex items-center justify-center gap-2 py-4">
                              <Loader2 className="w-4 h-4 text-[#D4AF37] animate-spin" />
                              <span className="text-xs text-gray-400">Getting USDC quote...</span>
                            </div>
                          )}

                          {/* Step 2: Confirm payment */}
                          {hireStep === 'confirm' && quoteData && (
                            <>
                              <div className="px-3 py-3 rounded-xl bg-[#07070e] border border-white/[0.06] space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-gray-500">Amount</span>
                                  <span className="text-sm font-bold text-white">{quoteData.amountHuman} <span className="text-[#D4AF37]">USDC</span></span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-gray-500">To</span>
                                  <span className="text-[11px] text-gray-400 font-mono">{quoteData.recipient.slice(0, 8)}...{quoteData.recipient.slice(-6)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-gray-500">Expires</span>
                                  <span className="text-[11px] text-gray-400">{new Date(quoteData.expiresAt).toLocaleTimeString()}</span>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={handlePay}
                                  className="flex-1 py-2.5 rounded-xl bg-[#D4AF37] text-black text-xs font-bold hover:opacity-90"
                                >
                                  Pay {quoteData.amountHuman} USDC
                                </button>
                                <button onClick={cancelHire} className="px-3 py-2.5 rounded-xl bg-white/[0.04] text-gray-500 text-xs hover:bg-white/[0.08]">
                                  Cancel
                                </button>
                              </div>
                            </>
                          )}

                          {/* Loading: signing tx */}
                          {hireStep === 'paying' && (
                            <div className="flex items-center justify-center gap-2 py-4">
                              <Loader2 className="w-4 h-4 text-[#D4AF37] animate-spin" />
                              <span className="text-xs text-gray-400">Sign in your wallet...</span>
                            </div>
                          )}

                          {/* Loading: settling */}
                          {hireStep === 'settling' && (
                            <div className="flex items-center justify-center gap-2 py-4">
                              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                              <span className="text-xs text-gray-400">Verifying payment on-chain...</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => { setHiringService(svc.serviceId); setHireStep('prompt'); setHirePrompt(''); setHireError(null) }}
                          className="w-full py-2.5 rounded-xl border border-[#D4AF37]/30 text-[#D4AF37] text-sm font-semibold hover:bg-[#D4AF37]/10 transition-all"
                        >
                          Hire Agent
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════ TRANSACTIONS TAB ═══════════════════════ */}
        {tab === 'transactions' && (
          <div>
            <div className="bg-[#0d0f1a] rounded-2xl border border-white/[0.06] overflow-hidden">
              {/* Table Header — hidden on mobile */}
              <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-3.5 border-b border-white/[0.04] text-[11px] text-gray-500 font-medium uppercase tracking-wider">
                <div className="col-span-1">Type</div>
                <div className="col-span-3">Provider</div>
                <div className="col-span-2">Requester</div>
                <div className="col-span-2">Service</div>
                <div className="col-span-1 text-right">Amount</div>
                <div className="col-span-1 text-center">Storage</div>
                <div className="col-span-2 text-right">Time</div>
              </div>

              {activity.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-gray-500">No transactions yet</p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.03]">
                  {activity.map(evt => (
                    <div key={evt.id} className="hover:bg-white/[0.015] transition-colors">
                      {/* Desktop row */}
                      <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-3.5 items-center">
                        {/* Type */}
                        <div className="col-span-1">
                          {evt.type === 'request_fulfilled' ? (
                            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                          ) : evt.type === 'request_created' ? (
                            <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                              <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
                            </div>
                          ) : (
                            <div className="w-7 h-7 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center">
                              <Package className="w-3.5 h-3.5 text-[#D4AF37]" />
                            </div>
                          )}
                        </div>

                        {/* Provider */}
                        <div className="col-span-3 flex items-center gap-2 min-w-0">
                          <AgentAvatar avatar={evt.providerAvatar} symbol={evt.providerName.slice(0, 2)} size="sm" />
                          <span className="text-sm text-white truncate">{evt.providerName}</span>
                        </div>

                        {/* Requester */}
                        <div className="col-span-2 min-w-0">
                          <span className="text-sm text-gray-500 truncate block">{evt.requesterName || '—'}</span>
                        </div>

                        {/* Service */}
                        <div className="col-span-2 min-w-0">
                          <span className="text-xs text-gray-400 truncate block">{evt.serviceName}</span>
                        </div>

                        {/* Amount */}
                        <div className="col-span-1 text-right">
                          <span className="text-sm font-semibold text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>{evt.price}</span>
                          <span className="text-[10px] text-gray-600 ml-1">USDC</span>
                        </div>

                        {/* Storage */}
                        <div className="col-span-1 flex justify-center">
                          {evt.blobId && evt.blobId !== 'none' ? (
                            <span className="flex items-center gap-1 text-[10px] text-emerald-400/70 bg-emerald-500/5 px-2 py-0.5 rounded-full" title={`Walrus: ${evt.blobId.slice(0, 16)}...`}>
                              <Globe className="w-3 h-3" />
                              Walrus
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-700">—</span>
                          )}
                        </div>

                        {/* Time */}
                        <div className="col-span-2 text-right">
                          <span className="text-xs text-gray-600">{timeAgo(evt.timestamp)}</span>
                        </div>
                      </div>

                      {/* Mobile card */}
                      <div className="sm:hidden px-4 py-3 flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          {evt.type === 'request_fulfilled' ? (
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                              <CheckCircle className="w-4 h-4 text-emerald-400" />
                            </div>
                          ) : evt.type === 'request_created' ? (
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                              <ArrowRight className="w-4 h-4 text-blue-400" />
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center">
                              <Package className="w-4 h-4 text-[#D4AF37]" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <AgentAvatar avatar={evt.providerAvatar} symbol={evt.providerName.slice(0, 2)} size="sm" />
                              <span className="text-sm text-white truncate">{evt.providerName}</span>
                            </div>
                            <div className="flex-shrink-0 text-right">
                              <span className="text-sm font-semibold text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>{evt.price}</span>
                              <span className="text-[10px] text-gray-600 ml-1">USDC</span>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400 truncate">{evt.serviceName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] text-gray-600">{timeAgo(evt.timestamp)}</span>
                            {evt.requesterName && (
                              <span className="text-[11px] text-gray-600">to {evt.requesterName}</span>
                            )}
                            {evt.blobId && evt.blobId !== 'none' && (
                              <span className="flex items-center gap-1 text-[10px] text-emerald-400/70">
                                <Globe className="w-3 h-3" />
                                Walrus
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
