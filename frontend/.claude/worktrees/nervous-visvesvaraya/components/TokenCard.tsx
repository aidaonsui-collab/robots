'use client'

import { Clock, Flame, Crown, Zap, Tv } from 'lucide-react'

// ============================================
// TokenType Interface
// ============================================
interface TokenType {
  id: string
  name: string
  symbol: string
  logoUrl?: string
  age: string
  creatorShort: string
  creatorFull: string
  suiRewards: number
  holders: number
  marketCap: number
  bondingProgress: number // 0-100
  description?: string
  liveStreamUrl?: string // URL for live stream
  isAiLaunched?: boolean // True if launched by AI agent
  agentVolume24h?: number // Agent trading volume in SUI (24h)
}

// ============================================
// Helper Functions
// ============================================
function formatMarketCap(mc: number): string {
  if (mc === undefined || mc === null) return '$0'
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`
  if (mc >= 1_000) return `$${(mc / 1_000).toFixed(1)}K`
  return `$${mc.toFixed(2)}`
}

function formatRewards(r: number): string {
  if (r === undefined || r === null) return '0.000'
  return r.toFixed(3)
}

function isNew(age: string): boolean {
  // Consider "new" if age ends in m (minutes) or is under 1h
  return /^\d+m$/.test(age) || age === '0h'
}

function isKingOfHill(progress: number): boolean {
  return progress >= 70
}

function isHot(holders: number): boolean {
  return holders > 200
}

function hasLiveStream(token: TokenType): boolean {
  return !!token.liveStreamUrl && token.liveStreamUrl.length > 0
}

function getBondingColor(progress: number): string {
  if (progress >= 70) return 'from-yellow-400 via-orange-500 to-red-500'
  if (progress >= 40) return 'from-purple-500 via-pink-500 to-green-400'
  return 'from-purple-600 to-blue-500'
}

// ============================================
// Spotlight TokenCard (Featured)
// ============================================
interface SpotlightCardProps {
  token: TokenType
  onClick?: () => void
}

export function SpotlightCard({ token, onClick }: SpotlightCardProps) {
  const koth = isKingOfHill(token.bondingProgress)
  const hot = isHot(token.holders)
  const fresh = isNew(token.age)

  return (
    <div 
      onClick={onClick}
      className="relative cursor-pointer mb-8 fade-in"
    >
      {/* Spotlight Banner */}
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
        <span className="bg-gradient-to-r from-purple-600 via-pink-500 to-green-500 text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg border-glow-anim">
          ✨ SPOTLIGHT
        </span>
      </div>
      
      {/* Card with gradient border */}
      <div className="relative rounded-2xl p-[2px] bg-gradient-to-r from-purple-600 via-pink-500 to-green-500 shadow-xl shadow-purple-500/20">
        <div className="bg-[#0f0f17] rounded-2xl p-5">
          {/* Top Row: Logo + Name/Ticker + Age + Badges */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Token Logo with glow */}
              <div className="relative flex-shrink-0">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-600 to-green-500 flex items-center justify-center text-white font-bold text-2xl border-2 border-purple-500/50 overflow-hidden">
                  {token.logoUrl ? (
                    <img src={token.logoUrl} alt={token.name} className="w-full h-full rounded-full object-cover" />
                  ) : (
                    token.symbol.slice(0, 2)
                  )}
                </div>
                <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-green-500 rounded-full blur-md opacity-40" />
              </div>
              
              {/* Name + Ticker + Badges */}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-white text-2xl truncate">{token.name}</h3>
                  <span className="text-muted-foreground text-base">({token.symbol})</span>
                  {koth && (
                    <span className="flex items-center gap-1 bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-xs font-bold px-2 py-0.5 rounded-full">
                      <Crown className="w-3 h-3" /> King
                    </span>
                  )}
                  {fresh && (
                    <span className="flex items-center gap-1 bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 text-xs font-bold px-2 py-0.5 rounded-full">
                      <Zap className="w-3 h-3" /> NEW
                    </span>
                  )}
                  {hasLiveStream(token) && (
                    <a 
                      href={token.liveStreamUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 bg-red-500/20 border border-red-500/40 text-red-400 text-xs font-bold px-2 py-0.5 rounded-full hover:bg-red-500/30 transition-colors"
                    >
                      <Tv className="w-3 h-3" /> LIVE
                    </a>
                  )}
                  {hot && (
                    <span className="flex items-center gap-1 text-orange-400 text-xs font-bold">
                      <Flame className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            {/* Age */}
            <div className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0 ml-2">
              <Clock className="w-3 h-3" />
              {token.age}
            </div>
          </div>

          {/* Creator Line */}
          <div className="mb-3">
            <span className="text-xs text-gray-400">Creator: </span>
            <a 
              href={`https://suiscan.xyz/mainnet/account/${token.creatorFull}?utm_source=odyssey&utm_medium=web`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-cyan-400 hover:underline hover:text-cyan-300 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              [{token.creatorShort}]
            </a>
          </div>

          {/* Description */}
          {token.description && (
            <p className="text-sm text-gray-300 line-clamp-2 mb-4 leading-relaxed">
              {token.description}
            </p>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-[#14142a] rounded-xl p-3 border border-purple-500/10">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">SUI Rewards</p>
              <p className="text-lg font-bold text-green-400 stat-value-green">{formatRewards(token.suiRewards)}</p>
            </div>
            <div className="bg-[#14142a] rounded-xl p-3 border border-purple-500/10">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Holders</p>
              <p className="text-lg font-bold text-white">{token.holders.toLocaleString()}</p>
            </div>
            <div className="bg-[#14142a] rounded-xl p-3 border border-purple-500/10">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Mkt Cap</p>
              <p className="text-lg font-bold text-purple-400 stat-value">{formatMarketCap(token.marketCap)}</p>
            </div>
          </div>

          {/* Bonding Curve Progress */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-gray-400 font-medium">Bonding Progress</span>
              <span className={`text-sm font-bold ${koth ? 'text-yellow-400' : 'text-white'}`}>
                {token.bondingProgress.toFixed(2)}%
              </span>
            </div>
            <div className="h-3 bg-[#14142a] rounded-full overflow-hidden border border-white/5">
              <div 
                className={`h-full bg-gradient-to-r ${getBondingColor(token.bondingProgress)} rounded-full transition-all duration-500`}
                style={{ width: `${Math.min(token.bondingProgress, 100)}%` }}
              />
            </div>
            {koth && (
              <p className="text-xs text-yellow-400/80 mt-1.5 flex items-center gap-1">
                <Crown className="w-3 h-3" /> Graduating to DEX soon!
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Regular TokenCard Component
// ============================================
interface TokenCardProps {
  token: TokenType
  onClick?: () => void
}

export default function TokenCard({ token, onClick }: TokenCardProps) {
  const koth = isKingOfHill(token.bondingProgress)
  const hot = isHot(token.holders)
  const fresh = isNew(token.age)

  return (
    <div 
      onClick={onClick}
      className={`
        group relative bg-[#0f0f17] rounded-xl border p-4 cursor-pointer
        transition-all duration-200 hover:scale-[1.02] hover:-translate-y-0.5
        hover:shadow-xl card-shimmer overflow-hidden
        ${koth 
          ? 'border-yellow-500/30 hover:border-yellow-500/60 hover:shadow-yellow-500/10' 
          : 'border-gray-800/60 hover:border-purple-500/40 hover:shadow-purple-500/10'
        }
      `}
    >
      {/* Top glow line on hover */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] rounded-t-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r ${koth ? 'from-yellow-400 via-orange-400 to-red-400' : 'from-purple-500 via-pink-500 to-green-500'}`} />

      {/* Top Row: Logo + Name/Ticker + Age */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Token Logo */}
          <div className="relative flex-shrink-0">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-600 to-green-500 flex items-center justify-center text-white font-bold text-lg border-2 border-purple-500/30 overflow-hidden">
              {token.logoUrl ? (
                <img src={token.logoUrl} alt={token.name} className="w-full h-full rounded-full object-cover" />
              ) : (
                token.symbol.slice(0, 2)
              )}
            </div>
          </div>
          
          {/* Name + Ticker + Badges */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="font-semibold text-white text-base truncate">{token.name}</h3>
              {koth && <Crown className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />}
              {hot && <Flame className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-muted-foreground text-sm">({token.symbol})</span>
              {fresh && (
                <span className="bg-cyan-500/20 text-cyan-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-cyan-500/30">
                  NEW
                </span>
              )}
              {hasLiveStream(token) && (
                <a 
                  href={token.liveStreamUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="bg-red-500/20 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-red-500/30 flex items-center gap-1 hover:bg-red-500/30 transition-colors"
                >
                  <Tv className="w-2.5 h-2.5" /> LIVE
                </a>
              )}
              {koth && (
                <span className="bg-yellow-500/20 text-yellow-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-yellow-500/30">
                  KOTH
                </span>
              )}
              {token.isAiLaunched && (
                <span className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-purple-500/30 flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> AI LAUNCHED
                </span>
              )}
            </div>
          </div>
        </div>
        
        {/* Age */}
        <div className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0 ml-1">
          <Clock className="w-3 h-3" />
          {token.age}
        </div>
      </div>

      {/* Creator Line */}
      <div className="mb-2.5">
        <span className="text-xs text-gray-500">Creator: </span>
        <a 
          href={`https://suiscan.xyz/mainnet/account/${token.creatorFull}?utm_source=odyssey&utm_medium=web`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono text-cyan-400/80 hover:text-cyan-300 hover:underline transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          [{token.creatorShort}]
        </a>
      </div>

      {/* Description (if present) */}
      {token.description && (
        <p className="text-xs text-gray-400 line-clamp-2 mb-3 leading-relaxed">
          {token.description}
        </p>
      )}

      {/* Stats Grid */}
      <div className={`grid gap-1.5 mb-3 ${token.isAiLaunched ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <div className="bg-[#14142a] rounded-lg p-2 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Rewards</p>
          <p className="text-sm font-bold text-green-400">{formatRewards(token.suiRewards)}</p>
        </div>
        <div className="bg-[#14142a] rounded-lg p-2 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Holders</p>
          <p className="text-sm font-bold text-white">{token.holders}</p>
        </div>
        <div className="bg-[#14142a] rounded-lg p-2 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Mkt Cap</p>
          <p className="text-sm font-bold text-purple-400">{formatMarketCap(token.marketCap)}</p>
        </div>
        {token.isAiLaunched && (
          <div className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 rounded-lg p-2 border border-purple-500/20">
            <p className="text-[10px] text-purple-400/80 uppercase tracking-wide mb-0.5">🤖 Agent Vol</p>
            <p className="text-sm font-bold text-purple-300">
              {token.agentVolume24h ? `${token.agentVolume24h.toFixed(1)} SUI` : '0 SUI'}
            </p>
          </div>
        )}
      </div>

      {/* Bonding Curve Progress */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Bonding</span>
          <span className={`text-xs font-bold ${koth ? 'text-yellow-400' : 'text-gray-300'}`}>
            {token.bondingProgress.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 bg-[#14142a] rounded-full overflow-hidden border border-white/5">
          <div 
            className={`h-full bg-gradient-to-r ${getBondingColor(token.bondingProgress)} rounded-full transition-all duration-300`}
            style={{ width: `${Math.min(token.bondingProgress, 100)}%` }}
          />
        </div>
      </div>

      {/* Mini Action Buttons */}
      <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button 
          onClick={(e) => { e.stopPropagation() }}
          className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors"
        >
          Buy
        </button>
        <button 
          onClick={(e) => { e.stopPropagation() }}
          className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
        >
          Sell
        </button>
      </div>
    </div>
  )
}
