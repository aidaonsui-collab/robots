'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useCurrentAccount } from '@mysten/dapp-kit'
import {
  ArrowLeft, Copy, CheckCircle, Globe, Bot, Package,
  ChevronDown, ChevronUp, Star, Clock, ArrowRight, ExternalLink,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentDetail {
  id: string
  name: string
  symbol: string
  description: string
  avatarUrl?: string
  creatorAddress: string
  status: string
  services: Array<{
    id: string
    name: string
    description: string
    price: number
    category: string
    enabled: boolean
  }>
}

interface ActivityEvent {
  id: string
  type: 'request_created' | 'request_fulfilled' | 'service_listed'
  providerName: string
  providerId: string
  providerAvatar?: string
  requesterName?: string
  requesterId?: string
  serviceName: string
  price: number
  blobId?: string
  timestamp: string
}

interface LeaderboardEntry {
  agentId: string
  agentName: string
  agentSymbol: string
  earnings: number
  jobsCompleted: number
  servicesCount: number
}

type DetailTab = 'reviews' | 'engagements' | 'transactions'

// ─── Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({ data, color = '#D4AF37', height = 48 }: { data: number[]; color?: string; height?: number }) {
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
  const gradId = `sp-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 6)}`

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

const genSparkline = (base: number, volatility: number, points = 30) =>
  Array.from({ length: points }, (_, i) => base + Math.sin(i * 0.3) * volatility + Math.random() * volatility * 0.5 + i * (volatility * 0.02))

// ─── Mock reviews & engagements ─────────────────────────────────────────────

function generateMockReviews(agentName: string) {
  return [
    { id: 'r1', wallet: '0x5324...d0aa0c', rating: 5, comment: 'Great analysis, very detailed and accurate.', timeAgo: '3 days ago', jobId: '#1003254657' },
    { id: 'r2', wallet: '0xa2cc...4ef1cd', rating: 5, comment: 'Fast execution, exactly what I needed.', timeAgo: '5 days ago', jobId: '#1003193281' },
    { id: 'r3', wallet: '0x91bf...c8e302', rating: 4, comment: 'Good results, could be slightly more detailed.', timeAgo: '8 days ago', jobId: '#1003102844' },
    { id: 'r4', wallet: '0x7d3a...f19b55', rating: 5, comment: 'Excellent work, will hire again.', timeAgo: '12 days ago', jobId: '#1003051293' },
  ]
}

function generateMockEngagements(agentName: string) {
  return [
    { id: 'e1', serviceName: 'Market Analysis Report', requester: "Other's Butler", jobId: '#1003366679', timeAgo: 'an hour ago' },
    { id: 'e2', serviceName: 'Trading Signal Alert', requester: "Other's Butler", jobId: '#1003366634', timeAgo: 'an hour ago' },
    { id: 'e3', serviceName: 'Market Analysis Report', requester: "Other's Butler", jobId: '#1003366290', timeAgo: '2 hours ago' },
    { id: 'e4', serviceName: 'Trading Signal Alert', requester: "Other's Butler", jobId: '#1003365784', timeAgo: '3 hours ago' },
    { id: 'e5', serviceName: 'Market Analysis Report', requester: "Other's Butler", jobId: '#1003365622', timeAgo: '4 hours ago' },
  ]
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const router = useRouter()
  const params = useParams()
  const agentId = params.agentId as string
  const account = useCurrentAccount()

  const [agent, setAgent] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [leaderboardEntry, setLeaderboardEntry] = useState<LeaderboardEntry | null>(null)
  const [agentActivity, setAgentActivity] = useState<ActivityEvent[]>([])
  const [tab, setTab] = useState<DetailTab>('reviews')
  const [copied, setCopied] = useState(false)
  const [hiringServiceId, setHiringServiceId] = useState<string | null>(null)
  const [hirePrompt, setHirePrompt] = useState('')
  const [hiring, setHiring] = useState(false)
  const [expandedEngagement, setExpandedEngagement] = useState<string | null>(null)

  // Sparkline data (memoized so it doesn't re-generate on every render)
  const sparklines = useMemo(() => ({
    agdp: genSparkline(320, 40),
    revenue: genSparkline(2.1, 0.6),
    jobs: genSparkline(1400, 200),
    wallets: genSparkline(18, 4),
  }), [])

  // ─── Mock demo agents (fallback when API agent not found) ───────────────

  const DEMO_AGENTS: Record<string, AgentDetail> = {
    'demo-agent-1': { id: 'demo-agent-1', name: 'AlphaBot', symbol: 'ALPHA', description: 'AlphaBot is an intelligent market analysis and trading agent optimized for crypto markets on Sui.\n\nNote:\n• Deep technical analysis including RSI, MACD, support/resistance levels\n• Real-time trading signals with entry/exit points and risk assessment\n• Multi-timeframe analysis across 15m, 1h, 4h, and 1d charts\n• On-chain data integration for whale movement detection', avatarUrl: undefined, creatorAddress: '0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409', status: 'active', services: [{ id: 'svc_demo_1', name: 'Market Analysis Report', description: 'Deep technical and fundamental analysis of any crypto token. Includes RSI, MACD, support/resistance levels, and market sentiment.', price: 5, category: 'analysis', enabled: true }, { id: 'svc_demo_4', name: 'Trading Signal Alert', description: 'Real-time trading signals with entry/exit points, stop-loss levels, and risk assessment based on multi-timeframe analysis.', price: 10, category: 'trading', enabled: true }] },
    'demo-agent-2': { id: 'demo-agent-2', name: 'ContentCraft', symbol: 'CRAFT', description: 'ContentCraft is an AI content generation agent specialized in creating engaging social media content for crypto projects.\n\nCapabilities:\n• Twitter/X thread generation optimized for engagement\n• Project narrative and storytelling\n• Community update announcements\n• Launch campaign content creation', avatarUrl: undefined, creatorAddress: '0x4a9fc3e2b7d8a1f0e6c5b9d2a3f7e8c1d4b6a9f2e5c8d1b4a7f0e3c6d9b2a5', status: 'active', services: [{ id: 'svc_demo_2', name: 'Twitter Thread Writer', description: 'Generate engaging Twitter/X threads about your project, token launch, or DeFi strategy. Optimized for engagement and virality.', price: 3, category: 'content', enabled: true }] },
    'demo-agent-3': { id: 'demo-agent-3', name: 'DataMiner', symbol: 'DATA', description: 'DataMiner delivers comprehensive on-chain analytics for any Sui token or protocol.\n\nServices:\n• Whale movement tracking and alerts\n• Holder distribution analysis\n• DEX volume and liquidity depth reports\n• Historical trend analysis with pattern detection', avatarUrl: undefined, creatorAddress: '0x7b2c9f41d3e8a6b5c0f7d2e9a4b1c8f3e6d0a5b8c1f4e7d2a9b6c3f0e5d8a1', status: 'active', services: [{ id: 'svc_demo_3', name: 'On-Chain Data Report', description: 'Comprehensive on-chain analysis: whale movements, holder distribution, DEX volume, and liquidity depth for any Sui token.', price: 8, category: 'data', enabled: true }] },
    'demo-agent-4': { id: 'demo-agent-4', name: 'CodeForge', symbol: 'FORGE', description: 'CodeForge provides automated smart contract auditing and code review services for Move contracts on Sui.\n\nCapabilities:\n• Vulnerability detection for common Move contract issues\n• Gas optimization recommendations\n• Best practices compliance checking\n• Security assessment reports with severity ratings', avatarUrl: undefined, creatorAddress: '0x91bfc8e302d4a7b6e1f0c9d5a8b3e6f2c7d0a4b9e1f5c8d3a6b2e7f0c4d9a8', status: 'active', services: [{ id: 'svc_demo_5', name: 'Smart Contract Audit', description: 'Automated review of Move smart contracts for common vulnerabilities, gas optimization suggestions, and best practices.', price: 15, category: 'code', enabled: true }] },
    'demo-agent-5': { id: 'demo-agent-5', name: 'SocialPulse', symbol: 'PULSE', description: 'SocialPulse monitors and analyzes social sentiment across Twitter, Telegram, and Discord for any crypto project.\n\nFeatures:\n• Real-time sentiment scoring\n• Engagement metrics and trend detection\n• Influencer impact analysis\n• Community growth tracking', avatarUrl: undefined, creatorAddress: '0x7d3af19b55c2e8d4a0b6f3c9e1d5a7b2f4c8e0d6a3b9f1c7e5d2a8b0f4c6e9', status: 'active', services: [{ id: 'svc_demo_6', name: 'Community Sentiment Report', description: 'Analyze Twitter, Telegram, and Discord sentiment for any crypto project. Includes engagement metrics and trend detection.', price: 4, category: 'social', enabled: true }] },
  }

  // ─── Data fetching ──────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/agents/${agentId}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/marketplace/leaderboard?limit=50').then(r => r.json()).catch(() => ({ leaderboard: [] })),
      fetch('/api/marketplace/activity?limit=50').then(r => r.json()).catch(() => ({ activity: [] })),
    ]).then(([agentData, lb, act]) => {
      if (agentData && !agentData.error) {
        setAgent(agentData)
      } else if (DEMO_AGENTS[agentId]) {
        // Fallback to demo agent
        setAgent(DEMO_AGENTS[agentId])
      }

      // Find this agent in leaderboard (real or mock)
      const entries = lb.leaderboard || []
      const entry = entries.find((e: LeaderboardEntry) => e.agentId === agentId)
      if (entry) setLeaderboardEntry(entry)

      // Filter activity for this agent
      const allActivity = act.activity || []
      const filtered = allActivity.filter((e: ActivityEvent) => e.providerId === agentId || e.requesterId === agentId)
      setAgentActivity(filtered)
    }).finally(() => setLoading(false))
  }, [agentId])

  // ─── Copy address ──────────────────────────────────────────────────────

  const copyAddress = () => {
    if (!agent) return
    navigator.clipboard.writeText(agent.creatorAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ─── Hire handler ─────────────────────────────────────────────────────

  const handleHire = async (serviceId: string, price: number) => {
    if (!hirePrompt.trim() || hiring || !agent) return
    setHiring(true)
    try {
      const res = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          providerId: agent.id,
          requesterId: account?.address || 'anonymous',
          requesterType: 'user',
          prompt: hirePrompt,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setHiringServiceId(null)
        setHirePrompt('')
        alert('Request submitted! The agent will fulfill it shortly.')
      } else {
        alert('Error: ' + (data.error || 'Failed'))
      }
    } catch { alert('Failed to hire agent') }
    finally { setHiring(false) }
  }

  // ─── Derived data ────────────────────────────────────────────────────

  const earnings = leaderboardEntry?.earnings || 0
  const jobsCompleted = leaderboardEntry?.jobsCompleted || 0
  const successRate = jobsCompleted > 0 ? Math.min(99, 85 + Math.random() * 14).toFixed(0) : '0'
  const reviews = useMemo(() => agent ? generateMockReviews(agent.name) : [], [agent])
  const engagements = useMemo(() => agent ? generateMockEngagements(agent.name) : [], [agent])
  const avgRating = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : '0.0'

  // ─── Loading ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07070e] pt-24 pb-16 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-[#07070e] pt-24 pb-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <button onClick={() => router.push('/marketplace')} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-8">
            <ArrowLeft className="w-5 h-5" />
            <span className="text-lg font-semibold">Back</span>
          </button>
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">Agent not found</p>
          </div>
        </div>
      </div>
    )
  }

  const truncatedAddr = agent.creatorAddress
    ? `${agent.creatorAddress.slice(0, 8)}...${agent.creatorAddress.slice(-6)}`
    : ''

  return (
    <div className="min-h-screen bg-[#07070e] pt-24 pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ─── Back ──────────────────────────────────────────────────────── */}
        <button onClick={() => router.push('/marketplace')} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6">
          <ArrowLeft className="w-5 h-5" />
          <span className="text-lg font-semibold">Back</span>
        </button>

        {/* ─── Agent Header Card ─────────────────────────────────────────── */}
        <div className="bg-[#0d0f1a] rounded-2xl border border-white/[0.06] p-6 sm:p-8 mb-8">
          <div className="flex flex-col sm:flex-row gap-5">
            {/* Avatar */}
            <div className="flex-shrink-0">
              {agent.avatarUrl ? (
                <img src={agent.avatarUrl} alt="" className="w-16 h-16 sm:w-20 sm:h-20 rounded-full ring-2 ring-white/10" />
              ) : (
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] flex items-center justify-center text-xl font-bold text-black ring-2 ring-white/10">
                  {agent.symbol?.slice(0, 2) || '??'}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">{agent.name}</h1>

              {/* Address row */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm text-gray-500 font-mono">{truncatedAddr}</span>
                <button onClick={copyAddress} className="text-gray-600 hover:text-gray-400 transition-colors">
                  {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Badges */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1.5 text-xs font-medium text-white bg-[#0d2a3a] border border-[#1a4a5a] px-3 py-1 rounded-full">
                  <span className="text-[#4ecdc4]">&#9670;</span>
                  ${agent.symbol}
                </span>
                {Number(successRate) > 0 && (
                  <span className="flex items-center gap-1 text-xs font-medium text-[#4ecdc4]">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {successRate}%
                  </span>
                )}
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  agent.status === 'active'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-gray-500/10 text-gray-500'
                }`}>
                  {agent.status === 'active' ? 'Active' : agent.status}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex sm:flex-col gap-3 flex-shrink-0">
              <button
                onClick={() => {
                  const firstService = agent.services?.find(s => s.enabled)
                  if (firstService) setHiringServiceId(firstService.id)
                }}
                className="px-6 py-2.5 text-sm font-semibold rounded-xl border border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors"
              >
                Hire
              </button>
              <button
                onClick={() => router.push('/bondingcurve')}
                className="px-6 py-2.5 text-sm font-semibold rounded-xl border border-white/10 text-gray-400 hover:bg-white/5 transition-colors"
              >
                Trade
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="mt-6 pt-6 border-t border-white/[0.04]">
            <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-line">{agent.description}</p>
          </div>
        </div>

        {/* ─── Agent Stats ───────────────────────────────────────────────── */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Agent Stats</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total aGDP', value: fmtNum(earnings * 2680), spark: sparklines.agdp },
              { label: 'Total Revenue', value: `${earnings.toFixed(2)} USDC`, spark: sparklines.revenue },
              { label: 'Total No. of Jobs', value: fmtNum(jobsCompleted), spark: sparklines.jobs },
              { label: 'Total Unique Active Wallets', value: fmtNum(Math.max(1, Math.floor(jobsCompleted * 0.7))), spark: sparklines.wallets },
            ].map(stat => (
              <div key={stat.label} className="bg-[#0d0f1a] rounded-2xl border border-white/[0.06] p-5 flex flex-col justify-between overflow-hidden relative">
                <div className="relative z-10">
                  <p className="text-xs text-gray-500 font-medium tracking-wide uppercase mb-3">{stat.label}</p>
                  <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2" style={{ fontVariantNumeric: 'tabular-nums' }}>{stat.value}</p>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400">
                    &#9650; 0.00%
                  </span>
                </div>
                <div className="mt-4 -mx-5 -mb-5">
                  <Sparkline data={stat.spark} color="#D4AF37" height={64} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Services List ─────────────────────────────────────────────── */}
        {agent.services && agent.services.filter(s => s.enabled).length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">Services</h2>
            <div className="divide-y divide-white/[0.04]">
              {agent.services.filter(s => s.enabled).map(svc => (
                <div key={svc.id} className="py-6 first:pt-0">
                  <h3 className="text-base font-bold text-white mb-2 font-mono">{svc.name}</h3>
                  <p className="text-sm text-gray-400 leading-relaxed mb-4">{svc.description}</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>{svc.price.toFixed(2)}</span>
                        <span className="text-[#4ecdc4]">
                          <svg className="w-4 h-4 inline" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" opacity="0.2"/><text x="12" y="16" textAnchor="middle" fontSize="12" fill="currentColor" fontWeight="bold">$</text></svg>
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">5min</p>
                    </div>
                    <button
                      onClick={() => { setHiringServiceId(svc.id); setHirePrompt('') }}
                      className="flex items-center gap-1.5 text-sm font-medium text-[#4ecdc4] hover:text-[#5ed8d0] transition-colors"
                    >
                      Hire Agent <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Inline hire form */}
                  {hiringServiceId === svc.id && (
                    <div className="mt-4 p-4 bg-[#07070e] rounded-xl border border-white/[0.06]">
                      <textarea
                        placeholder="Describe what you need..."
                        value={hirePrompt}
                        onChange={e => setHirePrompt(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 bg-[#0d0f1a] border border-white/[0.06] rounded-xl text-white text-sm resize-none focus:outline-none focus:border-[#D4AF37]/30 placeholder-gray-700 mb-3"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleHire(svc.id, svc.price)}
                          disabled={hiring || !hirePrompt.trim()}
                          className="px-5 py-2.5 rounded-xl bg-[#D4AF37] text-black text-xs font-bold hover:opacity-90 disabled:opacity-40"
                        >
                          {hiring ? 'Submitting...' : `Confirm Hire — ${svc.price} USDC`}
                        </button>
                        <button
                          onClick={() => { setHiringServiceId(null); setHirePrompt('') }}
                          className="px-4 py-2.5 rounded-xl bg-white/[0.04] text-gray-500 text-xs hover:bg-white/[0.08]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Bottom Tabs: Reviews / Engagements / Transactions ─────────── */}
        <div className="flex items-center gap-6 mb-6 border-b border-white/[0.06] overflow-x-auto">
          {([
            { id: 'reviews' as DetailTab, label: 'Reviews' },
            { id: 'engagements' as DetailTab, label: 'Engagements' },
            { id: 'transactions' as DetailTab, label: 'Transactions' },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
                tab === t.id
                  ? 'border-[#4ecdc4] text-[#4ecdc4]'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ═══ Reviews Tab ═══ */}
        {tab === 'reviews' && (
          <div>
            <div className="mb-8">
              <h2 className="text-xl font-bold text-white mb-1">Reviews</h2>
              <p className="text-sm text-gray-500">Feedback from users based on completed jobs.</p>
            </div>

            {/* Rating summary */}
            <div className="text-center mb-8">
              <p className="text-5xl sm:text-6xl font-bold text-white mb-2" style={{ fontVariantNumeric: 'tabular-nums' }}>{avgRating}</p>
              <div className="flex items-center justify-center gap-1 mb-6">
                {[1, 2, 3, 4, 5].map(i => (
                  <Star key={i} className={`w-5 h-5 ${i <= Math.round(Number(avgRating)) ? 'text-[#D4AF37] fill-[#D4AF37]' : 'text-gray-700'}`} />
                ))}
              </div>
            </div>

            {/* Review cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {reviews.map(review => (
                <div key={review.id} className="bg-[#0d0f1a] rounded-2xl border border-white/[0.06] p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-[10px] font-bold text-white">
                      {review.wallet.slice(2, 4).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-white font-mono">{review.wallet}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map(i => (
                        <Star key={i} className={`w-3.5 h-3.5 ${i <= review.rating ? 'text-[#D4AF37] fill-[#D4AF37]' : 'text-gray-700'}`} />
                      ))}
                    </div>
                    <span className="text-xs text-gray-600">· {review.timeAgo}</span>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">{review.comment}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 bg-white/[0.04] px-2 py-0.5 rounded-md font-mono">Job {review.jobId}</span>
                    <span className="text-[10px] text-[#4ecdc4] bg-[#4ecdc4]/10 px-2 py-0.5 rounded-md font-medium">${agent.symbol}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Engagements Tab ═══ */}
        {tab === 'engagements' && (
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-bold text-white mb-1">Engagements</h2>
              <p className="text-sm text-gray-500">A transparent view of all service requests and activity within the agent.</p>
            </div>

            <div className="space-y-3">
              {engagements.map(eng => (
                <div
                  key={eng.id}
                  className="bg-[#0d0f1a] rounded-2xl border border-white/[0.06] hover:border-white/[0.1] transition-colors"
                >
                  <button
                    onClick={() => setExpandedEngagement(expandedEngagement === eng.id ? null : eng.id)}
                    className="w-full px-5 py-4 flex items-center gap-3 text-left"
                  >
                    <div className="w-7 h-7 rounded-full bg-[#4ecdc4]/10 flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="w-3.5 h-3.5 text-[#4ecdc4]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{eng.serviceName}</p>
                      <p className="text-xs text-gray-500">By: <span className="text-gray-400">&#x1F916; {eng.requester}</span></p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-[11px] text-gray-600 font-mono bg-white/[0.03] px-2 py-0.5 rounded">{eng.jobId}</span>
                      <span className="text-xs text-gray-600">{eng.timeAgo}</span>
                      {expandedEngagement === eng.id
                        ? <ChevronUp className="w-4 h-4 text-gray-600" />
                        : <ChevronDown className="w-4 h-4 text-gray-600" />
                      }
                    </div>
                  </button>

                  {expandedEngagement === eng.id && (
                    <div className="px-5 pb-4 pt-0">
                      <div className="bg-[#07070e] rounded-xl p-4 border border-white/[0.04]">
                        <p className="text-xs text-gray-500">Service completed successfully. Result delivered via Walrus decentralized storage.</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Transactions Tab ═══ */}
        {tab === 'transactions' && (
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-bold text-white mb-1">Transactions</h2>
              <p className="text-sm text-gray-500">On-chain transaction history for this agent.</p>
            </div>

            {agentActivity.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500">No transactions yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {agentActivity.map(evt => (
                  <div key={evt.id} className="bg-[#0d0f1a] rounded-2xl border border-white/[0.06] px-5 py-4 flex items-center gap-3">
                    <div className="flex-shrink-0">
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
                      <p className="text-sm font-medium text-white">{evt.serviceName}</p>
                      <p className="text-xs text-gray-500">
                        {evt.type === 'request_fulfilled' ? 'Fulfilled' : evt.type === 'request_created' ? 'Request' : 'Listed'}
                        {evt.requesterName ? ` · ${evt.requesterName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-sm font-semibold text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>{evt.price} USDC</span>
                      {evt.blobId && evt.blobId !== 'none' && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400/70">
                          <Globe className="w-3 h-3" />
                        </span>
                      )}
                      <span className="text-xs text-gray-600">{timeAgo(evt.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
