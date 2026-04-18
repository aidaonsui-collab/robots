'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, Copy, TrendingUp, Users, Activity, Zap, Clock, Twitter, Send, Globe, Sparkles, BarChart3, Wallet, Settings, Code, DollarSign, PieChart } from 'lucide-react'
import { motion } from 'framer-motion'
import { fetchPoolToken, fetchPoolTrades, PoolToken, TradeEvent } from '@/lib/tokens'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

type TabType = 'overview' | 'analytics' | 'holders' | 'trades' | 'earnings' | 'settings'

function formatNumber(n: number, decimals = 2): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals)}K`
  return n.toFixed(decimals)
}

function formatUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function formatTimeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function AgentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [tab, setTab] = useState<TabType>('overview')
  const [token, setToken] = useState<PoolToken | null>(null)
  const [trades, setTrades] = useState<TradeEvent[]>([])
  const [loading, setLoading] = useState(true)

  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!id) return
    Promise.all([
      fetchPoolToken(id),
      fetchPoolTrades(id)
    ]).then(([tokenData, tradesData]) => {
      setToken(tokenData)
      setTrades(tradesData)
      setLoading(false)
    })
  }, [id])

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D4AF37]" />
      </div>
    )
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Agent not found</h2>
          <button
            onClick={() => router.push('/agents')}
            className="px-4 py-2 bg-[#D4AF37] hover:bg-[#D4AF37]/90 text-white rounded-lg transition-colors"
          >
            Back to Agents
          </button>
        </div>
      </div>
    )
  }

  const priceUp = (token.priceChange24h || 0) >= 0
  const isGraduating = (token.bondingProgress || 0) >= 70

  // Generate chart data from trades
  const chartData = {
    labels: trades.slice(0, 20).reverse().map((t, i) => i === 0 ? 'Start' : ''),
    datasets: [{
      label: 'Price',
      data: trades.slice(0, 20).reverse().map(t => t.price),
      borderColor: 'rgb(168, 85, 247)',
      backgroundColor: 'rgba(168, 85, 247, 0.1)',
      fill: true,
      tension: 0.4,
    }]
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 15, 23, 0.9)',
        titleColor: '#fff',
        bodyColor: '#a8a8b8',
        borderColor: 'rgba(168, 85, 247, 0.3)',
        borderWidth: 1,
        padding: 12,
        displayColors: false,
      }
    },
    scales: {
      x: { display: false },
      y: {
        display: true,
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#6b7280' }
      }
    }
  }

  const tabs: { id: TabType; label: string; icon: any }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'analytics', label: 'Analytics', icon: TrendingUp },
    { id: 'holders', label: 'Holders', icon: Users },
    { id: 'trades', label: 'Trades', icon: Activity },
    { id: 'earnings', label: 'Earnings', icon: DollarSign },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  const recentTrades = trades.slice(0, 10)
  const totalVolume = trades.reduce((sum, t) => sum + t.suiAmount, 0)
  const uniqueTraders = new Set(trades.map(t => t.user)).size

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <div className="border-b border-white/10 bg-slate-950/50 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            onClick={() => router.push('/agents')}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Agents
          </button>

          <div className="flex items-start gap-6">
            {/* Agent Image */}
            <div className="relative">
              <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center">
                {token.logoUrl ? (
                  <img src={token.logoUrl} alt={token.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-bold text-white">{token.symbol.slice(0, 2)}</span>
                )}
              </div>
              {token.isAiLaunched && (
                <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-gradient-to-r from-[#D4AF37] to-[#FFD700] flex items-center justify-center shadow-lg">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
              )}
            </div>

            {/* Agent Info */}
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-white mb-2">{token.name}</h1>
                  <div className="flex items-center gap-3 text-gray-400 text-sm mb-4">
                    <span>${token.symbol}</span>
                    <span>•</span>
                    <span>{token.age}</span>
                    <span>•</span>
                    <button
                      onClick={() => handleCopy(token.coinType)}
                      className="flex items-center gap-1 hover:text-white transition-colors"
                    >
                      {token.creatorShort}
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Social Links */}
                  <div className="flex items-center gap-2">
                    {token.twitter && (
                      <a
                        href={token.twitter.startsWith('http') ? token.twitter : `https://twitter.com/${token.twitter.replace('@', '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-9 h-9 rounded-lg bg-white/5 hover:bg-sky-500/20 border border-white/10 hover:border-sky-500/50 flex items-center justify-center text-gray-500 hover:text-sky-400 transition-all"
                      >
                        <Twitter className="w-4 h-4" />
                      </a>
                    )}
                    {token.telegram && (
                      <a
                        href={token.telegram.startsWith('http') ? token.telegram : `https://t.me/${token.telegram.replace('@', '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-9 h-9 rounded-lg bg-white/5 hover:bg-blue-500/20 border border-white/10 hover:border-blue-500/50 flex items-center justify-center text-gray-500 hover:text-blue-400 transition-all"
                      >
                        <Send className="w-4 h-4" />
                      </a>
                    )}
                    {token.website && (
                      <a
                        href={token.website.startsWith('http') ? token.website : `https://${token.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-9 h-9 rounded-lg bg-white/5 hover:bg-[#D4AF37]/20 border border-white/10 hover:border-[#D4AF37]/50 flex items-center justify-center text-gray-500 hover:text-[#D4AF37] transition-all"
                      >
                        <Globe className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Stats Cards */}
                <div className="flex gap-4">
                  <div className="text-right">
                    <div className="text-sm text-gray-500 mb-1">Market Cap</div>
                    <div className="text-2xl font-bold text-white">{formatUSD(token.marketCap || 0)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500 mb-1">24h Change</div>
                    <div className={`text-2xl font-bold ${priceUp ? 'text-emerald-400' : 'text-red-400'}`}>
                      {priceUp ? '+' : ''}{(token.priceChange24h || 0).toFixed(2)}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500 mb-1">Progress</div>
                    <div className="text-2xl font-bold text-yellow-400">
                      {(token.bondingProgress || 0).toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 -mb-px">
            {tabs.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all ${
                    tab === t.id
                      ? 'border-[#D4AF37] text-white'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {tab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Stats */}
            <div className="lg:col-span-2 space-y-6">
              {/* Price Chart */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6"
              >
                <h3 className="text-lg font-bold text-white mb-4">Price History</h3>
                <div className="h-64">
                  <Line data={chartData} options={chartOptions} />
                </div>
              </motion.div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-xl border border-white/10 p-4"
                >
                  <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                    <Activity className="w-4 h-4" />
                    Total Volume
                  </div>
                  <div className="text-2xl font-bold text-white">{formatNumber(totalVolume)} SUI</div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-xl border border-white/10 p-4"
                >
                  <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                    <Users className="w-4 h-4" />
                    Traders
                  </div>
                  <div className="text-2xl font-bold text-white">{uniqueTraders}</div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-xl border border-white/10 p-4"
                >
                  <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                    <TrendingUp className="w-4 h-4" />
                    Trades
                  </div>
                  <div className="text-2xl font-bold text-white">{trades.length}</div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-xl border border-white/10 p-4"
                >
                  <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                    <Zap className="w-4 h-4" />
                    Current Price
                  </div>
                  <div className="text-2xl font-bold text-white">{token.currentPrice.toFixed(6)} SUI</div>
                </motion.div>
              </div>

              {/* Description */}
              {token.description && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6"
                >
                  <h3 className="text-lg font-bold text-white mb-4">About</h3>
                  <p className="text-gray-400 leading-relaxed">{token.description}</p>
                </motion.div>
              )}
            </div>

            {/* Right Column - Recent Activity */}
            <div className="space-y-6">
              {/* Bonding Progress */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6"
              >
                <h3 className="text-lg font-bold text-white mb-4">Bonding Curve</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Progress</span>
                    <span className="font-bold text-white">{(token.bondingProgress || 0).toFixed(1)}%</span>
                  </div>
                  <div className="relative h-3 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full bg-[#D4AF37]"
                      initial={{ width: 0 }}
                      animate={{ width: `${token.bondingProgress || 0}%` }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Raised</span>
                    <span className="font-bold text-white">{formatNumber(token.realSuiRaised)} SUI</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Target</span>
                    <span className="font-bold text-white">{formatNumber(token.threshold)} SUI</span>
                  </div>
                </div>
              </motion.div>

              {/* Recent Trades */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6"
              >
                <h3 className="text-lg font-bold text-white mb-4">Recent Trades</h3>
                <div className="space-y-3">
                  {recentTrades.map((trade, i) => (
                    <div key={i} className="flex items-center justify-between text-sm border-b border-white/5 pb-3 last:border-0">
                      <div>
                        <div className={`font-medium ${trade.isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trade.isBuy ? 'Buy' : 'Sell'}
                        </div>
                        <div className="text-gray-500 text-xs">{formatTimeAgo(trade.timestampMs)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-white font-medium">{formatNumber(trade.suiAmount, 3)} SUI</div>
                        <div className="text-gray-500 text-xs">{formatNumber(trade.tokenAmount, 0)} {token.symbol}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        )}

        {tab === 'analytics' && (
          <div className="text-center py-20">
            <BarChart3 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-white mb-2">Analytics Coming Soon</h3>
            <p className="text-gray-500">Detailed charts and metrics will be available here</p>
          </div>
        )}

        {tab === 'holders' && (
          <div className="text-center py-20">
            <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-white mb-2">Holder List Coming Soon</h3>
            <p className="text-gray-500">View all token holders and their balances</p>
          </div>
        )}

        {tab === 'trades' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden"
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-white/5 border-b border-white/10">
                  <tr>
                    <th className="text-left text-gray-400 text-sm font-medium px-6 py-4">Type</th>
                    <th className="text-left text-gray-400 text-sm font-medium px-6 py-4">Time</th>
                    <th className="text-right text-gray-400 text-sm font-medium px-6 py-4">SUI Amount</th>
                    <th className="text-right text-gray-400 text-sm font-medium px-6 py-4">Token Amount</th>
                    <th className="text-right text-gray-400 text-sm font-medium px-6 py-4">Price</th>
                    <th className="text-left text-gray-400 text-sm font-medium px-6 py-4">Trader</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          trade.isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {trade.isBuy ? 'Buy' : 'Sell'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-400 text-sm">{formatTimeAgo(trade.timestampMs)}</td>
                      <td className="px-6 py-4 text-white text-sm text-right font-medium">{formatNumber(trade.suiAmount, 3)}</td>
                      <td className="px-6 py-4 text-white text-sm text-right font-medium">{formatNumber(trade.tokenAmount, 0)}</td>
                      <td className="px-6 py-4 text-white text-sm text-right font-medium">{trade.price.toFixed(6)}</td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleCopy(trade.user)}
                          className="text-gray-400 hover:text-white transition-colors text-sm flex items-center gap-1"
                        >
                          {trade.user.slice(0, 6)}...{trade.user.slice(-4)}
                          <Copy className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {tab === 'earnings' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Revenue Distribution */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="lg:col-span-2 bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6"
            >
              <div className="flex items-center gap-3 mb-6">
                <PieChart className="w-6 h-6 text-[#D4AF37]" />
                <h3 className="text-xl font-bold text-white">Revenue Distribution</h3>
              </div>

              <div className="space-y-6">
                {/* AIDA Stakers */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#D4AF37]" />
                      <span className="text-sm font-medium text-gray-300">AIDA Stakers</span>
                    </div>
                    <span className="text-lg font-bold text-white">30%</span>
                  </div>
                  <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-[#D4AF37]" style={{ width: '30%' }} />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Distributed to all AIDA token stakers platform-wide
                  </p>
                </div>

                {/* Creator */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-[#D4AF37]" />
                      <span className="text-sm font-medium text-gray-300">Creator</span>
                    </div>
                    <span className="text-lg font-bold text-[#D4AF37]">40%</span>
                  </div>
                  <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-[#D4AF37]" style={{ width: '40%' }} />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Earnings for the agent creator
                  </p>
                </div>

                {/* Total Fees Generated */}
                <div className="border-t border-white/10 pt-6 mt-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-800/50 rounded-xl p-4">
                      <div className="text-sm text-gray-400 mb-1">Total Trading Fees</div>
                      <div className="text-2xl font-bold text-white">{formatNumber(totalVolume * 0.02)} SUI</div>
                      <div className="text-xs text-gray-500 mt-1">2% of {formatNumber(totalVolume)} SUI volume</div>
                    </div>
                    <div className="bg-slate-800/50 rounded-xl p-4">
                      <div className="text-sm text-gray-400 mb-1">To AIDA Stakers</div>
                      <div className="text-2xl font-bold text-[#D4AF37]">{formatNumber(totalVolume * 0.02 * 0.3)} SUI</div>
                      <div className="text-xs text-gray-500 mt-1">30% of total fees</div>
                    </div>
                  </div>
                </div>

                {/* How It Works */}
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mt-6">
                  <div className="flex gap-3">
                    <Sparkles className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-300">
                      <p className="font-medium mb-1">How Revenue Works</p>
                      <p className="text-blue-200/80">
                        Every trade of this agent's token generates a 2% fee. That fee is split: 30% to AIDA stakers, 40% to the creator, and 30% to platform operations.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Creator Earnings (if owner) */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Placeholder - will show real data when wallet connected */}
              <div className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                <div className="flex items-center gap-3 mb-6">
                  <Wallet className="w-6 h-6 text-[#D4AF37]" />
                  <h3 className="text-lg font-bold text-white">Creator Earnings</h3>
                </div>

                {/* Show this if user is the creator */}
                <div className="space-y-4">
                  <div className="bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-xl p-4">
                    <div className="text-sm text-gray-400 mb-1">Available to Withdraw</div>
                    <div className="text-3xl font-bold text-[#D4AF37]">
                      {formatNumber(totalVolume * 0.02 * 0.4)} SUI
                    </div>
                  </div>

                  <button className="w-full py-3 rounded-xl font-bold bg-[#D4AF37] text-black hover:opacity-90 transition-opacity">
                    Withdraw Earnings
                  </button>

                  <div className="border-t border-white/10 pt-4">
                    <div className="text-sm text-gray-400 mb-3">Lifetime Earnings</div>
                    <div className="text-2xl font-bold text-white mb-1">
                      {formatNumber(totalVolume * 0.02 * 0.4)} SUI
                    </div>
                    <div className="text-xs text-gray-500">
                      From {trades.length} trades
                    </div>
                  </div>
                </div>
              </div>

              {/* Earnings History */}
              <div className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                <h3 className="text-lg font-bold text-white mb-4">Recent Earnings</h3>
                <div className="space-y-3">
                  {recentTrades.slice(0, 5).map((trade, i) => {
                    const creatorEarnings = trade.suiAmount * 0.02 * 0.4
                    return (
                      <div key={i} className="flex items-center justify-between text-sm border-b border-white/5 pb-3 last:border-0">
                        <div>
                          <div className="text-gray-400">{formatTimeAgo(trade.timestampMs)}</div>
                          <div className="text-xs text-gray-600">From {trade.isBuy ? 'buy' : 'sell'} trade</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[#D4AF37] font-bold">+{creatorEarnings.toFixed(4)} SUI</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="text-center py-20">
            <Settings className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-white mb-2">Agent Settings</h3>
            <p className="text-gray-500">Configure agent personality, skills, and revenue splits</p>
          </div>
        )}
      </div>
    </div>
  )
}
