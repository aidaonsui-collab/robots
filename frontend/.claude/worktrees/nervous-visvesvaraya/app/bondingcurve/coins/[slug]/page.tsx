'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import {
  TrendingUp, TrendingDown, Users, Coins, ExternalLink,
  Twitter, Globe, MessageCircle, Trophy, Copy, Check,
  ArrowUpDown, Settings, Wallet, Send, ChevronDown,
  Lock, Star, Flame, Info, BarChart2, MessageSquare,
  List, Layers, Crown, Zap
} from 'lucide-react'
import { useCurrentWallet } from '@mysten/dapp-kit'
import PriceChart from '@/components/coin/PriceChart'
import { formatNumber, formatSui } from '@/lib/utils'

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
// HELPERS
// ============================================
function shortenAddr(a: string, n = 4) {
  return `${a.slice(0, n + 2)}...${a.slice(-n)}`
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
function InfoTab({ token }: { token: typeof MOCK_TOKEN }) {
  return (
    <div className="space-y-5 fade-in">
      {/* Description */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-5">
        <h4 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
          <Info className="w-4 h-4 text-purple-400" /> About
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
            className="flex items-center gap-2 px-3 py-2 bg-[#14142a] hover:bg-purple-500/10 border border-gray-700/50 hover:border-purple-500/40 rounded-lg text-sm text-gray-300 hover:text-purple-400 transition-all">
            <Globe className="w-4 h-4" /> Website
          </a>
        </div>
      </div>

      {/* Bonding Curve Visual */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-5">
        <h4 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-purple-400" /> Bonding Curve Progress
        </h4>
        <div className="flex justify-between text-xs text-gray-500 mb-2">
          <span>0 SUI</span>
          <span className="text-purple-400 font-semibold">{token.progress}% filled</span>
          <span>Target: 500 SUI</span>
        </div>
        <div className="h-4 bg-[#14142a] rounded-full overflow-hidden border border-white/5 mb-3">
          <div
            className="h-full bg-gradient-to-r from-purple-600 via-pink-500 to-green-400 rounded-full transition-all duration-700"
            style={{ width: `${token.progress}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#14142a] rounded-lg p-3 border border-white/5">
            <p className="text-xs text-gray-500 mb-1">Raised</p>
            <p className="font-bold text-white">{(token.progress * 5).toFixed(0)} SUI</p>
          </div>
          <div className="bg-[#14142a] rounded-lg p-3 border border-white/5">
            <p className="text-xs text-gray-500 mb-1">Remaining</p>
            <p className="font-bold text-white">{((100 - token.progress) * 5).toFixed(0)} SUI</p>
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
          <Users className="w-4 h-4 text-purple-400" /> Top Holders
        </h4>
        <div className="space-y-2">
          {TOP_HOLDERS.map((h) => (
            <div key={h.rank} className="flex items-center gap-3">
              <span className="text-xs text-gray-600 w-4 text-center font-mono">{h.rank}</span>
              <span className="text-sm font-mono text-cyan-400/80 flex-1">{h.address}</span>
              <div className="w-20 h-1.5 bg-[#14142a] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-green-400 rounded-full" style={{ width: `${(h.percent / 10) * 100}%` }} />
              </div>
              <span className="text-xs text-gray-400 w-10 text-right">{h.percent}%</span>
              {h.badge && <span className="text-sm">{h.badge}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================
// TAB: TRADE (Buy/Sell full panel)
// ============================================
function TradeTab({ token }: { token: typeof MOCK_TOKEN }) {
  const { isConnected: connected, currentWallet } = useCurrentWallet()
  const address = currentWallet?. accounts?.[0]?. address
  const [mode, setMode] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(1)
  const [customSlippage, setCustomSlippage] = useState('')

  const suiBalance = connected ? 125.5 : 0
  const tokenBalance = connected ? 2500 : 0
  const outputAmount = amount ? parseFloat(amount) / token.currentPrice : 0
  const priceImpact = parseFloat(amount || '0') > 50 ? '>5%' : '<0.1%'
  const fee = parseFloat(amount || '0') * 0.01

  const quickAmounts = mode === 'buy' ? [1, 5, 10, 25] : [25, 50, 75, 100]

  return (
    <div className="fade-in space-y-4">
      {/* Mode Tabs */}
      <div className="flex gap-2 p-1 bg-[#14142a] rounded-xl border border-white/5">
        <button
          onClick={() => setMode('buy')}
          className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all ${
            mode === 'buy' ? 'bg-green-500 text-white shadow-lg shadow-green-500/25' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Buy {token.symbol}
        </button>
        <button
          onClick={() => setMode('sell')}
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
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              Max: {mode === 'buy' ? `${suiBalance} SUI` : `${tokenBalance} ${token.symbol}`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 bg-transparent text-2xl font-bold outline-none placeholder:text-gray-700 text-white"
          />
          <div className="flex items-center gap-2 bg-[#14142a] border border-white/10 rounded-lg px-3 py-2">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-green-500 flex items-center justify-center text-[10px] font-bold text-white">
              {mode === 'buy' ? 'S' : token.symbol[0]}
            </div>
            <span className="text-sm font-semibold text-gray-200">{mode === 'buy' ? 'SUI' : token.symbol}</span>
          </div>
        </div>

        {/* Quick amounts */}
        <div className="flex gap-2 mt-3">
          {quickAmounts.map((q) => (
            <button
              key={q}
              onClick={() => setAmount(q.toString())}
              className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-white/5 hover:bg-purple-500/20 text-gray-400 hover:text-purple-400 border border-white/5 hover:border-purple-500/30 transition-all"
            >
              {mode === 'buy' ? `${q} SUI` : `${q}%`}
            </button>
          ))}
        </div>
      </div>

      {/* Arrow */}
      <div className="flex justify-center -my-1">
        <div className="bg-[#14142a] border border-gray-800/50 p-2 rounded-full cursor-pointer hover:bg-purple-500/10 transition-colors">
          <ArrowUpDown className="w-4 h-4 text-gray-400" />
        </div>
      </div>

      {/* Output */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4">
        <label className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2 block">
          {mode === 'buy' ? 'You Receive' : 'You Get'}
        </label>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-2xl font-bold text-purple-400">
            {outputAmount > 0 ? outputAmount.toFixed(2) : '0.00'}
          </span>
          <div className="flex items-center gap-2 bg-[#14142a] border border-white/10 rounded-lg px-3 py-2">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-green-500 flex items-center justify-center text-[10px] font-bold text-white">
              {mode === 'buy' ? token.symbol[0] : 'S'}
            </div>
            <span className="text-sm font-semibold text-gray-200">{mode === 'buy' ? token.symbol : 'SUI'}</span>
          </div>
        </div>
      </div>

      {/* Trade Details */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4 space-y-2.5 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Price</span>
          <span className="text-gray-200">{token.currentPrice.toFixed(8)} SUI/{token.symbol}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Price Impact</span>
          <span className={parseFloat(amount || '0') > 50 ? 'text-red-400' : 'text-green-400'}>{priceImpact}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Platform Fee (1%)</span>
          <span className="text-gray-400">{fee.toFixed(4)} SUI</span>
        </div>
        <div className="border-t border-gray-800/50 pt-2.5 flex justify-between items-center">
          <span className="text-gray-500">Slippage</span>
          <div className="flex items-center gap-1.5">
            {[0.5, 1, 3].map((s) => (
              <button key={s} onClick={() => setSlippage(s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${slippage === s ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40' : 'bg-[#14142a] text-gray-400 border border-white/5 hover:text-gray-200'}`}>
                {s}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* CTA Button */}
      <button
        className={`w-full py-4 rounded-xl font-bold text-base transition-all ${
          mode === 'buy'
            ? 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 shadow-lg shadow-green-500/25'
            : 'bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400 shadow-lg shadow-red-500/25'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        disabled={!amount || parseFloat(amount) <= 0}
      >
        {!connected ? (
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
function ThreadTab() {
  const [message, setMessage] = useState('')
  const [posts, setPosts] = useState(MOCK_THREAD)
  const [liked, setLiked] = useState<Set<number>>(new Set())

  const handlePost = () => {
    if (!message.trim()) return
    const emojis = ['🚀','💎','🦄','🔥','🌈','🐸','⚡','🦁']
    setPosts([{
      id: Date.now(),
      user: '0xYou...r0x',
      avatar: emojis[Math.floor(Math.random() * emojis.length)],
      message: message.trim(),
      time: 'Just now',
      likes: 0,
    }, ...posts])
    setMessage('')
  }

  const toggleLike = (id: number) => {
    setLiked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="fade-in space-y-4">
      {/* Post input */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4">
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
            disabled={!message.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500 hover:bg-purple-400 text-white text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" /> Post
          </button>
        </div>
      </div>

      {/* Posts */}
      <div className="space-y-3">
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
                  <span className="text-xs text-gray-600">{post.time}</span>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">{post.message}</p>
                <div className="flex items-center gap-4 mt-2">
                  <button
                    onClick={() => toggleLike(post.id)}
                    className={`flex items-center gap-1.5 text-xs transition-colors ${liked.has(post.id) ? 'text-pink-400' : 'text-gray-600 hover:text-pink-400'}`}
                  >
                    <Star className={`w-3.5 h-3.5 ${liked.has(post.id) ? 'fill-current' : ''}`} />
                    {post.likes + (liked.has(post.id) ? 1 : 0)}
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
function TxnsTab({ trades }: { trades: typeof MOCK_TOKEN.trades }) {
  const [txFilter, setTxFilter] = useState<'all' | 'buy' | 'sell'>('all')
  const filtered = txFilter === 'all' ? trades : trades.filter(t => t.type === txFilter)

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
                  : 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
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
        {filtered.map((trade, i) => (
          <div
            key={i}
            className={`grid grid-cols-4 gap-2 items-center py-3 px-3 rounded-lg hover:bg-white/5 transition-colors border-b border-gray-800/20 last:border-0`}
          >
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
                <p className="text-[10px] font-mono text-gray-600">{shortenAddr(trade.address)}</p>
              </div>
            </div>

            {/* SUI */}
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-200">{trade.suiAmount.toFixed(2)}</p>
              <p className="text-[10px] text-gray-600">SUI</p>
            </div>

            {/* Tokens */}
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-200">{trade.tokenAmount.toLocaleString()}</p>
              <p className="text-[10px] text-gray-600">tokens</p>
            </div>

            {/* Price + Time */}
            <div className="text-right">
              <p className="text-xs text-purple-400 font-mono">{trade.price.toFixed(6)}</p>
              <p className="text-[10px] text-gray-600">{trade.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================
// TAB: STAKE
// ============================================
function StakeTab({ token }: { token: typeof MOCK_TOKEN }) {
  const { isConnected: connected, currentWallet } = useCurrentWallet()
  const address = currentWallet?. accounts?.[0]?. address
  const [stakeMode, setStakeMode] = useState<'stake' | 'unstake'>('stake')
  const [stakeAmount, setStakeAmount] = useState('')
  const s = MOCK_STAKING

  return (
    <div className="fade-in space-y-4">
      {/* APR Banner */}
      <div className="bg-gradient-to-r from-purple-600/20 via-pink-500/10 to-green-500/10 border border-purple-500/20 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 mb-1">Current APR</p>
          <p className="text-3xl font-bold gradient-text">{s.apr}%</p>
          <p className="text-xs text-gray-500 mt-1">Earn SUI rewards by staking {token.symbol}</p>
        </div>
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-green-500 flex items-center justify-center">
          <Flame className="w-7 h-7 text-white" />
        </div>
      </div>

      {/* Pool Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Total Staked</p>
          <p className="text-sm font-bold text-white">{s.totalStaked}</p>
          <p className="text-[10px] text-gray-600">{token.symbol}</p>
        </div>
        <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Rewards Pool</p>
          <p className="text-sm font-bold text-green-400">{s.rewardsPool}</p>
          <p className="text-[10px] text-gray-600">SUI</p>
        </div>
        <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">SUI Staked</p>
          <p className="text-sm font-bold text-purple-400">{s.stakedSui}</p>
          <p className="text-[10px] text-gray-600">SUI</p>
        </div>
      </div>

      {/* User Position */}
      {connected && (
        <div className="bg-[#0f0f17] rounded-xl border border-purple-500/20 p-4 space-y-2">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Your Position</h4>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Staked</span>
            <span className="text-white font-medium">{s.userStaked} {token.symbol}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Pending Rewards</span>
            <span className="text-green-400 font-medium">{s.userPendingRewards} SUI</span>
          </div>
          {s.userPendingRewards > 0 && (
            <button className="w-full mt-2 py-2 rounded-lg bg-green-500/15 text-green-400 border border-green-500/30 text-sm font-semibold hover:bg-green-500/25 transition-all">
              Claim {s.userPendingRewards} SUI
            </button>
          )}
        </div>
      )}

      {/* Stake / Unstake */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-5">
        <div className="flex gap-2 p-1 bg-[#14142a] rounded-xl border border-white/5 mb-4">
          <button
            onClick={() => setStakeMode('stake')}
            className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all ${stakeMode === 'stake' ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Stake
          </button>
          <button
            onClick={() => setStakeMode('unstake')}
            className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all ${stakeMode === 'unstake' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Unstake
          </button>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Amount ({token.symbol})</label>
            <button className="text-xs text-purple-400 hover:text-purple-300 transition-colors">Max</button>
          </div>
          <input
            type="number"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-[#14142a] border border-gray-700/50 rounded-xl py-3 px-4 text-lg font-bold outline-none focus:border-purple-500/50 transition-colors placeholder:text-gray-700"
          />
        </div>

        <button
          className="w-full py-4 rounded-xl font-bold text-base bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white shadow-lg shadow-purple-500/25 transition-all disabled:opacity-40"
          disabled={!stakeAmount || parseFloat(stakeAmount) <= 0 || !connected}
        >
          {!connected ? (
            <span className="flex items-center justify-center gap-2"><Wallet className="w-4 h-4" /> Connect Wallet</span>
          ) : (
            `${stakeMode === 'stake' ? '🔒 Stake' : '🔓 Unstake'} ${token.symbol}`
          )}
        </button>

        <p className="text-[11px] text-gray-600 text-center mt-3">
          25% of {token.symbol} trading fees distributed to stakers
        </p>
      </div>

      {/* How it works */}
      <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4">
        <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Info className="w-4 h-4 text-purple-400" /> How Staking Works
        </h4>
        <div className="space-y-2 text-xs text-gray-500">
          <div className="flex items-start gap-2"><Zap className="w-3.5 h-3.5 text-yellow-400 mt-0.5 flex-shrink-0" /><span>Stake {token.symbol} to earn a share of 25% of all trading fees</span></div>
          <div className="flex items-start gap-2"><Zap className="w-3.5 h-3.5 text-yellow-400 mt-0.5 flex-shrink-0" /><span>Rewards are paid in SUI and claimable at any time</span></div>
          <div className="flex items-start gap-2"><Zap className="w-3.5 h-3.5 text-yellow-400 mt-0.5 flex-shrink-0" /><span>No lock-up period — unstake whenever you want</span></div>
          <div className="flex items-start gap-2"><Zap className="w-3.5 h-3.5 text-yellow-400 mt-0.5 flex-shrink-0" /><span>APR fluctuates with trading volume</span></div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// MAIN PAGE
// ============================================
const TABS = [
  { id: 'info', label: 'Info', icon: Info },
  { id: 'trade', label: 'Trade', icon: ArrowUpDown },
  { id: 'thread', label: 'Thread', icon: MessageSquare },
  { id: 'txns', label: 'Txns', icon: List },
  { id: 'stake', label: 'Stake', icon: Lock },
] as const

type TabId = typeof TABS[number]['id']

export default function CoinPage() {
  const params = useParams()
  const slug = params.slug as string
  const [activeTab, setActiveTab] = useState<TabId>('info')
  const [trades, setTrades] = useState(MOCK_TOKEN.trades)

  const token = {
    ...MOCK_TOKEN,
    name: slug?.split('-')[0]?.charAt(0).toUpperCase() + slug?.split('-')[0]?.slice(1) || MOCK_TOKEN.name,
    symbol: slug?.split('-')[1]?.toUpperCase() || MOCK_TOKEN.symbol,
  }

  // Simulate live trades
  useEffect(() => {
    const iv = setInterval(() => {
      const newTrade = {
        type: Math.random() > 0.5 ? 'buy' as const : 'sell' as const,
        address: `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}`,
        suiAmount: parseFloat((Math.random() * 12).toFixed(2)),
        tokenAmount: Math.floor(Math.random() * 3000),
        price: token.currentPrice + (Math.random() - 0.5) * 0.0001,
        time: 'Just now',
      }
      setTrades(prev => [newTrade, ...prev.slice(0, 14)] as typeof MOCK_TOKEN.trades)
    }, 5000)
    return () => clearInterval(iv)
  }, [])

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
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-green-500 flex items-center justify-center text-white text-xl font-bold border-2 border-purple-500/30 overflow-hidden">
                {token.logo ? <img src={token.logo} alt={token.name} className="w-full h-full object-cover" /> : token.symbol.slice(0, 2)}
              </div>
              <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-purple-500 to-green-500 blur opacity-30 -z-10" />
            </div>

            {/* Name + badges */}
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-white">{token.name}</h1>
                <span className="text-gray-500">/</span>
                <span className="text-lg font-mono text-purple-400 font-bold">{token.symbol}</span>
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
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <span className={`text-2xl font-bold ${priceUp ? 'text-green-400' : 'text-red-400'}`}>
                  {token.currentPrice.toFixed(6)} SUI
                </span>
                <span className={`flex items-center gap-1 text-sm font-semibold px-2 py-0.5 rounded-full ${priceUp ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                  {priceUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {priceUp ? '+' : ''}{token.priceChange24h}%
                </span>
              </div>
            </div>

            {/* Socials */}
            <div className="flex items-center gap-2">
              <a href={token.twitter} target="_blank" rel="noopener noreferrer"
                className="p-2 bg-[#14142a] hover:bg-blue-500/10 border border-gray-800/60 hover:border-blue-500/30 rounded-lg transition-all">
                <Twitter className="w-4 h-4 text-gray-400 hover:text-blue-400" />
              </a>
              <a href={token.telegram} target="_blank" rel="noopener noreferrer"
                className="p-2 bg-[#14142a] hover:bg-cyan-500/10 border border-gray-800/60 hover:border-cyan-500/30 rounded-lg transition-all">
                <MessageCircle className="w-4 h-4 text-gray-400 hover:text-cyan-400" />
              </a>
              <a href={token.website} target="_blank" rel="noopener noreferrer"
                className="p-2 bg-[#14142a] hover:bg-purple-500/10 border border-gray-800/60 hover:border-purple-500/30 rounded-lg transition-all">
                <Globe className="w-4 h-4 text-gray-400 hover:text-purple-400" />
              </a>
            </div>
          </div>
        </div>

        {/* ======================================= */}
        {/* STATS PILLS ROW */}
        {/* ======================================= */}
        <div className="flex flex-wrap gap-3 py-4 border-b border-gray-800/40">
          {[
            { label: 'Mkt Cap', value: `$${(token.marketCap / 1000).toFixed(1)}K`, color: 'text-purple-400' },
            { label: 'Volume 24h', value: `${(token.volume24h / 1000).toFixed(1)}K SUI`, color: 'text-blue-400' },
            { label: 'Holders', value: token.holders.toLocaleString(), color: 'text-cyan-400' },
            { label: 'SUI Rewards', value: `${token.suiRewards} SUI`, color: 'text-green-400' },
            { label: 'Bonding', value: `${token.progress}%`, color: 'text-pink-400' },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2 bg-[#0f0f17] border border-gray-800/50 rounded-lg px-3 py-2">
              <span className="text-xs text-gray-500">{s.label}</span>
              <span className={`text-sm font-bold ${s.color}`}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* ======================================= */}
        {/* MAIN CONTENT: 2 columns */}
        {/* ======================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-6">

          {/* LEFT: Chart + Tabs */}
          <div className="lg:col-span-2 space-y-5">
            {/* Price Chart */}
            <PriceChart symbol={`${token.symbol}/SUI`} />

            {/* TAB NAVIGATION */}
            <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 overflow-hidden">
              {/* Tab bar */}
              <div className="flex border-b border-gray-800/50 bg-[#0a0a14]">
                {TABS.map((tab) => {
                  const Icon = tab.icon
                  const isActive = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold transition-all border-b-2 ${
                        isActive
                          ? 'border-purple-500 text-purple-400 bg-purple-500/5'
                          : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-white/3'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Tab content */}
              <div className="p-5">
                {activeTab === 'info' && <InfoTab token={token} />}
                {activeTab === 'trade' && <TradeTab token={token} />}
                {activeTab === 'thread' && <ThreadTab />}
                {activeTab === 'txns' && <TxnsTab trades={trades} />}
                {activeTab === 'stake' && <StakeTab token={token} />}
              </div>
            </div>
          </div>

          {/* RIGHT: Sticky Buy/Sell Panel */}
          <div className="lg:col-span-1">
            <div className="sticky top-20 space-y-4">
              {/* Quick Trade */}
              <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-5">
                <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" /> Quick Trade
                </h3>
                <TradeTab token={token} />
              </div>

              {/* Bonding Progress mini */}
              <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 font-medium">Bonding Curve</span>
                  <span className="text-sm font-bold text-purple-400">{token.progress}%</span>
                </div>
                <div className="h-2.5 bg-[#14142a] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-600 via-pink-500 to-green-400 rounded-full transition-all"
                    style={{ width: `${token.progress}%` }}
                  />
                </div>
                <p className="text-[11px] text-gray-600 mt-2">
                  {((100 - token.progress) * 5).toFixed(0)} SUI until DEX migration
                </p>
              </div>

              {/* Recent Trades mini */}
              <div className="bg-[#0f0f17] rounded-xl border border-gray-800/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Live Trades</h4>
                  <span className="flex items-center gap-1 text-[10px] text-green-400">
                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full pulse-dot" /> Live
                  </span>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {trades.slice(0, 8).map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-gray-800/30 last:border-0">
                      <span className={`font-semibold ${t.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                        {t.type === 'buy' ? '▲ Buy' : '▼ Sell'}
                      </span>
                      <span className="text-gray-400">{t.suiAmount.toFixed(2)} SUI</span>
                      <span className="text-gray-600">{t.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
