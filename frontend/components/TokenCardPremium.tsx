'use client'

import { useState } from 'react'
import { Clock, Flame, Crown, Zap, Twitter, Send, Globe, TrendingUp, Activity, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { getPairType } from '@/lib/contracts_aida'

interface TokenType {
  id: string
  name: string
  symbol: string
  logoUrl?: string
  age: string
  creatorShort: string
  creatorFull: string
  priceChange24h: number
  volume1h: number
  marketCap: number
  bondingProgress: number
  description?: string
  liveStreamUrl?: string
  isAiLaunched?: boolean
  agentVolume24h?: number
  twitter?: string
  telegram?: string
  website?: string
  coinType?: string
  moonbagsPackageId?: string
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

export default function TokenCardPremium({ token, onClick }: { token: TokenType; onClick?: () => void }) {
  const [copied, setCopied] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  
  const priceUp = token.priceChange24h >= 0
  const isHot = token.priceChange24h >= 20
  const isGraduating = token.bondingProgress >= 70
  const pairType = getPairType(token.moonbagsPackageId)

  const handleCopyCA = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!token.coinType) return
    navigator.clipboard.writeText(token.coinType)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -8, scale: 1.02 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onClick={onClick}
      className="group relative cursor-pointer"
    >
      {/* Glow effect on hover */}
      <div className="absolute -inset-[1px] bg-gradient-to-r from-[#D4AF37]/20 via-[#FFD700]/20 to-[#B8860B]/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      
      {/* Card container */}
      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden">
        
        {/* AI Launched Badge */}
        {token.isAiLaunched && (
          <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-full bg-gradient-to-r from-[#D4AF37] to-[#FFD700] flex items-center gap-1.5 shadow-lg">
            <Sparkles className="w-3 h-3 text-white" />
            <span className="text-[10px] font-bold text-white uppercase tracking-wide">AI Agent</span>
          </div>
        )}

        {/* Hot Badge */}
        {isHot && !token.isAiLaunched && (
          <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-full bg-gradient-to-r from-orange-500 to-red-600 flex items-center gap-1 shadow-lg">
            <Flame className="w-3 h-3 text-white" />
            <span className="text-[10px] font-bold text-white uppercase tracking-wide">Hot</span>
          </div>
        )}

        {/* Pair Badge (top-left) */}
        <div
          className={`absolute top-3 left-3 z-10 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
            pairType === 'AIDA'
              ? 'bg-[#D4AF37]/20 text-[#D4AF37] border-[#D4AF37]/40'
              : 'bg-sky-500/20 text-sky-300 border-sky-500/40'
          }`}
        >
          {pairType}
        </div>

        {/* Token Image */}
        <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900">
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent z-10" />
          
          {token.logoUrl ? (
            <motion.img
              src={token.logoUrl}
              alt={token.name}
              className="w-full h-full object-cover"
              animate={{ scale: isHovered ? 1.1 : 1 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-6xl font-bold bg-gradient-to-br from-[#D4AF37] via-[#FFD700] to-[#B8860B] bg-clip-text text-transparent">
                {token.symbol.slice(0, 2)}
              </div>
            </div>
          )}

          {/* Graduating shine effect */}
          {isGraduating && (
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-400/30 to-transparent"
              animate={{ x: ['-100%', '200%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            />
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          
          {/* Name & Symbol */}
          <div className="space-y-1">
            <h3 className="font-bold text-white text-lg truncate group-hover:text-[#D4AF37] transition-colors">
              {token.name}
            </h3>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">${token.symbol}</span>
              {token.coinType && (
                <button
                  onClick={handleCopyCA}
                  className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] text-gray-500 hover:text-white transition-all font-mono"
                >
                  {copied ? '✓ Copied' : 'CA'}
                </button>
              )}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-2">
            {/* Market Cap */}
            <div className="bg-white/5 rounded-lg p-2 border border-white/5">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Market Cap</div>
              <div className="text-sm font-bold text-white">{formatMarketCap(token.marketCap)}</div>
            </div>

            {/* 24h Change */}
            <div className="bg-white/5 rounded-lg p-2 border border-white/5">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">24h</div>
              <div className={`text-sm font-bold flex items-center gap-1 ${priceUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {priceUp ? <TrendingUp className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
                {priceUp ? '+' : ''}{token.priceChange24h.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Volume (if AI agent) */}
          {token.isAiLaunched && token.agentVolume24h !== undefined && (
            <div className="bg-gradient-to-r from-[#D4AF37]/30 to-[#FFD700]/30 rounded-lg p-2 border border-[#D4AF37]/20">
              <div className="text-[10px] text-[#D4AF37] uppercase tracking-wide mb-0.5">Agent Volume 24h</div>
              <div className="text-sm font-bold text-[#D4AF37]">{formatVolume(token.agentVolume24h)} {pairType}</div>
            </div>
          )}

          {/* Bonding Progress */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Progress</span>
              <span className="font-bold text-white">{token.bondingProgress.toFixed(1)}%</span>
            </div>
            <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-[#D4AF37]"
                initial={{ width: 0 }}
                animate={{ width: `${token.bondingProgress}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
              {isGraduating && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent"
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                />
              )}
            </div>
          </div>

          {/* Social Links */}
          {(token.twitter || token.telegram || token.website) && (
            <div className="flex items-center gap-1.5 pt-1">
              {token.twitter && (
                <a
                  href={token.twitter.startsWith('http') ? token.twitter : `https://twitter.com/${token.twitter.replace('@', '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-sky-500/20 border border-white/10 hover:border-sky-500/50 flex items-center justify-center text-gray-500 hover:text-sky-400 transition-all"
                >
                  <Twitter className="w-3.5 h-3.5" />
                </a>
              )}
              {token.telegram && (
                <a
                  href={token.telegram.startsWith('http') ? token.telegram : `https://t.me/${token.telegram.replace('@', '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-blue-500/20 border border-white/10 hover:border-blue-500/50 flex items-center justify-center text-gray-500 hover:text-blue-400 transition-all"
                >
                  <Send className="w-3.5 h-3.5" />
                </a>
              )}
              {token.website && (
                <a
                  href={token.website.startsWith('http') ? token.website : `https://${token.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#D4AF37]/20 border border-white/10 hover:border-[#D4AF37]/50 flex items-center justify-center text-gray-500 hover:text-[#D4AF37] transition-all"
                >
                  <Globe className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          )}

          {/* Creator Info */}
          <div className="flex items-center gap-2 pt-1 border-t border-white/5">
            <Clock className="w-3 h-3 text-gray-600" />
            <span className="text-xs text-gray-500">{token.age}</span>
            <span className="text-xs text-gray-600">•</span>
            <span className="text-xs text-gray-500 truncate" title={token.creatorFull}>
              {token.creatorShort}
            </span>
          </div>

        </div>
      </div>
    </motion.div>
  )
}
