'use client'

import { useState } from 'react'
import { TrendingUp, TrendingDown, Users, Coins, Trophy, DollarSign, Activity } from 'lucide-react'
import { formatNumber, formatSui } from '@/lib/utils'

// Mock data
const topTraders = [
  { rank: 1, address: '0x742d...3a8f', volume: 245000, pnl: 12500, trades: 156 },
  { rank: 2, address: '0x1a2b...9c0d', volume: 189000, pnl: 8900, trades: 98 },
  { rank: 3, address: '0x9f3c...7b2e', volume: 156000, pnl: 7200, trades: 87 },
  { rank: 4, address: '0x5e8a...1d4f', volume: 134000, pnl: 5600, trades: 76 },
  { rank: 5, address: '0x3c7d...8e9f', volume: 98000, pnl: 4200, trades: 54 },
]

const topCoins = [
  { rank: 1, name: 'Doge AI', symbol: 'DAI', volume: 4500000, marketCap: 89000000, change: 12.5 },
  { rank: 2, name: 'Moon Sui', symbol: 'MSUI', volume: 3200000, marketCap: 67000000, change: 8.3 },
  { rank: 3, name: 'Pearl', symbol: 'PRL', volume: 2100000, marketCap: 45000000, change: -3.2 },
  { rank: 4, name: 'Sui Pepe', symbol: 'SPEP', volume: 1800000, marketCap: 38000000, change: 15.7 },
  { rank: 5, name: 'Wojak Sui', symbol: 'WOJAK', volume: 1200000, marketCap: 28000000, change: -1.8 },
]

const recentBigTrades = [
  { type: 'buy', address: '0x7d2e...f1a3', amount: 45, token: 'DAI', value: 12500, time: '2m ago' },
  { type: 'sell', address: '0x4c8b...2d9e', amount: 120, token: 'MSUI', value: 8900, time: '5m ago' },
  { type: 'buy', address: '0x9e1f...3b7c', amount: 85, token: 'PRL', value: 6200, time: '8m ago' },
  { type: 'sell', address: '0x2a5d...8c4f', amount: 200, token: 'WOJAK', value: 4500, time: '12m ago' },
  { type: 'buy', address: '0x6f9e...1d2b', amount: 55, token: 'SPEP', value: 3800, time: '15m ago' },
]

export default function StatsPage() {
  const [timeFilter, setTimeFilter] = useState<'24h' | '7d' | '30d'>('24h')

  return (
    <main className="min-h-screen pt-20 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold gradient-text mb-2">Platform Stats</h1>
          <p className="text-muted-foreground">Track top performers and trading activity</p>
        </div>

        {/* Time Filter */}
        <div className="flex gap-2 mb-8">
          {(['24h', '7d', '30d'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTimeFilter(t)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                timeFilter === t ? 'bg-purple-500 text-white' : 'bg-card border border-border text-muted-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Activity className="w-4 h-4" />
              <span className="text-sm">Total Volume</span>
            </div>
            <p className="text-2xl font-bold">$12.5M</p>
            <p className="text-sm text-green-400">+8.3%</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Coins className="w-4 h-4" />
              <span className="text-sm">Active Tokens</span>
            </div>
            <p className="text-2xl font-bold">1,247</p>
            <p className="text-sm text-green-400">+52 today</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Users className="w-4 h-4" />
              <span className="text-sm">Total Traders</span>
            </div>
            <p className="text-2xl font-bold">45,892</p>
            <p className="text-sm text-green-400">+1,234</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <DollarSign className="w-4 h-4" />
              <span className="text-sm">Fees Generated</span>
            </div>
            <p className="text-2xl font-bold">$125K</p>
            <p className="text-sm text-green-400">+15.2%</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Top Traders */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-yellow-400" />
              <h2 className="text-xl font-bold">Top Traders</h2>
            </div>
            <div className="space-y-3">
              {topTraders.map((trader) => (
                <div key={trader.rank} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                      trader.rank === 1 ? 'bg-yellow-500' : trader.rank === 2 ? 'bg-gray-400' : trader.rank === 3 ? 'bg-orange-600' : 'bg-secondary'
                    }`}>
                      {trader.rank}
                    </div>
                    <div>
                      <p className="font-medium">{trader.address}</p>
                      <p className="text-xs text-muted-foreground">{trader.trades} trades</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${formatNumber(trader.volume)}</p>
                    <p className={`text-sm ${trader.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {trader.pnl >= 0 ? '+' : ''}${formatNumber(trader.pnl)} PnL
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Coins */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-purple-400" />
              <h2 className="text-xl font-bold">Top Coins</h2>
            </div>
            <div className="space-y-3">
              {topCoins.map((coin) => (
                <div key={coin.rank} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-green-500 flex items-center justify-center font-bold">
                      {coin.rank}
                    </div>
                    <div>
                      <p className="font-medium">{coin.name}</p>
                      <p className="text-xs text-muted-foreground">${coin.symbol}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${formatNumber(coin.marketCap)}</p>
                    <p className={`text-sm ${coin.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {coin.change >= 0 ? '+' : ''}{coin.change}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Big Trades */}
          <div className="bg-card border border-border rounded-xl p-6 lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-green-400" />
              <h2 className="text-xl font-bold">Recent Big Trades</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {recentBigTrades.map((trade, i) => (
                <div key={i} className="bg-background/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {trade.type === 'buy' ? (
                      <TrendingUp className="w-4 h-4 text-green-400" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-400" />
                    )}
                    <span className={`font-medium ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                      {trade.type === 'buy' ? 'Buy' : 'Sell'}
                    </span>
                  </div>
                  <p className="text-lg font-bold">{trade.amount} {trade.token}</p>
                  <p className="text-sm text-muted-foreground">${formatNumber(trade.value)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{trade.time}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
