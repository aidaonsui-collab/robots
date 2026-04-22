'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  TrendingUp, TrendingDown, Users, Coins, ExternalLink,
  Twitter, Globe, MessageCircle, Trophy, Copy, Check,
  ArrowUpDown, Settings, Wallet, Send, ChevronDown,
  Lock, Star, Flame, Info, BarChart2, MessageSquare,
  List, Layers, Crown, Zap, DollarSign, PieChart, AlertCircle, Loader2
} from 'lucide-react'
import { useCurrentWallet, useCurrentAccount, useSuiClientQuery, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import {
  MOONBAGS_CONTRACT_LEGACY,
  MOONBAGS_CONTRACT_V12,
  CETUS_CONTRACT,
  SUI_CLOCK,
  SUI_METADATA_ID,
  AIDA_CONTRACT,
  PLATFORM_TOKEN_CONTRACT,
  getMoonbagsContractForPackage,
} from '@/lib/contracts'
import { AIDA_COIN_TYPE, getPairType } from '@/lib/contracts_aida'

// V11 was a fresh publish using the same shared config/lockConfig as legacy.
// It's now grouped under MOONBAGS_LEGACY_PACKAGE_IDS but needs separate routing
// because its buy function uses a 6-arg signature (no Cetus/Turbos deps).
const V11_PKG_ID = '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813'
import { Gift } from 'lucide-react'
import PriceChart, { PricePoint } from '@/components/coin/PriceChart'
import GraduatedTokenPanel from '@/components/coin/GraduatedTokenPanel'
import PerTokenStakePanel from '@/components/coin/PerTokenStakePanel'
import TradingViewChart from '@/components/coin/TradingViewChart'
import BubbleMap from '@/components/coin/BubbleMap'
import { VideoEmbed } from '@/components/VideoEmbed'
import { formatNumber, formatSui } from '@/lib/utils'
import { fetchPoolToken, fetchPoolTrades, fetchSuiNSName, PoolToken, TradeEvent } from '@/lib/tokens'

// ============================================
// HELPERS
// ============================================
/** Format a very small price so significant digits are always visible. */
function formatSmallPrice(n: number): string {
  if (n === 0) return '0.00'
  if (n >= 0.01) return n.toFixed(6)
  if (n >= 0.0001) return n.toFixed(8)
  // For prices < 0.0001, show up to 4 significant digits after leading zeros
  const str = n.toFixed(20)
  const match = str.match(/^0\.(0*)(\d{4})/)
  if (match) return `0.${match[1]}${match[2]}`
  return n.toFixed(10)
}

// ============================================
// MOCK DATA
// ============================================
function generatePriceHistory() {
  const data = []
  const now = Math.floor(Date.now() / 1000)
  let price = 0.002
  for (let i = 0; i < 120; i++) {
    price += (Math.random() - 0.4) * 0.0002
    price = Math.max(0.001, Math.min(0.012, price))
    data.push({ time: now - (120 - i) * 1800, value: price })
  }
  return data
}

const MOCK_TOKEN = {
  name: 'SuiCorn',
  symbol: 'SUICRN',
  description: 'The first unicorn-themed memecoin on Sui. Join the herd and ride the rainbow to the moon! 🦄 Built by degens, for degens. Fair launch, no pre-sale, no VC. 100% community owned.',
  logo: '',
  contract: '0x7a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3',
  creator: '0x742d35cc4f8e7a3b8c9d2e1f0a3b4c5d6e7f8a9b',
  creatorShort: '742d35',
  twitter: 'https://twitter.com/suicorn',
  telegram: 'https://t.me/suicorn',
  website: 'https://suicorn.sui',
  currentPrice: 0.004218,
  priceChange24h: +12.4,
  marketCap: 42180,
  volume24h: 8340,
  holders: 1234,
  suiRewards: 12.5,
  progress: 42,
  threshold: 500,
  realSuiRaised: 210,
  status: 'Bonding' as 'Bonding' | 'Completed' | 'Migrated',
  totalSupply: '1,000,000,000',
  age: '2d',
  isAiLaunched: true,
  agentVolume24h: 142.8,
  priceHistory: generatePriceHistory(),
  trades: [
    { type: 'buy' as const, address: '0x742d35cc4f8e7a3', suiAmount: 5.2, tokenAmount: 1238, price: 0.0042, time: '12s ago' },
    { type: 'sell' as const, address: '0x1a2b9c4d7e8f0a2', suiAmount: 2.1, tokenAmount: 500, price: 0.0042, time: '45s ago' },
    { type: 'buy' as const, address: '0x9f3c2d7b8e5a1f4', suiAmount: 10.5, tokenAmount: 2500, price: 0.0041, time: '1m ago' },
    { type: 'sell' as const, address: '0x5e8a1d2c4f6b9e0', suiAmount: 1.8, tokenAmount: 428, price: 0.0041, time: '2m ago' },
    { type: 'buy' as const, address: '0x3c7d9e2f1a5b8c4', suiAmount: 8.2, tokenAmount: 1952, price: 0.0040, time: '3m ago' },
    { type: 'sell' as const, address: '0x2a4b6c8d0e1f3a5', suiAmount: 3.5, tokenAmount: 833, price: 0.0041, time: '5m ago' },
    { type: 'buy' as const, address: '0x7f9e2d1a4b6c8e0', suiAmount: 12.0, tokenAmount: 2857, price: 0.0040, time: '7m ago' },
    { type: 'sell' as const, address: '0x4d8a1c3e5f7b9d2', suiAmount: 0.9, tokenAmount: 214, price: 0.0039, time: '9m ago' },
    { type: 'buy' as const, address: '0xab1c2d3e4f5a6b7', suiAmount: 6.6, tokenAmount: 1571, price: 0.0042, time: '11m ago' },
    { type: 'buy' as const, address: '0xcc9d8e7f6a5b4c3', suiAmount: 4.4, tokenAmount: 1047, price: 0.0042, time: '14m ago' },
  ],
}

const MOCK_THREAD = [
  { id: 1, user: '0x742d...3a8f', avatar: '🦄', message: 'Just aped in with 10 SUI, LFG! 🚀🚀🚀', time: '2m ago', likes: 12 },
  { id: 2, user: '0x1a2b...9c0d', avatar: '🐸', message: 'The tokenomics are clean, no pre-sale. This is the one.', time: '5m ago', likes: 7 },
  { id: 3, user: '0x9f3c...7b2e', avatar: '🌈', message: 'Already at 42% bonding curve, gonna hit DEX soon frens', time: '12m ago', likes: 24 },
  { id: 4, user: '0x5e8a...1d4f', avatar: '💎', message: 'Diamond hands only 💎🙌 not selling until $1M mcap', time: '18m ago', likes: 19 },
  { id: 5, user: '0x3c7d...8e9f', avatar: '🦁', message: 'Chart looking bullish, higher lows forming', time: '31m ago', likes: 8 },
  { id: 6, user: '0x2a4b...6c7d', avatar: '🚀', message: 'First buy. Love the vibes in this community!', time: '45m ago', likes: 5 },
]

const MOCK_STAKING = {
  apr: 38.5,
  totalStaked: '12,450,000',
  stakedSui: '892.4',
  rewardsPool: '96.4',
  userStaked: 0,
  userPendingRewards: 0,
}

const TOP_HOLDERS = [
  { rank: 1, address: '0x742d...3a8f', percent: 8.2, amount: '82,000,000', badge: '👑' },
  { rank: 2, address: '0x9f3c...7b2e', percent: 5.1, amount: '51,000,000', badge: '🥈' },
  { rank: 3, address: '0x1a2b...9c0d', percent: 4.4, amount: '44,000,000', badge: '🥉' },
  { rank: 4, address: '0x5e8a...1d4f', percent: 3.2, amount: '32,000,000', badge: '' },
  { rank: 5, address: '0x3c7d...8e9f', percent: 2.8, amount: '28,000,000', badge: '' },
  { rank: 6, address: '0x2a4b...6c7d', percent: 2.1, amount: '21,000,000', badge: '' },
  { rank: 7, address: '0xab1c...4f5a', percent: 1.9, amount: '19,000,000', badge: '' },
  { rank: 8, address: '0xcc9d...4c3d', percent: 1.6, amount: '16,000,000', badge: '' },
]

// ============================================
// TYPES
// ============================================
type TradeRow = {
  type: 'buy' | 'sell'
  address: string    // shortened display
  user?: string      // full address for SuiNS + Suivision
  suiAmount: number
  tokenAmount: number
  price: number
  time: string
  txDigest?: string
}

// ============================================
// HELPERS
// ============================================
function shortenAddr(a: string, n = 4) {
  return `${a.slice(0, n + 2)}...${a.slice(-n)}`
}

function formatTimeAgo(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs
  const diffS = Math.floor(diffMs / 1000)
  if (diffS < 60) return `${diffS}s ago`
  const diffM = Math.floor(diffS / 60)
  if (diffM < 60) return `${diffM}m ago`
  const diffH = Math.floor(diffM / 60)
  return `${diffH}h ago`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="p-1 hover:bg-white/10 rounded transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
    </button>
  )
}

