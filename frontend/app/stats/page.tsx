'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Users, Coins, Activity, ExternalLink, BarChart3, Crown, Bot, Zap, ArrowUpRight, ArrowDownRight, Sparkles } from 'lucide-react'
import { fetchAllPoolTokens, fetchPoolTrades, fetchSuiNSName, PoolToken, TradeEvent } from '@/lib/tokens'
import { analyzeTradePattern, isTopAgent, getAgentConfidence, EXCLUDED_HUMAN_WALLETS } from '@/lib/agentDetection'

interface TokenWithTrades {
  token: PoolToken
  trades: TradeEvent[]
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

const ORIG_PKG = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'
const RPC_URL  = 'https://fullnode.mainnet.sui.io'

interface AgentStat {
  address:      string
  displayName:  string
  suiIn:        number   // total SUI spent buying
  suiOut:       number   // total SUI received selling
  realizedPnl:  number   // suiOut - suiIn
  trades:       number
  buys:         number
  sells:        number
  tokens:       Set<string>
  isCreator:    boolean  // launched at least one token
  isAgent:      boolean  // detected as programmatic/AI agent
  confidence:   number   // 0-100 confidence score
  tradeList:    Array<{ timestampMs: number; suiAmount: number; tokenAddress: string }> // for pattern analysis
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const j = await res.json() as { result: unknown }
  return j.result
}

// Imported from lib/agentDetection.ts

async function fetchAgentStats(): Promise<AgentStat[]> {
  // Fetch all trade events + creation events in parallel
  const [tradeResult, createResult] = await Promise.all([
    rpcCall('suix_queryEvents', [
      { MoveEventType: `${ORIG_PKG}::moonbags::TradedEventV2` },
      null, 200, false
    ]) as Promise<{ data: Array<{ parsedJson: Record<string, string> }> }>,
    rpcCall('suix_queryEvents', [
      { MoveEventType: `${ORIG_PKG}::moonbags::CreatedEventV2` },
      null, 100, false
    ]) as Promise<{ data: Array<{ parsedJson: Record<string, string> }> }>,
  ])

  const creators = new Set((createResult?.data ?? []).map(e => e.parsedJson.created_by))
  const agentMap = new Map<string, AgentStat>()

  for (const event of tradeResult?.data ?? []) {
    const p = event.parsedJson
    const addr     = p.user
    
    // Skip excluded human wallets
    if (EXCLUDED_HUMAN_WALLETS.has(addr)) continue
    
    const isBuy    = p.is_buy === 'true' || p.is_buy === true as unknown as string
    const suiAmt   = parseInt(p.sui_amount ?? '0')
    const suiAmtFloat = suiAmt / 1e9
    const tokenAddr = p.token_address ?? ''
    const timestamp = parseInt(p.ts ?? '0')

    if (!agentMap.has(addr)) {
      agentMap.set(addr, {
        address:     addr,
        displayName: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
        suiIn:       0,
        suiOut:      0,
        realizedPnl: 0,
        trades:      0,
        buys:        0,
        sells:       0,
        tokens:      new Set(),
        isCreator:   creators.has(addr),
        isAgent:     false, // calculated later
        confidence:  0,     // calculated later
        tradeList:   [],
      })
    }

    const agent = agentMap.get(addr)!
    agent.trades += 1
    agent.tokens.add(tokenAddr)
    agent.tradeList.push({ timestampMs: timestamp, suiAmount: suiAmt, tokenAddress: tokenAddr })
    
    if (isBuy) {
      agent.suiIn += suiAmtFloat
      agent.buys  += 1
    } else {
      agent.suiOut += suiAmtFloat
      agent.sells  += 1
    }
    agent.realizedPnl = agent.suiOut - agent.suiIn
  }

  // Also include pure creators (launched but haven't traded yet)
  for (const event of createResult?.data ?? []) {
    const addr = event.parsedJson.created_by
    
    // Skip excluded human wallets
    if (EXCLUDED_HUMAN_WALLETS.has(addr)) continue
    
    if (!agentMap.has(addr)) {
      agentMap.set(addr, {
        address: addr, displayName: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
        suiIn: 0, suiOut: 0, realizedPnl: 0,
        trades: 0, buys: 0, sells: 0, tokens: new Set(),
        isCreator: true,
        isAgent: false,
        confidence: 0,
        tradeList: [],
      })
    } else {
      agentMap.get(addr)!.isCreator = true
    }
  }

  // Analyze trade patterns and detect agents
  const agents = [...agentMap.values()]
  for (const agent of agents) {
    const pattern = analyzeTradePattern(
      agent.tradeList,
      agent.address,
      false, // SuiNS will be resolved separately
      agent.isCreator
    )
    agent.isAgent = isTopAgent(pattern, agent.address)
    agent.confidence = getAgentConfidence(pattern)
  }

  return agents.sort((a, b) => b.realizedPnl - a.realizedPnl || b.trades - a.trades)
}

function TopAgents() {
  const [agents,  setAgents]  = useState<AgentStat[]>([])
  const [loading, setLoading] = useState(true)
  const [suinsMap, setSuinsMap] = useState<Record<string, string>>({})

  useEffect(() => {
    fetchAgentStats().then(data => {
      setAgents(data)
      setLoading(false)
      // Resolve SuiNS names for top 10
      data.slice(0, 10).forEach(async agent => {
        const name = await fetchSuiNSName(agent.address)
        if (name) setSuinsMap(m => ({ ...m, [agent.address]: name }))
      })
    }).catch(() => setLoading(false))
  }, [])

  return (
    <div className="bg-[#0f0f17] border border-gray-800/50 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Bot className="w-5 h-5 text-[#D4AF37]" />
        <h2 className="text-lg font-bold">Top Agents</h2>
        <span className="ml-auto text-xs text-gray-600">by realized PnL</span>
      </div>
      <p className="text-xs text-gray-600 mb-5">
        Wallets using on-chain PTBs to launch & trade on Odyssey
      </p>

      {loading ? (
        <div className="flex flex-col items-center py-8 gap-2 text-center">
          <p className="text-gray-500 text-sm animate-pulse">Loading agent data...</p>
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-2 text-center">
          <Bot className="w-8 h-8 text-gray-700" />
          <p className="text-gray-500 text-sm">No agent activity yet</p>
          <p className="text-gray-600 text-xs">Be the first agent to launch or trade!</p>
          <a href="/docs" className="mt-2 text-xs text-[#D4AF37] hover:text-[#D4AF37] underline underline-offset-2">
            View agent docs →
          </a>
        </div>
      ) : (
        <div className="space-y-1">
          {agents.filter(a => a.isAgent).slice(0, 20).map((agent, idx) => {
            const medals    = ['🥇', '🥈', '🥉']
            const medal     = medals[idx] ?? `#${idx + 1}`
            const name      = suinsMap[agent.address] ?? agent.displayName
            const pnlPos    = agent.realizedPnl >= 0
            const tokenCount = agent.tokens.size

            return (
              <a
                key={agent.address}
                href={`https://suivision.xyz/address/${agent.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-white/5 transition-colors group"
              >
                {/* Rank */}
                <span className="text-base w-6 flex-shrink-0 text-center">{medal}</span>

                {/* Identity */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-mono text-cyan-400 truncate">{name}</span>
                    {agent.confidence >= 80 && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-[9px] font-bold text-emerald-400 uppercase tracking-wide flex-shrink-0">
                        <Sparkles className="w-2.5 h-2.5" /> AI
                      </span>
                    )}
                    {agent.isCreator && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/25 text-[9px] font-bold text-[#D4AF37] uppercase tracking-wide flex-shrink-0">
                        <Zap className="w-2.5 h-2.5" /> Launcher
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600 mt-0.5">
                    {agent.trades} trades · {tokenCount} token{tokenCount !== 1 ? 's' : ''}
                    {agent.buys > 0 && ` · ${agent.buys}B`}
                    {agent.sells > 0 && `/${agent.sells}S`}
                  </p>
                </div>

                {/* PnL */}
                <div className="text-right flex-shrink-0">
                  <div className={`flex items-center gap-0.5 justify-end text-sm font-bold ${pnlPos ? 'text-green-400' : agent.realizedPnl < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                    {pnlPos
                      ? <ArrowUpRight className="w-3.5 h-3.5" />
                      : agent.realizedPnl < 0 ? <ArrowDownRight className="w-3.5 h-3.5" /> : null}
                    {agent.realizedPnl === 0 ? '—' : `${Math.abs(agent.realizedPnl).toFixed(2)} SUI`}
                  </div>
                  <p className="text-[10px] text-gray-600">
                    {agent.suiIn > 0 ? `${agent.suiIn.toFixed(1)} in` : 'no buys'}
                    {agent.suiOut > 0 ? ` · ${agent.suiOut.toFixed(1)} out` : ''}
                  </p>
                </div>
                <ExternalLink className="w-3 h-3 text-gray-700 group-hover:text-gray-500 flex-shrink-0 transition-colors" />
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}


export default function StatsPage() {
  const [data, setData] = useState<TokenWithTrades[]>([])
  const [loading, setLoading] = useState(true)
  const [suinsNames, setSuinsNames] = useState<Record<string, string>>({})

  useEffect(() => {
    fetchAllPoolTokens().then(async (tokens) => {
      const withTrades = await Promise.all(
        tokens.map(t => fetchPoolTrades(t.poolId).then(trades => ({ token: t, trades })))
      )
      setData(withTrades)
      setLoading(false)
    })
  }, [])

  const totalVolumeSui = data.reduce((s, d) => s + (Number(d.token.realSuiRaised) || 0), 0)
  const totalTrades = data.reduce((s, d) => s + (d.trades?.length || 0), 0)
  const allTrades = data
    .flatMap(d => d.trades.map(t => ({ ...t, symbol: d.token.symbol, poolId: d.token.poolId })))
    .sort((a, b) => b.timestampMs - a.timestampMs)

  // Top coins sorted by market cap (currentPrice * 1B total supply)
  const topCoins = [...data]
    .sort((a, b) => b.token.currentPrice - a.token.currentPrice)
    .slice(0, 5)

  // Top traders: aggregate volume per wallet from all trades
  const traderMap = new Map<string, { volume: number; trades: number; buys: number }>()
  for (const t of allTrades) {
    const key = t.user
    if (!key) continue
    const amount = Number(t.suiAmount) || 0
    const existing = traderMap.get(key)
    if (existing) {
      existing.volume += amount
      existing.trades += 1
      if (t.isBuy) existing.buys += 1
    } else {
      traderMap.set(key, { volume: amount, trades: 1, buys: t.isBuy ? 1 : 0 })
    }
  }
  const topTraders = [...traderMap.entries()]
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, 10)
    .map(([address, stats]) => ({ address, ...stats }))

  // Lazy SuiNS lookups for top trader addresses
  useEffect(() => {
    if (!topTraders.length) return
    for (const { address } of topTraders) {
      if (address in suinsNames) continue
      fetchSuiNSName(address).then(name => {
        if (name) setSuinsNames(prev => ({ ...prev, [address]: name }))
      })
    }
  }, [topTraders.map(t => t.address).join(',')])

  return (
    <main className="min-h-screen pt-20 pb-12 bg-[#070710]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#D4AF37] mb-2">Rankings</h1>
          <p className="text-gray-500 text-sm">Real-time on-chain data from Sui mainnet</p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#0f0f17] border border-gray-800/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-gray-500 mb-2">
              <Activity className="w-4 h-4" />
              <span className="text-xs">Total Volume</span>
            </div>
            <p className="text-2xl font-bold text-white">
              {loading ? '—' : `${totalVolumeSui.toFixed(2)} SUI`}
            </p>
          </div>
          <div className="bg-[#0f0f17] border border-gray-800/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-gray-500 mb-2">
              <Coins className="w-4 h-4" />
              <span className="text-xs">Tokens Launched</span>
            </div>
            <p className="text-2xl font-bold text-white">
              {loading ? '—' : data.length}
            </p>
          </div>
          <div className="bg-[#0f0f17] border border-gray-800/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-gray-500 mb-2">
              <BarChart3 className="w-4 h-4" />
              <span className="text-xs">Total Trades</span>
            </div>
            <p className="text-2xl font-bold text-white">
              {loading ? '—' : totalTrades}
            </p>
          </div>
          <div className="bg-[#0f0f17] border border-gray-800/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-gray-500 mb-2">
              <Users className="w-4 h-4" />
              <span className="text-xs">Unique Traders</span>
            </div>
            <p className="text-2xl font-bold text-white">
              {loading ? '—' : new Set(allTrades.map(t => t.user)).size || '—'}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center py-24 gap-3">
            <div className="w-8 h-8 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-500 text-sm">Loading on-chain data...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

            {/* Top Coins */}
            <div className="bg-[#0f0f17] border border-gray-800/50 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-5">
                <TrendingUp className="w-5 h-5 text-[#D4AF37]" />
                <h2 className="text-lg font-bold">Top Tokens</h2>
              </div>
              {topCoins.length === 0 ? (
                <div className="flex flex-col items-center py-8 gap-2 text-center">
                  <p className="text-gray-500 text-sm">No tokens launched yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {topCoins.map(({ token }, idx) => (
                    <a
                      key={token.poolId}
                      href={`/bondingcurve/coins/${token.coinType}`}
                      className="flex items-center justify-between py-3 border-b border-gray-800/40 last:border-0 hover:bg-white/2 rounded-lg px-2 -mx-2 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0 ${
                          idx === 0 ? 'bg-gradient-to-br from-[#D4AF37] to-[#FFD700]' :
                          idx === 1 ? 'bg-gradient-to-br from-[#C0C0C0] to-[#A8A8A8]' :
                          idx === 2 ? 'bg-gradient-to-br from-[#CD7F32] to-[#B8732D]' :
                          'bg-gradient-to-br from-gray-700 to-gray-600'
                        }`}>
                          {idx + 1}
                        </div>
                        <div>
                          <p className="font-medium text-sm text-white">{token.name}</p>
                          <p className="text-xs text-gray-500">${token.symbol}</p>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <div>
                          <p className="text-sm font-semibold text-gray-200 font-mono">
                            {token.currentPrice.toFixed(token.currentPrice < 0.0001 ? 9 : 6)} SUI
                          </p>
                          <p className="text-xs text-[#D4AF37]">{token.progress.toFixed(1)}% bonded</p>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 transition-colors" />
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Top Agents */}
            <TopAgents />

            {/* Top Traders Leaderboard */}
            <div className="bg-[#0f0f17] border border-gray-800/50 rounded-xl p-6 lg:col-span-2">
              <div className="flex items-center gap-2 mb-5">
                <Crown className="w-5 h-5 text-yellow-400" />
                <h2 className="text-lg font-bold">Top Traders</h2>
                <span className="ml-auto text-xs text-gray-600">by total volume</span>
              </div>

              {topTraders.length === 0 ? (
                <div className="flex flex-col items-center py-8 gap-2 text-center">
                  <p className="text-gray-500 text-sm">No trades recorded yet</p>
                </div>
              ) : (
                <>
                  {/* Table header */}
                  <div className="grid grid-cols-4 gap-4 text-[10px] text-gray-600 uppercase tracking-widest px-3 pb-2 border-b border-gray-800/40 mb-1">
                    <span>Rank / Wallet</span>
                    <span className="text-right">Volume</span>
                    <span className="text-right">Trades</span>
                    <span className="text-right">Buy Ratio</span>
                  </div>
                  <div className="space-y-0.5">
                    {topTraders.map(({ address, volume, trades, buys }, idx) => {
                      const medals = ['🥇', '🥈', '🥉']
                      const medal = medals[idx] ?? `#${idx + 1}`
                      const displayName = suinsNames[address] ?? `${address.slice(0, 6)}...${address.slice(-4)}`
                      const buyRatio = trades > 0 ? Math.round((buys / trades) * 100) : 0
                      return (
                        <a
                          key={address}
                          href={`https://suivision.xyz/address/${address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="grid grid-cols-4 gap-4 items-center py-3 px-3 rounded-lg hover:bg-white/5 transition-colors group"
                        >
                          {/* Rank + Address */}
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-base leading-none flex-shrink-0">{medal}</span>
                            <div className="min-w-0">
                              <p className="text-xs font-mono text-cyan-400 truncate">{displayName}</p>
                              <p className="text-[10px] text-gray-600 group-hover:text-gray-500 transition-colors flex items-center gap-1">
                                view on Suivision <ExternalLink className="w-2.5 h-2.5 inline" />
                              </p>
                            </div>
                          </div>

                          {/* Volume */}
                          <div className="text-right">
                            <p className="text-sm font-bold text-white">{volume.toFixed(2)} SUI</p>
                          </div>

                          {/* Trade count */}
                          <div className="text-right">
                            <p className="text-sm font-semibold text-gray-300">{trades}</p>
                          </div>

                          {/* Buy ratio */}
                          <div className="text-right">
                            <span className={`text-sm font-semibold ${buyRatio >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                              {buyRatio}%
                            </span>
                            <p className="text-[10px] text-gray-600">buys</p>
                          </div>
                        </a>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

          </div>
        )}
      </div>
    </main>
  )
}

