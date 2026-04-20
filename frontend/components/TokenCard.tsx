'use client'

import { useRef, useState, useEffect } from 'react'
import { Clock, Flame, Crown, Zap, Twitter, Send, Globe, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { getPairType, type PairToken } from '@/lib/contracts_aida'

interface TokenType {
  id: string
  name: string
  symbol: string
  logoUrl?: string
  age: string
  creatorShort: string
  creatorFull: string
  priceChange24h: number   // % (can be negative)
  volume1h: number         // pair-token traded in last 1h (SUI for SUI pools, AIDA for AIDA pools)
  marketCap: number
  bondingProgress: number  // 0-100
  description?: string
  liveStreamUrl?: string
  isAiLaunched?: boolean
  agentVolume24h?: number
  twitter?: string
  telegram?: string
  website?: string
  coinType?: string  // contract address for CA copy
  moonbagsPackageId?: string  // used to derive SUI vs AIDA pair
  pairType?: PairToken
  isCompleted?: boolean
}

function formatMarketCap(mc: number): string {
  if (mc === undefined || mc === null) return '$0'
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`
  if (mc >= 1_000) return `$${(mc / 1_000).toFixed(1)}K`
  return `$${mc.toFixed(2)}`
}

function formatVolume(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`
  if (v >= 1) return v.toFixed(2)
  return v.toFixed(3)
}

function resolvePair(token: TokenType): PairToken {
  return token.pairType ?? getPairType(token.moonbagsPackageId)
}

function isKingOfHill(progress: number): boolean { return progress >= 70 }
function isHot(priceChange: number): boolean { return priceChange >= 20 }
function hasLiveStream(token: TokenType): boolean { return !!token.liveStreamUrl && token.liveStreamUrl.length > 0 }

function getBondingColor(progress: number): string {
  return 'from-[#D4AF37] to-[#D4AF37]'
}

function PairBadge({ pair }: { pair: PairToken }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide border ${
        pair === 'AIDA'
          ? 'bg-[#D4AF37]/20 text-[#D4AF37] border-[#D4AF37]/40'
          : 'bg-sky-500/20 text-sky-300 border-sky-500/40'
      }`}
    >
      {pair}
    </span>
  )
}

function SocialLinks({ token, stopProp = true }: { token: TokenType, stopProp?: boolean }) {
  const links = [
    token.twitter && {
      href: token.twitter.startsWith('http') ? token.twitter : `https://twitter.com/${token.twitter.replace('@', '')}`,
      icon: <Twitter className="w-3 h-3" />,
      label: 'Twitter',
    },
    token.telegram && {
      href: token.telegram.startsWith('http') ? token.telegram : `https://t.me/${token.telegram.replace('@', '')}`,
      icon: <Send className="w-3 h-3" />,
      label: 'Telegram',
    },
    token.website && {
      href: token.website.startsWith('http') ? token.website : `https://${token.website}`,
      icon: <Globe className="w-3 h-3" />,
      label: 'Website',
    },
  ].filter(Boolean) as { href: string; icon: JSX.Element; label: string }[]

  if (!links.length) return null
  return (
    <div className="flex items-center gap-1.5">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          title={l.label}
          onClick={stopProp ? (e) => e.stopPropagation() : undefined}
          className="w-6 h-6 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
        >
          {l.icon}
        </a>
      ))}
    </div>
  )
}

function CopyCA({ coinType }: { coinType?: string }) {
  const [copied, setCopied] = useState(false)
  if (!coinType) return null
  const short = coinType.length > 20
    ? `${coinType.slice(0, 6)}…${coinType.split('::').pop()}`
    : coinType
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(coinType).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      title={coinType}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-gray-500 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all text-[10px] font-mono"
    >
      {copied ? (
        <><span className="text-emerald-400">✓</span><span className="text-emerald-400">copied</span></>
      ) : (
        <><span>CA</span><span className="text-gray-600">{short}</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></>
      )}
    </button>
  )
}