// ============================================
// TAB: INFO
// ============================================
const SUI_RPC = 'https://fullnode.mainnet.sui.io'

// ── Top Holders ──────────────────────────────────────────────────────────────
function TopHolders({ coinType, poolId, creatorAddress, onTotalCount }: { coinType?: string; poolId?: string; creatorAddress?: string; onTotalCount?: (count: number) => void }) {
  const [holders, setHolders] = useState<{ rank: number; address: string; balance: string; percentage: number; isDev?: boolean }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!coinType) return
    setLoading(true)
    setError(false)
    const params = new URLSearchParams({ coinType })
    if (poolId) params.set('poolId', poolId)
    if (creatorAddress) params.set('creatorAddress', creatorAddress)
    fetch(`/api/holders?${params}`)
      .then(r => r.json())
      .then(d => {
        setHolders(d.holders ?? [])
        if (typeof d.total === 'number' && d.total > 0) onTotalCount?.(d.total)
        else if (d.holders?.length) onTotalCount?.(d.holders.length)
        if (!d.holders?.length && d.error) setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [coinType, poolId, creatorAddress])

  if (!coinType) return (
    <div className="flex flex-col items-center py-6 gap-2 text-center">
      <Users className="w-7 h-7 text-gray-700" />
      <p className="text-xs text-gray-500">Connect to view holders</p>
    </div>
  )

  if (loading) return (
    <div className="flex items-center justify-center py-6">
      <div className="w-5 h-5 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
    </div>
  )

  if (error || !holders.length) return (
    <div className="flex flex-col items-center py-6 gap-2 text-center">
      <Users className="w-7 h-7 text-gray-700" />
      <p className="text-xs text-gray-500">No holder data available yet</p>
    </div>
  )

  return (
    <div className="space-y-1.5">
      {holders.map((h) => (
        <div key={h.rank} className="flex items-center gap-2.5 py-1">
          {/* Rank */}
          <span className="w-4 text-right text-[10px] font-mono text-gray-600 shrink-0">
            {h.rank <= 3 ? ['🥇','🥈','🥉'][h.rank - 1] : h.rank}
          </span>
          {/* Address + dev badge */}
          <a
            href={`https://suiscan.xyz/mainnet/account/${h.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 font-mono text-xs text-gray-400 hover:text-[#D4AF37] transition-colors truncate flex items-center gap-1.5 min-w-0"
          >
            <span className="truncate">{h.address.slice(0, 6)}...{h.address.slice(-4)}</span>
            {h.isDev && (
              <span className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30">
                DEV
              </span>
            )}
          </a>
          {/* Bar + percentage */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-16 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#D4AF37] rounded-full"
                style={{ width: `${Math.min(100, h.percentage)}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-gray-400 w-9 text-right">
              {h.percentage < 0.01 ? '<0.01' : h.percentage.toFixed(2)}%
            </span>
          </div>
        </div>
      ))}
      <p className="text-[10px] text-gray-700 text-right mt-2">via Sui RPC</p>
    </div>
  )
}

function InfoTab({ token, coinType, poolId, creatorAddress, connectedAddress, moonbagsPackageId }: {
  token: typeof MOCK_TOKEN
  coinType?: string
  poolId?: string
  creatorAddress?: string
  connectedAddress?: string
  moonbagsPackageId?: string
}) {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const [creatorRewards, setCreatorRewards] = useState<number | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimMsg, setClaimMsg] = useState('')
  const [distributing, setDistributing] = useState(false)
  const [distributeMsg, setDistributeMsg] = useState('')

  const isCreator = !!connectedAddress && connectedAddress.toLowerCase() === token.creator.toLowerCase()

  // Route per-pool: each package era has its own shared objects.
  // `getMoonbagsContractForPackage()` already maps V11 + previous V12
  // pools to MOONBAGS_CONTRACT_V12_PREV (which owns the shared
  // Configuration/stakeConfig/lockConfig both publishes use), the current
  // V12 pool to MOONBAGS_CONTRACT_V12, AIDA pairs to the AIDA bundle, and
  // anything else on the legacy chain to MOONBAGS_CONTRACT_LEGACY.
  //
  // V11 is the one wrinkle: it's a fresh publish that still emits module
  // entries under its OWN package id, even though its shared objects
  // belong to V12_PREV. So for V11 pools we point module calls at
  // V11_PKG_ID while reading shared objects from the routed bundle.
  const mbagsContract = getMoonbagsContractForPackage(moonbagsPackageId)
  const isV11Pool = moonbagsPackageId === V11_PKG_ID
  const claimStakeConfig = mbagsContract.stakeConfig
  const claimConfiguration = mbagsContract.configuration
  const claimPackageId = isV11Pool ? V11_PKG_ID : mbagsContract.packageId

  // Fetch accumulated creator pool balance
  useEffect(() => {
    if (!connectedAddress || !coinType) return
    fetchCreatorPool(coinType)
  }, [connectedAddress, coinType, claimStakeConfig])

  const fetchCreatorPool = async (ct: string) => {
    try {
      // The CreatorPool is a dynamic field of the stake Configuration keyed
      // by coin type string. Which Configuration depends on which chain
      // created the pool (legacy vs v11).
      const typeKey = ct.replace(/^0x/, '') // strip leading 0x for key lookup
      const res = await fetch(SUI_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'suix_getDynamicFields',
          params: [claimStakeConfig, null, 50],
        }),
      })
      const data = await res.json()
      const pools: any[] = data.result?.data ?? []
      const creatorPool = pools.find((p: any) =>
        p.objectType?.includes('CreatorPool') && p.objectType?.includes(typeKey)
      )
      if (!creatorPool) { setCreatorRewards(0); return }

      // Get the pool object to read the SUI balance
      const poolRes = await fetch(SUI_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'sui_getObject',
          params: [creatorPool.objectId, { showContent: true }],
        }),
      })
      const poolData = await poolRes.json()
      const fields = poolData.result?.data?.content?.fields ?? {}
      // The creator pool likely has a sui_token or balance field
      const suiBalance = fields.sui_token?.fields?.balance ?? fields.balance ?? 0
      setCreatorRewards(Number(suiBalance) / 1e9)
    } catch (e) {
      console.error('fetchCreatorPool', e)
    }
  }

  const handleClaimCreatorFees = async () => {
    if (!coinType || !connectedAddress) return
    setClaiming(true)
    setClaimMsg('Claiming...')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${claimPackageId}::moonbags_stake::claim_creator_pool`,
        typeArguments: [coinType],
        arguments: [
          tx.object(claimStakeConfig),
          tx.object(SUI_CLOCK),
        ],
      })
      const result = await signAndExecute({ transaction: tx })
      setClaimMsg(`✅ Claimed! Tx: ${result.digest.slice(0, 10)}...`)
      setCreatorRewards(0)
    } catch (e: any) {
      setClaimMsg('Error: ' + (e.message ?? 'unknown'))
    }
    setClaiming(false)
  }

  // withdraw_fee_bonding_curve<T0=coinType, T1=AIDA> distributes accumulated fees
  // for this specific token to its StakingPool and CreatorPool
  // T1 must match Configuration.token_platform_type_name on-chain (set WITHOUT 0x prefix)
  const handleDistributeTokenFees = async () => {
    if (!coinType || !connectedAddress) return
    setDistributing(true)
    setDistributeMsg('Distributing fees...')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${claimPackageId}::moonbags::withdraw_fee_bonding_curve`,
        typeArguments: [coinType, PLATFORM_TOKEN_CONTRACT.fullAddress],
        arguments: [
          tx.object(claimConfiguration),
          tx.object(claimStakeConfig),
          tx.object(SUI_CLOCK),
        ],
      })
      const result = await signAndExecute({ transaction: tx })
      setDistributeMsg(`✅ Fees distributed! Tx: ${result.digest.slice(0, 10)}...`)
      // Refresh creator rewards after distribution
      setTimeout(() => fetchCreatorPool(coinType), 3000)
    } catch (e: any) {
      setDistributeMsg('Error: ' + (e.message ?? 'unknown'))
    }
    setDistributing(false)
  }

  return (
    <div className="space-y-5 fade-in">
      {/* Description */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-5">
        <h4 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
          <Info className="w-4 h-4 text-[#D4AF37]" /> About
        </h4>
        <p className="text-sm text-gray-400 leading-relaxed">{token.description}</p>
      </div>

      {/* Contract & Creator */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-5 space-y-3">
        <h4 className="text-sm font-semibold text-gray-300 mb-3">Token Details</h4>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Contract</span>
          <div className="flex items-center gap-1">
            <span className="font-mono text-cyan-400 text-xs">{shortenAddr(token.contract, 6)}</span>
            <CopyButton text={token.contract} />
            <a href={`https://suiscan.xyz/mainnet/object/${token.contract}`} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-white/10 rounded transition-colors">
              <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
            </a>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Creator</span>
          <div className="flex items-center gap-1">
            <span className="font-mono text-cyan-400 text-xs">[{token.creatorShort}]</span>
            <CopyButton text={token.creator} />
            <a href={`https://suiscan.xyz/mainnet/account/${token.creator}`} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-white/10 rounded transition-colors">
              <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
            </a>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Total Supply</span>
          <span className="text-gray-200 font-medium">{token.totalSupply}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Network</span>
          <span className="text-blue-400 font-medium">Sui Mainnet</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Age</span>
          <span className="text-gray-200">{token.age}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Status</span>
          <span className={`font-semibold ${token.status === 'Migrated' ? 'text-blue-400' : 'text-green-400'}`}>{token.status}</span>
        </div>
      </div>

      {/* Socials */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-5">
        <h4 className="text-sm font-semibold text-gray-300 mb-3">Links</h4>
        <div className="flex flex-wrap gap-2">
          <a href={token.twitter} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 bg-[#14142a] hover:bg-blue-500/10 border border-gray-700/50 hover:border-blue-500/40 rounded-lg text-sm text-gray-300 hover:text-blue-400 transition-all">
            <Twitter className="w-4 h-4" /> Twitter
          </a>
          <a href={token.telegram} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 bg-[#14142a] hover:bg-cyan-500/10 border border-gray-700/50 hover:border-cyan-500/40 rounded-lg text-sm text-gray-300 hover:text-cyan-400 transition-all">
            <MessageCircle className="w-4 h-4" /> Telegram
          </a>
          <a href={token.website} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 bg-[#14142a] hover:bg-[#D4AF37]/10 border border-gray-700/50 hover:border-[#D4AF37]/40 rounded-lg text-sm text-gray-300 hover:text-[#D4AF37] transition-all">
            <Globe className="w-4 h-4" /> Website
          </a>
        </div>
      </div>

      {/* Fee distribution + Creator claim — visible when wallet is connected and coinType is available */}
      {connectedAddress && coinType && (
        <div className="bg-[#0f0f17] border border-green-500/20 rounded-xl p-5 space-y-4">
          {/* Distribute button — anyone can call this to push fees into pools */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-green-400 mb-1 flex items-center gap-2">
                <Gift className="w-4 h-4" /> Distribute Trading Fees
              </h4>
              <p className="text-xs text-gray-500">Push this token&apos;s accumulated trading fees to the creator pool and staker pool. Anyone can do this.</p>
              {distributeMsg && <p className="text-xs mt-1.5 text-yellow-400">{distributeMsg}</p>}
            </div>
            <button
              onClick={handleDistributeTokenFees}
              disabled={distributing}
              className="shrink-0 px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-xl text-green-400 text-xs font-semibold disabled:opacity-50 hover:bg-green-500/30 transition-colors flex items-center gap-1.5"
            >
              {distributing
                ? <><span className="w-3.5 h-3.5 border-2 border-green-400/40 border-t-green-400 rounded-full animate-spin" />Distributing...</>
                : '⚡ Distribute'}
            </button>
          </div>

          {/* Creator claim — only visible to token creator */}
          {isCreator && (
            <div className="border-t border-gray-800/50 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Your Creator Fees</p>
                  <p className="text-xl font-bold text-yellow-400">
                    {creatorRewards === null ? '...' : `${creatorRewards.toFixed(4)} SUI`}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">30% of trading fees go to creator</p>
                </div>
                <button
                  onClick={handleClaimCreatorFees}
                  disabled={claiming || !creatorRewards || creatorRewards <= 0}
                  className="px-5 py-2.5 bg-yellow-500/20 border border-yellow-500/30 rounded-xl text-yellow-400 text-sm font-semibold disabled:opacity-50 hover:bg-yellow-500/30 transition-colors"
                >
                  {claiming ? 'Claiming...' : 'Claim Fees'}
                </button>
              </div>
              {claimMsg && <p className="text-xs text-gray-400 mt-2">{claimMsg}</p>}
            </div>
          )}
        </div>
      )}

      {/* Bonding Curve Visual */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-5">
        <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-[#D4AF37]" /> Bonding Curve Progress
        </h4>
        <div className="flex justify-between text-xs text-gray-500 mb-2">
          <span>0 SUI</span>
          <span className="text-[#D4AF37] font-semibold">{token.progress}% filled</span>
          <span>Target: {token.threshold} SUI</span>
        </div>
        <div className="h-4 bg-[#14142a] rounded-full overflow-hidden border border-white/5 mb-3">
          <div
            className="h-full bg-[#D4AF37] rounded-full transition-all duration-700"
            style={{ width: `${token.progress}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#14142a] rounded-lg p-3 border border-white/5">
            <p className="text-xs text-gray-500 mb-1">Raised</p>
            <p className="font-bold text-white">{token.realSuiRaised.toFixed(1)} SUI</p>
          </div>
          <div className="bg-[#14142a] rounded-lg p-3 border border-white/5">
            <p className="text-xs text-gray-500 mb-1">Remaining</p>
            <p className="font-bold text-white">{(token.threshold - token.realSuiRaised).toFixed(1)} SUI</p>
          </div>
        </div>
        {token.progress >= 70 && (
          <div className="mt-3 flex items-center gap-2 text-yellow-400 text-sm bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            <Crown className="w-4 h-4" />
            <span className="font-semibold">King of the Hill! Migrating to DEX soon.</span>
          </div>
        )}
      </div>

      {/* Top Holders */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-5">
        <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-[#D4AF37]" /> Top Holders
        </h4>
        <TopHolders coinType={coinType} poolId={poolId} creatorAddress={creatorAddress} />
      </div>
    </div>
  )
}

// ============================================
// TAB: TRADE (Buy/Sell full panel)
// ============================================
function TradeTab({ token, poolData, pairType, onTradeSuccess }: { token: typeof MOCK_TOKEN, poolData: PoolToken | null, pairType: string, onTradeSuccess?: () => void }) {
  if (poolData?.isCompleted) {
    return (
      <GraduatedTokenPanel
        coinType={poolData.coinType}
        symbol={token.symbol}
        moonbagsPackageId={poolData.moonbagsPackageId}
        poolId={poolData.poolId}
      />
    )
  }

  const { isConnected: connected } = useCurrentWallet()
  const account = useCurrentAccount()
  const address = account?.address

  // SuiClient instance — used in handleTrade for getCoins (AIDA pair)
  const suiClient = useSuiClient()

  // Derive quoteCoinType from pairType prop
  const quoteCoinType = pairType === 'AIDA' ? AIDA_COIN_TYPE : '0x2::sui::SUI'

  // Fetch real pair-token (SUI or AIDA) balance
  const { data: balanceData, refetch: refetchBalance } = useSuiClientQuery(
    'getBalance',
    { owner: address ?? '', coinType: quoteCoinType },
    { enabled: !!address }
  )
  const suiBalance = balanceData
    ? Math.floor(Number(balanceData.totalBalance) / 1e7) / 100
    : 0

  // Fetch token coins for sell
  const { data: tokenCoinsData, refetch: refetchTokenCoins } = useSuiClientQuery(
    'getCoins',
    { owner: address ?? '', coinType: poolData?.coinType ?? '' },
    { enabled: !!address && !!poolData?.coinType }
  )
  // Exact base-unit balance (BigInt) — needed by the sell flow to avoid float
  // precision overshoot when the user clicks Max / 100%.
  const tokenBaseBalance = useMemo(() => {
    if (!tokenCoinsData?.data?.length) return 0n
    return tokenCoinsData.data.reduce((s: bigint, c: any) => s + BigInt(c.balance), 0n)
  }, [tokenCoinsData])
  const tokenBalance = useMemo(() => {
    return Math.floor(Number(tokenBaseBalance) / 1e4) / 100
  }, [tokenBaseBalance])

  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction()
  const [txError, setTxError] = useState<string | null>(null)
  const [txSuccess, setTxSuccess] = useState<string | null>(null)

  const [mode, setMode] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(1)

  // Compute output estimate from bonding curve reserves
  const outputAmount = useMemo(() => {
    if (!amount || parseFloat(amount) <= 0 || !poolData) return 0
    const vSui = Number(poolData.virtualSuiReserves) / 1e9
    const vToken = Number(poolData.virtualTokenReserves) / 1e6
    if (mode === 'buy') {
      const amtSui = parseFloat(amount)
      return (vToken * amtSui) / (vSui + amtSui)
    } else {
      const amtToken = parseFloat(amount)
      return (vSui * amtToken) / (vToken + amtToken)
    }
  }, [amount, mode, poolData])

  const priceImpact = parseFloat(amount || '0') > 50 ? '>5%' : '<0.1%'
  const fee = parseFloat(amount || '0') * 0.01
  const quickAmounts = mode === 'buy' ? [1, 5, 10, 25] : [25, 50, 75, 100]

  // Route per-pool: the pool's package segment tells us which bundle's
  // shared objects to use. The legacy v7 chain uses a 10-arg Cetus-aware
  // buy entry; V11, both V12 publishes, and AIDA-pair all stripped those
  // deps and use the 6-arg `buy_exact_in_with_lock`.
  const mbagsContract = getMoonbagsContractForPackage(poolData?.moonbagsPackageId)
  // V11 pools still call the V11 module directly even though their shared
  // objects live on MOONBAGS_CONTRACT_V12_PREV, so we keep a flag for
  // selecting the right package id as the move-call target below.
  const poolPkgId = poolData?.moonbagsPackageId ?? ''
  const isV11Pool = poolPkgId === V11_PKG_ID
  // `isStrippedBuy` captures every V11+ publish (both V12 eras, AIDA-pair
  // — all use the 6-arg `buy_exact_in_with_lock`) vs. the legacy v7 chain
  // which uses the 10-arg Cetus-aware variant. Computing this from the
  // routed bundle is cheaper than maintaining a list of known pkgIds.
  const isStrippedBuy = mbagsContract !== MOONBAGS_CONTRACT_LEGACY

  const handleTrade = async () => {
    if (!poolData || !address || !amount || parseFloat(amount) <= 0) return
    setTxError(null)
    setTxSuccess(null)
    const tx = new Transaction()

    if (mode === 'buy') {
      const amountInMist = BigInt(Math.floor(parseFloat(amount) * 1e9))
      const vSui = poolData.virtualSuiReserves
      const vToken = poolData.virtualTokenReserves
      const tokensOut = vToken > 0n ? (vToken * amountInMist) / (vSui + amountInMist) : 1n
      const slipBps = BigInt(Math.round(slippage * 100))
      const minTokensOut = tokensOut * (10000n - slipBps) / 10000n

      // Contract charges 2% fee (200 bps) — coin must cover amount_in + fee + buffer
      const coinAmount = amountInMist * 103n / 100n

      let suiCoin
      if (pairType === 'AIDA') {
        const { data: aidaCoins } = await suiClient.getCoins({ owner: address, coinType: AIDA_COIN_TYPE })
        if (!aidaCoins.length) throw new Error('No AIDA coins in wallet')
        const base = tx.object(aidaCoins[0].coinObjectId)
        for (let i = 1; i < aidaCoins.length; i++) {
          tx.moveCall({
            target: '0x2::pay::join',
            typeArguments: [AIDA_COIN_TYPE],
            arguments: [base, tx.object(aidaCoins[i].coinObjectId)],
          })
        }
        const [split] = tx.splitCoins(base, [coinAmount])
        suiCoin = split
      } else {
        const [split] = tx.splitCoins(tx.gas, [coinAmount])
        suiCoin = split
      }

      if (isStrippedBuy) {
        // v11 and v12: stripped Cetus/Turbos deps, 6-arg buy_exact_in_with_lock.
        // v11 is a fresh publish like v12 — both share the same configuration/lockConfig objects.
        // (V11 + V12-prev share MOONBAGS_CONTRACT_V12_PREV's stakeConfig)
        const buyPkg = isV11Pool ? V11_PKG_ID : mbagsContract.packageId
        const buyCfg = mbagsContract.configuration
        const buyLock = mbagsContract.lockConfig
        tx.moveCall({
          target: `${buyPkg}::moonbags::buy_exact_in_with_lock`,
          typeArguments: [poolData.coinType],
          arguments: [
            tx.object(buyCfg),
            tx.object(buyLock),
            suiCoin,
            tx.pure.u64(amountInMist),
            tx.pure.u64(minTokensOut > 0n ? minTokensOut : 1n),
            tx.object(SUI_CLOCK),
          ],
        })
      } else {
        // Legacy v7 chain: 10-arg buy with Cetus pool/burn manager deps
        tx.moveCall({
          target: `${MOONBAGS_CONTRACT_LEGACY.packageId}::moonbags::buy_exact_in_with_lock`,
          typeArguments: [poolData.coinType],
          arguments: [
            tx.object(MOONBAGS_CONTRACT_LEGACY.configuration),
            tx.object(MOONBAGS_CONTRACT_LEGACY.lockConfig),
            suiCoin,
            tx.pure.u64(amountInMist),
            tx.pure.u64(minTokensOut > 0n ? minTokensOut : 1n),
            tx.object(CETUS_CONTRACT.burnManager),
            tx.object(CETUS_CONTRACT.pools),
            tx.object(CETUS_CONTRACT.globalConfig),
            tx.object(SUI_METADATA_ID),
            tx.object(SUI_CLOCK),
          ],
        })
      }
    } else {
      // Sell — same signature on legacy and v11, just swap IDs via mbagsContract.
      if (!tokenCoinsData?.data?.length) {
        setTxError('No tokens found in wallet')
        return
      }
      // Convert the displayed amount to base units. The display value is
      // rounded down to 2 decimals, so the float-derived `sellAmountBase`
      // can occasionally overshoot the actual on-chain balance by 1 ulp due
      // to IEEE 754 imprecision — clamp it down to `tokenBaseBalance` to
      // avoid `InsufficientCoinBalance` from splitCoins.
      let sellAmountBase = BigInt(Math.floor(parseFloat(amount) * 1e6))
      if (sellAmountBase > tokenBaseBalance) sellAmountBase = tokenBaseBalance
      if (sellAmountBase <= 0n) {
        setTxError('Sell amount must be greater than zero')
        return
      }

      const vSui = poolData.virtualSuiReserves
      const vToken = poolData.virtualTokenReserves
      const suiOut = vToken > 0n ? (vSui * sellAmountBase) / (vToken + sellAmountBase) : 0n
      // Contract deducts 2% platform fee from SUI output before paying
      const suiOutAfterFee = suiOut * 9800n / 10000n
      const slipBps = BigInt(Math.round(slippage * 100))
      const minSuiOut = suiOutAfterFee * (10000n - slipBps) / 10000n

      const coins = tokenCoinsData.data
      const primaryCoin = tx.object(coins[0].coinObjectId)
      if (coins.length > 1) {
        tx.mergeCoins(primaryCoin, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)))
      }

      // If the user is selling 100% of their balance, pass the merged coin
      // straight to `sell` instead of splitting (split would have to take
      // the *exact* full balance, which is fragile across float rounding).
      let sellCoin
      if (sellAmountBase >= tokenBaseBalance) {
        sellCoin = primaryCoin
      } else {
        ;[sellCoin] = tx.splitCoins(primaryCoin, [sellAmountBase])
      }

      // v11 pools: use V11_PKG_ID as target (stripped sell, same as v12) with shared config.
      // Legacy pools: use mbagsContract (MOONBAGS_CONTRACT_LEGACY) — 10-arg buy but same 4-arg sell.
      const sellPkg = isV11Pool ? V11_PKG_ID : mbagsContract.packageId
      const sellCfg = mbagsContract.configuration
      tx.moveCall({
        target: `${sellPkg}::moonbags::sell`,
        typeArguments: [poolData.coinType],
        arguments: [
          tx.object(sellCfg),
          sellCoin,
          tx.pure.u64(minSuiOut > 0n ? minSuiOut : 0n),
          tx.object(SUI_CLOCK),
        ],
      })
    }

    signAndExecute(
      { transaction: tx },
      {
        onSuccess: async (result) => {
          // `onSuccess` fires as soon as the tx is accepted by the network —
          // Sui txs can still abort in Move execution and return a digest.
          // Wait for finality and inspect effects.status before celebrating.
          try {
            const res = await suiClient.waitForTransaction({
              digest: result.digest,
              options: { showEffects: true },
            })
            const status = res.effects?.status
            if (status?.status === 'success') {
              setTxSuccess(`Done! Digest: ${result.digest.slice(0, 10)}...`)
              setAmount('')
              // Refresh the wallet balance + token holdings so "Max" and the
              // receive estimator update immediately. Sui's fullnode is fast
              // enough that a single refetch right after the tx lands picks
              // up the new balances.
              refetchBalance()
              refetchTokenCoins()
              setTimeout(() => onTradeSuccess?.(), 3000)
              return
            }
            // Move-level abort — surface a useful message instead of "success"
            const raw = status?.error || 'Transaction aborted on-chain'
            const abortMatch = raw.match(/MoveAbort\([^)]+\),\s*(\d+)\)/)
            const abortCode = abortMatch ? Number(abortMatch[1]) : null
            const friendly = (() => {
              switch (abortCode) {
                case 1: return 'Slippage exceeded — price moved before your trade landed. Increase slippage tolerance and try again.'
                case 2: return 'Pool threshold not met for this action.'
                case 3: return 'Pool contract is on an older version — please refresh and retry.'
                case 4: return 'Pool has graduated to DEX — trade there instead of the bonding curve.'
                case 5: return 'Insufficient balance for this trade (including the 2% fee).'
                case 7: return 'Pool has not graduated yet — this action is only available post-graduation.'
                default: return raw.length > 160 ? raw.slice(0, 160) + '…' : raw
              }
            })()
            setTxError(friendly)
          } catch (e: any) {
            // If effects fetch fails, fall back to showing the digest with a warning
            setTxError(`Could not confirm tx status (${result.digest.slice(0, 10)}…). Check SuiVision.`)
          }
        },
        onError: (err: any) => {
          console.error('Trade error:', err)
          const msg = err?.message || 'Transaction failed'
          setTxError(msg.length > 120 ? msg.slice(0, 120) + '…' : msg)
        },
      }
    )
  }

  return (
    <div className="fade-in space-y-4">
      {/* Mode Tabs */}
      <div className="flex gap-2 p-1 bg-[#14142a] rounded-xl border border-white/5">
        <button
          onClick={() => { setMode('buy'); setAmount(''); setTxError(null); setTxSuccess(null) }}
          className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all ${
            mode === 'buy' ? 'bg-green-500 text-white shadow-lg shadow-green-500/25' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Buy {token.symbol}
        </button>
        <button
          onClick={() => { setMode('sell'); setAmount(''); setTxError(null); setTxSuccess(null) }}
          className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all ${
            mode === 'sell' ? 'bg-red-500 text-white shadow-lg shadow-red-500/25' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Sell {token.symbol}
        </button>
      </div>

      {/* Input */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-500 font-medium uppercase tracking-wider">
            {mode === 'buy' ? 'You Pay' : 'You Sell'}
          </label>
          {connected && (
            <button
              onClick={() => setAmount(mode === 'buy' ? suiBalance.toString() : tokenBalance.toString())}
              className="text-xs text-[#D4AF37] hover:text-[#D4AF37] transition-colors"
            >
              Max: {mode === 'buy' ? `${suiBalance} ${pairType}` : `${tokenBalance} ${token.symbol}`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="min-w-0 flex-1 bg-transparent text-2xl font-bold outline-none placeholder:text-gray-700 text-white"
          />
          <div className="flex-shrink-0 flex items-center gap-1.5 bg-[#14142a] border border-white/10 rounded-lg px-2.5 py-1.5">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
              {mode === 'buy' ? 'S' : token.symbol[0]}
            </div>
            <span className="text-sm font-semibold text-gray-200">{mode === 'buy' ? pairType : token.symbol}</span>
          </div>
        </div>

        {/* Quick amounts */}
        <div className="flex gap-2 mt-3">
          {quickAmounts.map((q) => (
            <button
              key={q}
              onClick={() => setAmount(mode === 'buy' ? q.toString() : (tokenBalance * q / 100).toFixed(2))}
              className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-white/5 hover:bg-[#D4AF37]/20 text-gray-400 hover:text-[#D4AF37] border border-white/5 hover:border-[#D4AF37]/30 transition-all"
            >
              {mode === 'buy' ? `${q} ${pairType}` : `${q}%`}
            </button>
          ))}
        </div>
      </div>

      {/* Arrow */}
      <div className="flex justify-center -my-1">
        <div className="bg-[#14142a] border border-gray-800/50 p-2 rounded-full cursor-pointer hover:bg-[#D4AF37]/10 transition-colors">
          <ArrowUpDown className="w-4 h-4 text-gray-400" />
        </div>
      </div>

      {/* Output */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4">
        <label className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2 block">
          {mode === 'buy' ? 'You Receive (est.)' : 'You Get (est.)'}
        </label>
        <div className="flex items-center gap-2 min-w-0">
          <span className="min-w-0 flex-1 text-2xl font-bold text-[#D4AF37] truncate">
            {outputAmount > 0 ? outputAmount.toFixed(mode === 'buy' ? 0 : 4) : '0.00'}
          </span>
          <div className="flex-shrink-0 flex items-center gap-1.5 bg-[#14142a] border border-white/10 rounded-lg px-2.5 py-1.5">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
              {mode === 'buy' ? token.symbol[0] : 'S'}
            </div>
            <span className="text-sm font-semibold text-gray-200">{mode === 'buy' ? token.symbol : pairType}</span>
          </div>
        </div>
      </div>

      {/* Trade Details */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4 space-y-2.5 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Price</span>
          <span className="text-gray-200">{formatSmallPrice(token.currentPrice)} SUI/{token.symbol}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Price Impact</span>
          <span className={parseFloat(amount || '0') > 50 ? 'text-red-400' : 'text-green-400'}>{priceImpact}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Platform Fee (1%)</span>
          <span className="text-gray-400">{fee.toFixed(4)} ${pairType}</span>
        </div>
        <div className="border-t border-gray-800/50 pt-2.5 flex justify-between items-center gap-2">
          <span className="text-gray-500 shrink-0">Slippage</span>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {[0.5, 1, 3, 5, 10].map((s) => (
              <button key={s} onClick={() => setSlippage(s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${slippage === s ? 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/40' : 'bg-[#14142a] text-gray-400 border border-white/5 hover:text-gray-200'}`}>
                {s}%
              </button>
            ))}
            <div className={`flex items-center rounded-lg text-xs font-semibold border transition-all ${![0.5, 1, 3, 5, 10].includes(slippage) ? 'bg-[#D4AF37]/20 text-[#D4AF37] border-[#D4AF37]/40' : 'bg-[#14142a] text-gray-400 border-white/5'}`}>
              <input
                type="number"
                min="0"
                max="50"
                step="0.1"
                placeholder="custom"
                value={![0.5, 1, 3, 5, 10].includes(slippage) ? slippage : ''}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v) && v >= 0 && v <= 50) setSlippage(v)
                }}
                className="w-14 px-2 py-1 bg-transparent text-xs font-semibold focus:outline-none placeholder:text-gray-600 tabular-nums text-right"
              />
              <span className="pr-2">%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Status messages */}
      {txError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
          ⚠️ {txError}
        </div>
      )}
      {txSuccess && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-xs text-green-400">
          ✅ {txSuccess}
        </div>
      )}

      {/* CTA Button */}
      <button
        onClick={handleTrade}
        className={`w-full py-4 rounded-xl font-bold text-base transition-all ${
          mode === 'buy'
            ? 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 shadow-lg shadow-green-500/25'
            : 'bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400 shadow-lg shadow-red-500/25'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        disabled={!amount || parseFloat(amount) <= 0 || isPending || !poolData}
      >
        {isPending ? (
          <span className="flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Processing...
          </span>
        ) : !connected ? (
          <span className="flex items-center justify-center gap-2"><Wallet className="w-4 h-4" /> Connect Wallet</span>
        ) : (
          `${mode === 'buy' ? '🟢 Buy' : '🔴 Sell'} ${token.symbol}`
        )}
      </button>
    </div>
  )
}

// ============================================
// TAB: THREAD
// ============================================
function ChatTab({ connectedAddress, poolId }: { connectedAddress?: string; poolId?: string }) {
  const [message, setMessage] = useState('')
  const [posts, setPosts] = useState<{ id: string; user: string; address: string; avatar: string; message: string; timestamp: number }[]>([])
  const [liked, setLiked] = useState<Set<string>>(new Set())
  const [suinsName, setSuinsName] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [loadError, setLoadError] = useState(false)

  // Load messages from API on mount (and when poolId changes)
  useEffect(() => {
    if (!poolId) return
    fetch(`/api/chat/${encodeURIComponent(poolId)}`)
      .then(r => r.json())
      .then(data => { if (data.messages) setPosts(data.messages) })
      .catch(() => setLoadError(true))
  }, [poolId])

  // Poll for new messages every 15s
  useEffect(() => {
    if (!poolId) return
    const interval = setInterval(() => {
      fetch(`/api/chat/${encodeURIComponent(poolId)}`)
        .then(r => r.json())
        .then(data => { if (data.messages) setPosts(data.messages) })
        .catch(() => {})
    }, 15_000)
    return () => clearInterval(interval)
  }, [poolId])

  useEffect(() => {
    if (!connectedAddress) { setSuinsName(null); return }
    fetchSuiNSName(connectedAddress).then(name => setSuinsName(name))
  }, [connectedAddress])

  const displayName = suinsName
    ? suinsName
    : connectedAddress
      ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`
      : ''

  const handlePost = async () => {
    if (!message.trim() || !connectedAddress || !poolId || posting) return
    const emojis = ['🚀','💎','🦄','🔥','🌈','🐸','⚡','🦁']
    const avatar = emojis[Math.floor(Math.random() * emojis.length)]
    setPosting(true)
    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(poolId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: displayName, address: connectedAddress, avatar, message: message.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        setPosts(prev => [data.message, ...prev])
        setMessage('')
      }
    } catch {}
    setPosting(false)
  }

  const toggleLike = (id: string) => {
    setLiked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Wallet not connected — show gate
  if (!connectedAddress) {
    return (
      <div className="fade-in flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center">
          <MessageSquare className="w-7 h-7 text-[#D4AF37]" />
        </div>
        <div>
          <p className="text-gray-300 font-semibold mb-1">Connect your wallet to chat</p>
          <p className="text-gray-600 text-sm">Join the conversation — connect your wallet to post and interact.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fade-in space-y-4">
      {/* Post input */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/30 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-mono text-[#D4AF37]">{connectedAddress.slice(2, 4)}</span>
          </div>
          <span className="text-xs font-mono text-cyan-400/70">{displayName}</span>
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost() } }}
          placeholder="Share your thoughts about this token..."
          rows={3}
          className="w-full bg-transparent text-sm text-gray-200 placeholder:text-gray-600 outline-none resize-none"
        />
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-800/40">
          <span className="text-xs text-gray-600">{message.length}/280</span>
          <button
            onClick={handlePost}
            disabled={!message.trim() || posting || !poolId}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#D4AF37]/90 text-white text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Post
          </button>
        </div>
      </div>

      {/* Posts */}
      <div className="space-y-3">
        {posts.length === 0 && (
          <div className="flex flex-col items-center py-10 gap-3 text-center">
            <MessageSquare className="w-8 h-8 text-gray-700" />
            <p className="text-sm text-gray-500">No messages yet — be the first!</p>
          </div>
        )}
        {posts.map((post) => (
          <div key={post.id} className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4 hover:border-gray-700/60 transition-all">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-[#14142a] border border-gray-700/50 flex items-center justify-center text-lg flex-shrink-0">
                {post.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-cyan-400/80">{post.user}</span>
                  <span className="text-xs text-gray-600">•</span>
                  <span className="text-xs text-gray-600">{formatTimeAgo(post.timestamp)}</span>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">{post.message}</p>
                <div className="flex items-center gap-4 mt-2">
                  <button
                    onClick={() => toggleLike(post.id)}
                    className={`flex items-center gap-1.5 text-xs transition-colors ${liked.has(post.id) ? 'text-pink-400' : 'text-gray-600 hover:text-pink-400'}`}
                  >
                    <Star className={`w-3.5 h-3.5 ${liked.has(post.id) ? 'fill-current' : ''}`} />
                    {liked.has(post.id) ? 1 : 0}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================
// TAB: TXNS
// ============================================
function TxnsTab({ trades, coinType, poolId, creatorAddress, pairType }: { trades: TradeRow[]; coinType?: string; poolId?: string; creatorAddress?: string; pairType?: string }) {
  const [txFilter, setTxFilter] = useState<'all' | 'buy' | 'sell'>('all')
  const [suinsNames, setSuinsNames] = useState<Record<string, string>>({})
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 10

  // Reset to page 0 when filter changes
  useEffect(() => { setPage(0) }, [txFilter])

  // Lazy SuiNS lookups for all unique wallet addresses
  useEffect(() => {
    const uniqueUsers = [...new Set(trades.filter(t => t.user).map(t => t.user!))]
    for (const addr of uniqueUsers) {
      if (addr in suinsNames) continue
      fetchSuiNSName(addr).then(name => {
        if (name) setSuinsNames(prev => ({ ...prev, [addr]: name }))
      })
    }
  }, [trades])

  const filtered = txFilter === 'all' ? trades : trades.filter(t => t.type === txFilter)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="fade-in">
      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {(['all', 'buy', 'sell'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setTxFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
              txFilter === f
                ? f === 'buy' ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                  : f === 'sell' ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                  : 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/40'
                : 'bg-[#14142a] text-gray-500 border border-white/5 hover:text-gray-300'
            }`}
          >
            {f === 'all' ? 'All Txns' : f === 'buy' ? '🟢 Buys' : '🔴 Sells'}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-600 self-center">{filtered.length} transactions</span>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-4 gap-2 text-[10px] text-gray-600 uppercase tracking-widest py-2 px-3 border-b border-gray-800/40 mb-1">
        <span>Type / Wallet</span>
        <span className="text-right">SUI Amount</span>
        <span className="text-right">Tokens</span>
        <span className="text-right">Price / Time</span>
      </div>

      <div className="space-y-1">
        {paginated.map((trade, i) => {
          const displayName = trade.user && suinsNames[trade.user]
            ? suinsNames[trade.user]
            : trade.address

          const rowContent = (
            <>
              {/* Type + Address */}
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${trade.type === 'buy' ? 'bg-green-500/15' : 'bg-red-500/15'}`}>
                  {trade.type === 'buy'
                    ? <TrendingUp className="w-3 h-3 text-green-400" />
                    : <TrendingDown className="w-3 h-3 text-red-400" />}
                </div>
                <div>
                  <span className={`text-xs font-semibold ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                    {trade.type === 'buy' ? 'Buy' : 'Sell'}
                  </span>
                  <p className="text-[10px] font-mono text-gray-600 truncate max-w-[80px]">{displayName}</p>
                </div>
              </div>

              {/* SUI */}
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-200">{trade.suiAmount.toFixed(2)} {pairType}</p>
                <p className="text-[10px] text-gray-600">{pairType}</p>
              </div>

              {/* Tokens */}
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-200">{trade.tokenAmount.toLocaleString()}</p>
                <p className="text-[10px] text-gray-600">tokens</p>
              </div>

              {/* Price + Time */}
              <div className="text-right">
                <p className="text-xs text-[#D4AF37] font-mono">{formatSmallPrice(trade.price)}</p>
                <p className="text-[10px] text-gray-600 flex items-center justify-end gap-1">
                  {trade.time}
                  {trade.txDigest && <ExternalLink className="w-2.5 h-2.5 text-gray-700" />}
                </p>
              </div>
            </>
          )

          return trade.txDigest ? (
            <a
              key={i}
              href={`https://suivision.xyz/txblock/${trade.txDigest}`}
              target="_blank"
              rel="noopener noreferrer"
              className="grid grid-cols-4 gap-2 items-center py-3 px-3 rounded-lg hover:bg-white/5 transition-colors border-b border-gray-800/20 last:border-0 cursor-pointer"
            >
              {rowContent}
            </a>
          ) : (
            <div
              key={i}
              className="grid grid-cols-4 gap-2 items-center py-3 px-3 rounded-lg hover:bg-white/5 transition-colors border-b border-gray-800/20 last:border-0"
            >
              {rowContent}
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-800/40">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#14142a] border border-white/5 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-600">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#14142a] border border-white/5 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      )}

      {/* Top Holders — visible on mobile only (sidebar shows it on lg+) */}
      {(coinType || poolId) && (
        <div className="mt-6 lg:hidden">
          <TopHolders coinType={coinType} poolId={poolId} creatorAddress={creatorAddress} />
        </div>
      )}
    </div>
  )
}

// ============================================
// TAB: STAKE
// ============================================
function StakeTab({ token, poolData }: { token: typeof MOCK_TOKEN, poolData: PoolToken | null }) {
  if (!poolData) return <div className="bg-[#0f0f17] border border-gray-800/60 rounded-2xl p-6"><p className="text-gray-400 text-sm">Loading…</p></div>
  return <PerTokenStakePanel coinType={poolData.coinType} symbol={token.symbol} moonbagsPackageId={poolData.moonbagsPackageId} />
}

// ============================================
// MAIN PAGE
// ============================================
const TABS = [
  { id: 'txns', label: 'Txns', icon: List },
  { id: 'trade', label: 'Trade', icon: Zap },
  { id: 'holders', label: 'Holders', icon: Users },
  { id: 'info', label: 'Info', icon: Info },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'stake', label: 'Stake', icon: Lock },
  { id: 'earnings', label: 'Earnings', icon: DollarSign },
] as const

type TabId = typeof TABS[number]['id']

// TradingView with canvas fallback — renders TV chart when library files are present,
// silently falls back to the custom canvas chart if missing (missing returns null).
function TradingViewChartWithFallback({
  poolId, symbol, priceHistory, onRefresh, pairType,
}: {
  poolId: string
  symbol: string
  priceHistory: PricePoint[]
  onRefresh?: () => void
  pairType: 'SUI' | 'AIDA'
}) {
  const [tvFailed, setTvFailed] = useState(false)
  const [tvMounted, setTvMounted] = useState(false)

  // After mount, attempt TV. If it returns null (missing files), show canvas instead.
  if (!tvMounted && typeof window !== 'undefined') {
    // Check synchronously if script already failed
    const hasTv = !!(window as any).TradingView
    if (!hasTv) {
      // Will resolve once TradingViewChart finishes loading or errors
    }
  }

  if (tvFailed) {
    return <PriceChart poolId={poolId} priceHistory={priceHistory} symbol={symbol} onRefresh={onRefresh} />
  }

  return (
    <TvOrCanvas
      poolId={poolId}
      symbol={symbol}
      priceHistory={priceHistory}
      onRefresh={onRefresh}
      pairType={pairType}
      onFail={() => setTvFailed(true)}
    />
  )
}

function TvOrCanvas({
  poolId, symbol, priceHistory, onRefresh, onFail, pairType,
}: {
  poolId: string
  symbol: string
  priceHistory: PricePoint[]
  onRefresh?: () => void
  onFail: () => void
  pairType: 'SUI' | 'AIDA'
}) {
  const [tvNull, setTvNull] = useState(false)

  const handleMissing = useCallback(() => setTvNull(true), [])

  // Also fall back after 5s if library never loaded (e.g. slow network)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!(window as any).TradingView) setTvNull(true)
    }, 5000)
    return () => clearTimeout(timer)
  }, [])

  if (tvNull) {
    return <PriceChart poolId={poolId} priceHistory={priceHistory} symbol={symbol} onRefresh={onRefresh} />
  }

  return <TradingViewChart poolId={poolId} symbol={symbol} height={480} onMissing={handleMissing} pairType={pairType} />
}

export default function CoinPage() {
  const params = useParams()
  const slug = params.slug as string
  const { currentWallet } = useCurrentWallet()
  const connectedAddress = currentWallet?.accounts?.[0]?.address
  const [activeTab, setActiveTab] = useState<TabId>('txns')
  const [poolData, setPoolData] = useState<PoolToken | null>(null)
  const [trades, setTrades] = useState<TradeRow[]>(MOCK_TOKEN.trades as TradeRow[])
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [refetchCount, setRefetchCount] = useState(0)
  const [holderCount, setHolderCount] = useState<number | null>(null)
  const [caCopied, setCaCopied] = useState(false)

  // Top-level pairType — derived from poolData, used in handleTrade via closure.
  // TradeTab reads poolData directly as prop, no need to pass pairType down.
  const pairType = poolData?.pairType ?? 'SUI'

  const handleTradeSuccess = () => setRefetchCount(c => c + 1)

  // Fetch real on-chain data
  useEffect(() => {
    if (!slug) return
    // Decode URL-encoded slug (e.g., %3A%3A -> ::)
    const decodedSlug = decodeURIComponent(slug)
    
    if (refetchCount === 0) setLoading(true)
    Promise.all([fetchPoolToken(decodedSlug), fetchPoolTrades(decodedSlug)]).then(([tokenData, tradeData]) => {
      if (tokenData) setPoolData(tokenData)
      if (tradeData.length > 0) {
        // Map TradeEvent to TradeRow
        const mapped: TradeRow[] = tradeData.map(t => ({
          type: t.isBuy ? 'buy' as const : 'sell' as const,
          address: shortenAddr(t.user),
          user: t.user,
          suiAmount: t.suiAmount,
          tokenAmount: Math.round(t.tokenAmount),
          price: t.price,
          time: formatTimeAgo(t.timestampMs),
          txDigest: t.txDigest || undefined,
        }))
        setTrades([...mapped].reverse()) // newest first

        // Build price history from trades (oldest first) — include volume/direction for chart
        const history: PricePoint[] = tradeData
          .slice()
          .reverse()
          .map(t => ({
            time: t.timestampMs,
            value: t.price,
            isBuy: t.isBuy,
            suiAmount: t.suiAmount,
          }))
        // Also add current price as latest point
        if (history.length > 0 && tokenData) {
          history.push({ time: Date.now(), value: tokenData.currentPrice })
        }
        setPriceHistory(history)
      }
      setLoading(false)
    })
  }, [slug, refetchCount])

  // Build token object: real data if available, fall back to mock
  const token = poolData ? {
    ...MOCK_TOKEN,
    name: poolData.name,
    symbol: poolData.symbol,
    description: poolData.description || MOCK_TOKEN.description,
    logo: poolData.imageUrl,
    contract: poolData.coinType.replace('COIN_TEMPLATE', poolData.symbol),
    creator: poolData.creator,
    creatorShort: poolData.creator.slice(2, 8),
    twitter: poolData.twitter ? (poolData.twitter.startsWith('http') ? poolData.twitter : `https://twitter.com/${poolData.twitter.replace('@','')}`) : '',
    telegram: poolData.telegram ? (poolData.telegram.startsWith('http') ? poolData.telegram : `https://t.me/${poolData.telegram.replace('@','')}`) : '',
    website: poolData.website || '',
    currentPrice: poolData.currentPrice,
    priceChange24h: 0,  // would need historical data
    marketCap: Math.round(poolData.marketCap),
    volume24h: trades.filter(t => t.type === 'buy').reduce((s, t) => s + t.suiAmount, 0),
    holders: 1,  // would need indexer
    suiRewards: 0,
    progress: Math.round(poolData.progress * 100) / 100,
    threshold: poolData.threshold,
    realSuiRaised: poolData.realSuiRaised,
    status: poolData.isCompleted ? 'Completed' as const : 'Bonding' as const,
    totalSupply: poolData.totalSupply ? poolData.totalSupply.toLocaleString() : '1,000,000,000',
    age: 'New',
    priceHistory: priceHistory.length > 0 ? priceHistory : MOCK_TOKEN.priceHistory,
    trades,
  } : {
    ...MOCK_TOKEN,
    name: slug?.startsWith('0x') ? 'Loading...' : (slug?.split('-')[0]?.charAt(0).toUpperCase() + slug?.split('-')[0]?.slice(1) || MOCK_TOKEN.name),
    symbol: slug?.startsWith('0x') ? '...' : (slug?.split('-')[1]?.toUpperCase() || MOCK_TOKEN.symbol),
  }

  // Only simulate live trades when we don't have real data (fallback mode)
  useEffect(() => {
    if (poolData) return  // real data mode - don't simulate
    const iv = setInterval(() => {
      const newTrade = {
        type: Math.random() > 0.5 ? 'buy' as const : 'sell' as const,
        address: `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}`,
        suiAmount: parseFloat((Math.random() * 12).toFixed(2)),
        tokenAmount: Math.floor(Math.random() * 3000),
        price: token.currentPrice + (Math.random() - 0.5) * 0.0001,
        time: 'Just now',
      }
      setTrades(prev => [newTrade as TradeRow, ...prev.slice(0, 14)])
    }, 5000)
    return () => clearInterval(iv)
  }, [poolData])

  if (loading) {
    return (
      <main className="min-h-screen pt-16 pb-12 bg-[#070710] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">Loading on-chain data...</p>
        </div>
      </main>
    )
  }

  const priceUp = token.priceChange24h >= 0

  return (
    <main className="min-h-screen pt-16 pb-12 bg-[#070710]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ======================================= */}
        {/* TOKEN HEADER */}
        {/* ======================================= */}
        <div className="py-5 border-b border-gray-800/40">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            {/* Logo */}
            <div className="relative flex-shrink-0">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-green-500 flex items-center justify-center text-white text-xl font-bold border-2 border-[#D4AF37]/30 overflow-hidden">
                {token.logo ? <img src={token.logo} alt={token.name} className="w-full h-full object-cover" /> : token.symbol.slice(0, 2)}
              </div>
              <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] blur opacity-30 -z-10" />
            </div>

            {/* Name + badges + CA + socials */}
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-white">{token.name}</h1>
                <span className="text-gray-500">/</span>
                <span className="text-lg font-mono text-[#D4AF37] font-bold">{token.symbol}</span>
                {token.progress >= 70 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 text-xs rounded-full font-semibold">
                    <Crown className="w-3 h-3" /> King of the Hill
                  </span>
                )}
                {token.status === 'Migrated' && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/15 border border-blue-500/30 text-blue-400 text-xs rounded-full font-semibold">
                    <ExternalLink className="w-3 h-3" /> On DEX
                  </span>
                )}
                {/* CA copy pill */}
                {token.contract && token.contract.length > 10 && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(token.contract)
                      setCaCopied(true)
                      setTimeout(() => setCaCopied(false), 1500)
                    }}
                    title={token.contract}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-gray-500 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all text-[10px] font-mono"
                  >
                    {caCopied ? (
                      <><span className="text-emerald-400">✓</span><span className="text-emerald-400">copied</span></>
                    ) : (
                      <><span>CA</span><span className="text-gray-600">{token.contract.slice(0, 6)}…{token.contract.split('::').pop()}</span><Copy className="w-2.5 h-2.5" /></>
                    )}
                  </button>
                )}
                {/* Social quick links */}
                {token.twitter && (
                  <a href={token.twitter} target="_blank" rel="noopener noreferrer"
                    className="p-1 rounded-md bg-white/5 border border-white/10 hover:bg-blue-500/10 hover:border-blue-500/30 transition-all">
                    <Twitter className="w-3 h-3 text-gray-500 hover:text-blue-400" />
                  </a>
                )}
                {token.telegram && (
                  <a href={token.telegram} target="_blank" rel="noopener noreferrer"
                    className="p-1 rounded-md bg-white/5 border border-white/10 hover:bg-cyan-500/10 hover:border-cyan-500/30 transition-all">
                    <MessageCircle className="w-3 h-3 text-gray-500 hover:text-cyan-400" />
                  </a>
                )}
                {token.website && (
                  <a href={token.website} target="_blank" rel="noopener noreferrer"
                    className="p-1 rounded-md bg-white/5 border border-white/10 hover:bg-[#D4AF37]/10 hover:border-[#D4AF37]/30 transition-all">
                    <Globe className="w-3 h-3 text-gray-500 hover:text-[#D4AF37]" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <span className={`text-2xl font-bold ${priceUp ? 'text-green-400' : 'text-red-400'}`}>
                  {formatSmallPrice(token.currentPrice)} SUI
                </span>
                <span className={`flex items-center gap-1 text-sm font-semibold px-2 py-0.5 rounded-full ${priceUp ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                  {priceUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {priceUp ? '+' : ''}{token.priceChange24h}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ======================================= */}
        {/* STATS PILLS ROW */}
        {/* ======================================= */}
        <div className="flex flex-wrap gap-2 py-4 border-b border-gray-800/40">
          {[
            { label: 'Mkt Cap', value: token.marketCap >= 1_000_000 ? `$${(token.marketCap / 1_000_000).toFixed(2)}M` : token.marketCap >= 1000 ? `$${(token.marketCap / 1000).toFixed(1)}K` : `$${token.marketCap.toFixed(0)}`, color: 'text-[#D4AF37]' },
            { label: 'Volume 24h', value: `${(token.volume24h / 1000).toFixed(1)}K ${pairType}`, color: 'text-blue-400' },
            { label: 'Holders', value: holderCount !== null ? holderCount.toLocaleString() : '—', color: 'text-cyan-400' },
            { label: `${pairType} Rewards`, value: `${token.suiRewards} ${pairType}`, color: 'text-green-400' },
            { label: 'Bonding', value: `${token.progress}%`, color: 'text-pink-400' },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2 bg-[#0f0f17] border border-gray-800/50 rounded-lg px-3 py-2">
              <span className="text-xs text-gray-500">{s.label}</span>
              <span className={`text-sm font-bold ${s.color}`}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* ======================================= */}
        {/* BONDING CURVE BAR */}
        {/* ======================================= */}
        <div className="py-3 border-b border-gray-800/40">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-500">Bonding Curve Progress</span>
            <span className="text-xs font-bold text-[#D4AF37]">{token.progress.toFixed(1)}% — {(token.threshold - token.realSuiRaised).toFixed(1)} ${pairType} until DEX migration</span>
          </div>
          <div className="h-2 bg-[#14142a] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#D4AF37] rounded-full transition-all"
              style={{ width: `${Math.min(100, token.progress)}%` }}
            />
          </div>
        </div>

        {/* ======================================= */}
        {/* LIVE STREAM (shown only when streamUrl is set) */}
        {/* ======================================= */}
        {poolData?.streamUrl && (
          <div className="py-5 border-b border-gray-800/40">
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <span className="text-xs font-semibold text-red-400 uppercase tracking-widest">Live</span>
            </div>
            <div className="rounded-xl overflow-hidden border border-gray-800/50 max-w-2xl mx-auto">
              <VideoEmbed url={poolData.streamUrl} title={`${poolData.name} Live Stream`} />
            </div>
          </div>
        )}

        {/* ======================================= */}
        {/* MAIN CONTENT: 2 columns */}
        {/* ======================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-6">

          {/* LEFT: Chart + Tabs */}
          <div className="lg:col-span-2 space-y-5">
            {/* Price Chart — TradingView when library is available, canvas fallback */}
            {poolData?.poolId ? (
              <TradingViewChartWithFallback
                poolId={poolData.poolId}
                symbol={token.symbol}
                priceHistory={priceHistory}
                onRefresh={handleTradeSuccess}
                pairType={pairType}
              />
            ) : (
              <PriceChart priceHistory={priceHistory} symbol={token.symbol} onRefresh={handleTradeSuccess} />
            )}

            {/* TAB NAVIGATION */}
            <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 overflow-hidden">
              {/* Tab bar — horizontally scrollable on mobile */}
              <div className="flex overflow-x-auto scrollbar-none border-b border-gray-800/50 bg-[#0a0a14]">
                {TABS.map((tab) => {
                  const Icon = tab.icon
                  const isActive = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-shrink-0 flex items-center justify-center gap-1.5 px-4 py-3.5 text-sm font-semibold transition-all border-b-2 ${
                        isActive
                          ? 'border-purple-500 text-[#D4AF37] bg-purple-500/5'
                          : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-white/3'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Tab content */}
              <div className={activeTab === 'trade' ? '' : 'p-5'}>
                {activeTab === 'txns' && <TxnsTab trades={trades} coinType={poolData?.coinType} poolId={poolData?.poolId} creatorAddress={poolData?.creator} pairType={pairType} />}
                {activeTab === 'trade' && (
                  <div className="p-5">
                    <TradeTab token={token} poolData={poolData} pairType={pairType} onTradeSuccess={handleTradeSuccess} />
                  </div>
                )}
                {activeTab === 'holders' && poolData?.coinType && (
                  <div className="p-5">
                    <BubbleMap coinType={poolData.coinType} symbol={token.symbol} poolId={poolData.poolId} />
                  </div>
                )}
                {activeTab === 'info' && <InfoTab token={token} coinType={poolData?.coinType} poolId={poolData?.poolId} creatorAddress={poolData?.creator} connectedAddress={connectedAddress} moonbagsPackageId={poolData?.moonbagsPackageId} />}
                {activeTab === 'chat' && <ChatTab connectedAddress={connectedAddress} poolId={poolData?.poolId} />}
                {activeTab === 'stake' && <StakeTab token={token} poolData={poolData} />}
                {activeTab === 'earnings' && (
                  <div className="fade-in grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Revenue Distribution */}
                    <div className="space-y-6">
                      <div>
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
                              <div className="h-full bg-purple-600" style={{ width: '30%' }} />
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
                              Earnings for the token creator
                            </p>
                          </div>

                          {/* Total Fees */}
                          <div className="border-t border-gray-800/50 pt-6 mt-6">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="bg-slate-800/50 rounded-xl p-4">
                                <div className="text-sm text-gray-400 mb-1">Total Trading Fees</div>
                                <div className="text-2xl font-bold text-white">{(token.volume24h * 0.02).toFixed(2)} ${pairType}</div>
                                <div className="text-xs text-gray-500 mt-1">2% of volume</div>
                              </div>
                              <div className="bg-slate-800/50 rounded-xl p-4">
                                <div className="text-sm text-gray-400 mb-1">To AIDA Stakers</div>
                                <div className="text-2xl font-bold text-[#D4AF37]">{(token.volume24h * 0.02 * 0.3).toFixed(2)} ${pairType}</div>
                                <div className="text-xs text-gray-500 mt-1">30% of fees</div>
                              </div>
                            </div>
                          </div>


                        </div>
                      </div>
                    </div>

                    {/* Creator Earnings */}
                    <div className="space-y-6">
                      <div className="bg-[#0f0f17] border border-gray-800/50 rounded-xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                          <Wallet className="w-6 h-6 text-[#D4AF37]" />
                          <h3 className="text-lg font-bold text-white">Creator Earnings</h3>
                        </div>

                        <div className="space-y-4">
                          <div className="bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-xl p-4">
                            <div className="text-sm text-gray-400 mb-1">Available to Withdraw</div>
                            <div className="text-3xl font-bold text-[#D4AF37]">
                              {(token.volume24h * 0.02 * 0.4).toFixed(2)} ${pairType}
                            </div>
                          </div>

                          <button className="w-full py-3 rounded-xl font-bold bg-[#D4AF37] text-black hover:opacity-90 transition-opacity">
                            Withdraw Earnings
                          </button>

                          <div className="border-t border-gray-800/50 pt-4">
                            <div className="text-sm text-gray-400 mb-3">Lifetime Earnings</div>
                            <div className="text-2xl font-bold text-white mb-1">
                              {(token.volume24h * 0.02 * 0.4).toFixed(2)} ${pairType}
                            </div>
                            <div className="text-xs text-gray-500">
                              From {trades.length} trades
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Recent Earnings */}
                      <div className="bg-[#0f0f17] border border-gray-800/50 rounded-xl p-6">
                        <h3 className="text-lg font-bold text-white mb-4">Recent Earnings</h3>
                        <div className="space-y-3">
                          {trades.slice(0, 5).map((trade, i) => {
                            const creatorEarnings = trade.suiAmount * 0.02 * 0.4
                            return (
                              <div key={i} className="flex items-center justify-between text-sm border-b border-gray-800/30 pb-3 last:border-0">
                                <div>
                                  <div className="text-gray-400">{trade.time}</div>
                                  <div className="text-xs text-gray-600">From {trade.type} trade</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-[#D4AF37] font-bold">+{creatorEarnings.toFixed(4)} SUI</div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: Sticky Buy/Sell Panel — hidden on mobile (Trade tab handles it) */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="sticky top-20 space-y-4">
              {/* Quick Trade */}
              <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-5">
                <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" /> Quick Trade
                </h3>
                <TradeTab token={token} poolData={poolData} pairType={pairType} onTradeSuccess={handleTradeSuccess} />
              </div>

              {/* Top Holders mini */}
              <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4">
                <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-[#D4AF37]" /> Top Holders
                </h4>
                <TopHolders coinType={poolData?.coinType} poolId={poolData?.poolId} creatorAddress={poolData?.creator} onTotalCount={setHolderCount} />
              </div>
            </div>
          </div>
        </div>
      </div>

    </main>
  )
}



