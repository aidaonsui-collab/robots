'use client'

import { useState } from 'react'
import { ExternalLink, Copy, Check, Rocket } from 'lucide-react'
import { getPairType } from '@/lib/contracts_aida'

interface Props {
  coinType: string          // Full coin type e.g. "0x9b23…::hero::HERO"
  symbol: string
  moonbagsPackageId?: string
  poolId?: string           // Original bonding curve pool ID (for SuiVision link)
}

// Shown on the coin detail page in place of the Trade tab once a token has
// graduated off the bonding curve onto Cetus CLMM. The bonding pool is
// drained at graduation, so on-curve swaps are no longer possible — users
// route through external DEXs or aggregators to trade.
export default function GraduatedTokenPanel({ coinType, symbol, moonbagsPackageId, poolId }: Props) {
  const pairType = getPairType(moonbagsPackageId)
  const pairCoinType = pairType === 'AIDA'
    ? '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'
    : '0x2::sui::SUI'

  const [copied, setCopied] = useState<'ca' | 'pool' | null>(null)
  const copy = async (value: string, kind: 'ca' | 'pool') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      /* noop */
    }
  }

  const cetusUrl = `https://app.cetus.zone/swap?from=${encodeURIComponent(pairCoinType)}&to=${encodeURIComponent(coinType)}`
  const deeptradeUrl = `https://deeptrade.io/swap?from=${encodeURIComponent(pairCoinType)}&to=${encodeURIComponent(coinType)}`
  const suivisionUrl = poolId
    ? `https://suivision.xyz/object/${poolId}`
    : `https://suivision.xyz/coin/${encodeURIComponent(coinType)}`

  return (
    <div className="bg-[#0f0f17] border border-[#D4AF37]/30 rounded-2xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center">
          <Rocket className="w-5 h-5 text-black" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Graduated to Cetus</h2>
          <p className="text-xs text-gray-500">${symbol} bonding curve completed — trade on a DEX below.</p>
        </div>
      </div>

      {/* External trade CTAs — Cetus is where the liquidity actually lives
          post-graduation (LP burned on Cetus CLMM). DeepTrade is kept as
          an aggregator fallback. */}
      <div className="space-y-2">
        <a
          href={cetusUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between w-full p-4 rounded-xl bg-gradient-to-r from-[#D4AF37]/20 to-[#FFD700]/20 border border-[#D4AF37]/40 hover:from-[#D4AF37]/30 hover:to-[#FFD700]/30 transition-colors"
        >
          <div>
            <p className="text-sm font-bold text-[#D4AF37]">Trade on Cetus</p>
            <p className="text-[10px] text-gray-400">CLMM pool with burned LP · the canonical DEX for ${symbol}</p>
          </div>
          <ExternalLink className="w-4 h-4 text-[#D4AF37]" />
        </a>

        <a
          href={deeptradeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between w-full p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
        >
          <div>
            <p className="text-sm font-semibold text-white">Trade on DeepTrade</p>
            <p className="text-[10px] text-gray-500">Aggregator fallback · auto-routes through the Cetus pool</p>
          </div>
          <ExternalLink className="w-4 h-4 text-gray-400" />
        </a>

        <a
          href={suivisionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between w-full p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
        >
          <div>
            <p className="text-sm font-semibold text-white">View on SuiVision</p>
            <p className="text-[10px] text-gray-500">On-chain block explorer</p>
          </div>
          <ExternalLink className="w-4 h-4 text-gray-400" />
        </a>
      </div>

      {/* CA copy */}
      <div className="space-y-2 pt-2 border-t border-white/5">
        <button
          onClick={() => copy(coinType, 'ca')}
          className="flex items-center justify-between w-full p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">{symbol} contract address</p>
            <p className="text-xs font-mono text-gray-300 truncate">{coinType}</p>
          </div>
          <span className="ml-3 flex items-center gap-1 text-[10px] font-bold text-[#D4AF37]">
            {copied === 'ca' ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
          </span>
        </button>

        {poolId && (
          <button
            onClick={() => copy(poolId, 'pool')}
            className="flex items-center justify-between w-full p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Bonding pool ID</p>
              <p className="text-xs font-mono text-gray-300 truncate">{poolId}</p>
            </div>
            <span className="ml-3 flex items-center gap-1 text-[10px] font-bold text-[#D4AF37]">
              {copied === 'pool' ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
            </span>
          </button>
        )}
      </div>

      <p className="text-[10px] text-gray-600 text-center leading-relaxed">
        Paired against <span className="font-semibold text-white">{pairType}</span>.
        Liquidity lives on Cetus CLMM with LP burned — the bonding curve pool is closed.
      </p>
    </div>
  )
}