// ============================================
// SpotlightCard
// ============================================
export function SpotlightCard({ token, onClick }: { token: TokenType; onClick?: () => void }) {
  const koth = isKingOfHill(token.bondingProgress)
  const graduated = !!token.isCompleted
  const up = token.priceChange24h >= 0
  const pair = resolvePair(token)
  const innerRef = useRef<HTMLDivElement>(null)
  const [totalStaked, setTotalStaked] = useState<number | null>(null)

  useEffect(() => {
    if (!token.coinType || !token.symbol) return
    fetch(`/api/tokens/${encodeURIComponent(token.symbol)}/pool-stats?coinType=${encodeURIComponent(token.coinType)}`)
      .then(r => r.json())
      .then(d => { if (d.poolFound && typeof d.totalStaked === 'number') setTotalStaked(d.totalStaked) })
      .catch(() => {})
  }, [token.coinType, token.symbol])

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = innerRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  return (
    <div onClick={onClick} className="relative cursor-pointer mb-8 fade-in">
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
        <span className="bg-gradient-to-r from-[#FFD700] via-[#D4AF37] to-[#B8860B] text-black text-xs font-bold px-4 py-1 rounded-full shadow-lg shadow-[#D4AF37]/40 ambient-glow" style={{ color: '#000' }}>
          ✨ SPOTLIGHT
        </span>
      </div>

      <div className="relative rounded-2xl spotlight-border-anim shadow-2xl shadow-[#D4AF37]/25" style={{ padding: '1.5px' }}>
        <div ref={innerRef} onMouseMove={handleMove} className="spotlight-cursor bg-[#0d0f1a] rounded-2xl p-5">
          {/* Top Row */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="relative flex-shrink-0">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center text-white font-bold text-2xl border-2 border-[#D4AF37]/50 overflow-hidden">
                  {token.logoUrl
                    ? <img src={token.logoUrl} alt={token.name} className="w-full h-full rounded-full object-cover" />
                    : token.symbol.slice(0, 2)}
                </div>
                <div className="absolute -inset-1 bg-gradient-to-r from-[#D4AF37] to-[#FFD700] rounded-full blur-md opacity-40" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-white text-2xl truncate">{token.name}</h3>
                  <span className="text-muted-foreground text-base">({token.symbol})</span>
                  <PairBadge pair={pair} />
                  {token.isAiLaunched && (
                    <span className="flex items-center gap-1 bg-gradient-to-r from-[#D4AF37] to-[#FFD700] text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-lg">
                      <Zap className="w-3 h-3" /> AI AGENT
                    </span>
                  )}
                  {graduated && (
                    <span className="flex items-center gap-1 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold px-2 py-0.5 rounded-full">
                      🚀 GRADUATED
                    </span>
                  )}
                  {hasLiveStream(token) && (
                    <a href={token.liveStreamUrl} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 bg-red-500/20 border border-red-500/40 text-red-400 text-xs font-bold px-2 py-0.5 rounded-full hover:bg-red-500/30 transition-colors">
                      <span className="w-1.5 h-1.5 bg-red-400 rounded-full pulse-dot" />📺 LIVE
                    </a>
                  )}
                  {koth && !graduated && (
                    <span className="flex items-center gap-1 bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-xs font-bold px-2 py-0.5 rounded-full">
                      <Crown className="w-3 h-3" /> King
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <SocialLinks token={token} />
                  {totalStaked !== null && totalStaked > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-purple-400">
                      Staked {totalStaked >= 1_000_000 ? `${(totalStaked / 1_000_000).toFixed(1)}M` : totalStaked >= 1_000 ? `${(totalStaked / 1_000).toFixed(1)}K` : totalStaked.toFixed(0)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0 ml-2">
              <Clock className="w-3 h-3" />{token.age}
            </div>
          </div>

          {/* Creator + CA */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-xs text-gray-400">Creator: </span>
            <a href={`https://suiscan.xyz/mainnet/account/${token.creatorFull}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs font-mono text-cyan-400 hover:underline hover:text-cyan-300 transition-colors"
              onClick={(e) => e.stopPropagation()}>
              [{token.creatorShort}]
            </a>
            <CopyCA coinType={token.coinType} />
          </div>

          {token.description && (
            <p className="text-sm text-gray-300 line-clamp-2 mb-4 leading-relaxed">{token.description}</p>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.06]">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">24h Change</p>
              <p className={`text-lg font-bold flex items-center gap-1 ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                {up ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                {Math.abs(token.priceChange24h).toFixed(1)}%
              </p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.06]">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">1H Volume</p>
              <p className="text-lg font-bold text-white">{formatVolume(token.volume1h)} <span className="text-xs text-gray-500 font-normal">{pair}</span></p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.06]">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Mkt Cap</p>
              <p className="text-lg font-bold text-[#D4AF37]">{formatMarketCap(token.marketCap)}</p>
            </div>
          </div>

          {/* Bonding Progress */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-gray-400 font-medium">Bonding Progress</span>
              <span className={`text-sm font-bold ${graduated ? 'text-emerald-300' : koth ? 'text-yellow-400' : 'text-white'}`}>
                {token.bondingProgress.toFixed(2)}%
              </span>
            </div>
            <div className="h-3 bg-white/[0.04] rounded-full overflow-hidden border border-white/[0.06]">
              <div className={`h-full bg-gradient-to-r ${getBondingColor(token.bondingProgress)} rounded-full transition-all duration-500`}
                style={{ width: `${Math.min(token.bondingProgress, 100)}%` }} />
            </div>
            {graduated ? (
              <p className="text-xs text-emerald-400/80 mt-1.5 flex items-center gap-1">
                🚀 Live on Momentum — tap to trade
              </p>
            ) : koth && (
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
// Regular TokenCard
// ============================================
export default function TokenCard({ token, onClick }: { token: TokenType; onClick?: () => void }) {
  const koth = isKingOfHill(token.bondingProgress)
  const graduated = !!token.isCompleted
  const hot  = isHot(token.priceChange24h)
  const up   = token.priceChange24h >= 0
  const pair = resolvePair(token)

  return (
    <div
      onClick={onClick}
      className={`
        group relative bg-[#0d0f1a] rounded-xl border p-4 cursor-pointer
        card-lift card-shimmer overflow-hidden
        ${graduated
          ? 'border-[#D4AF37]/40 hover:border-[#D4AF37]/70 hover:shadow-[#D4AF37]/20 graduated-border'
          : koth
          ? 'border-yellow-500/30 hover:border-yellow-500/60 hover:shadow-yellow-500/10'
          : 'border-gray-800/60 hover:border-[#D4AF37]/40 hover:shadow-[#D4AF37]/10'
        }
      `}
    >
      {/* Top glow on hover */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] rounded-t-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r ${koth ? 'from-yellow-400 via-orange-400 to-red-400' : 'from-[#D4AF37] via-[#FFD700] to-[#B8860B]'}`} />

      {/* Top Row */}
      <div className="flex items-start justify-between mb-2.5">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center text-white font-bold text-lg border-2 border-[#D4AF37]/30 overflow-hidden">
              {token.logoUrl
                ? <img src={token.logoUrl} alt={token.name} className="w-full h-full rounded-full object-cover" />
                : token.symbol.slice(0, 2)}
            </div>
            {/* Live indicator dot on avatar */}
            {hasLiveStream(token) && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 border-2 border-[#0d0f1a] rounded-full pulse-dot" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="font-semibold text-white text-base truncate">{token.name}</h3>
              {koth && !graduated && <Crown className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />}
              {hot && <Flame className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-muted-foreground text-sm">({token.symbol})</span>
              <PairBadge pair={pair} />
              {graduated && (
                <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-emerald-500/30">
                  🚀 GRADUATED
                </span>
              )}
              {hasLiveStream(token) && (
                <a href={token.liveStreamUrl} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="bg-red-500/20 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-red-500/30 flex items-center gap-1 hover:bg-red-500/30 transition-colors">
                  <span className="w-1 h-1 bg-red-400 rounded-full pulse-dot" />📺 LIVE
                </a>
              )}
              {koth && !graduated && (
                <span className="bg-yellow-500/20 text-yellow-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-yellow-500/30">
                  KOTH
                </span>
              )}
              {token.isAiLaunched && (
                <span className="bg-gradient-to-r from-[#D4AF37]/20 to-[#FFD700]/20 text-[#D4AF37] text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-[#D4AF37]/30 flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> AI
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0 ml-1">
          <Clock className="w-3 h-3" />{token.age}
        </div>
      </div>

      {/* Creator + CA + Socials row */}
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <span className="text-xs text-gray-500">by </span>
          <a href={`https://suiscan.xyz/mainnet/account/${token.creatorFull}`}
            target="_blank" rel="noopener noreferrer"
            className="text-xs font-mono text-cyan-400/80 hover:text-cyan-300 hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}>
            [{token.creatorShort}]
          </a>
          <CopyCA coinType={token.coinType} />
        </div>
        <SocialLinks token={token} />
      </div>

      {token.description && (
        <p className="text-xs text-gray-400 line-clamp-2 mb-3 leading-relaxed">{token.description}</p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {/* 24h price change */}
        <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.06]">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">24h</p>
          <p className={`text-sm font-bold flex items-center gap-0.5 ${up ? 'text-emerald-400' : 'text-red-400'}`}>
            {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(token.priceChange24h).toFixed(1)}%
          </p>
        </div>
        {/* 1H volume */}
        <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.06]">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">1H Vol</p>
          <p className="text-sm font-bold text-white tabular-nums">{formatVolume(token.volume1h)}<span className="text-[9px] text-gray-600 ml-0.5">{pair}</span></p>
        </div>
        {/* Market cap */}
        <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.06]">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Mkt Cap</p>
          <p className="text-sm font-bold text-[#D4AF37]">{formatMarketCap(token.marketCap)}</p>
        </div>
      </div>

      {/* Bonding Progress */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Bonding</span>
          <span className={`text-xs font-bold ${graduated ? 'text-emerald-300' : koth ? 'text-yellow-400' : 'text-gray-300'}`}>
            {token.bondingProgress.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden border border-white/[0.06]">
          <div className={`h-full bg-gradient-to-r ${getBondingColor(token.bondingProgress)} rounded-full transition-all duration-300`}
            style={{ width: `${Math.min(token.bondingProgress, 100)}%` }} />
        </div>
      </div>

      {/* Mini Action Buttons */}
      <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button onClick={(e) => {
          e.stopPropagation()
          onClick?.()
        }}
          className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors">
          Buy
        </button>
        <button onClick={(e) => {
          e.stopPropagation()
          onClick?.()
        }}
          className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors">
          Sell
        </button>
      </div>
    </div>
  )
}
