'use client'

import { TrendingUp, TrendingDown } from 'lucide-react'

interface Trade {
  type: 'buy' | 'sell'
  address: string
  suiAmount: number
  tokenAmount: number
  price: number
  time: string
}

interface TradeRowProps {
  trade: Trade
  pairType?: 'SUI' | 'AIDA'
}

function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

export default function TradeRow({ trade, pairType = 'SUI' }: TradeRowProps) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/50 last:border-0 hover:bg-white/5 px-2 -mx-2 rounded-lg transition-colors">
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center ${
            trade.type === 'buy' ? 'bg-green-500/20' : 'bg-red-500/20'
          }`}
        >
          {trade.type === 'buy' ? (
            <TrendingUp className="w-4 h-4 text-green-400" />
          ) : (
            <TrendingDown className="w-4 h-4 text-red-400" />
          )}
        </div>
        <div>
          <p className="font-medium capitalize">{trade.type}</p>
          <p className="text-xs text-muted-foreground">
            {shortenAddress(trade.address)}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-semibold">{trade.suiAmount.toFixed(2)} {pairType}</p>
        <p className="text-xs text-muted-foreground">
          {trade.tokenAmount.toFixed(2)} tokens
        </p>
      </div>
      <div className="text-right">
        <p className="font-semibold">@{trade.price.toFixed(6)}</p>
        <p className="text-xs text-muted-foreground">{trade.time}</p>
      </div>
    </div>
  )
}

// Header component for the table
export function TradeTableHeader() {
  return (
    <div className="flex items-center justify-between py-2 text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
      <span>Type</span>
      <span>Amount</span>
      <span>Price</span>
    </div>
  )
}
