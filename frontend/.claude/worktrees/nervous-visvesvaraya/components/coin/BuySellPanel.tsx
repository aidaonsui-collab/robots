'use client'

import { useState, useEffect } from 'react'
import { useCurrentWallet } from '@mysten/dapp-kit'
import { ArrowUpDown, Settings, Wallet, Loader2 } from 'lucide-react'
import { Transaction } from '@mysten/sui/transactions'
import { ODYSSEY_CONTRACT, QUOTE_COIN, CURVE_CONFIG } from '@/lib/contracts'

interface BuySellPanelProps {
  token: {
    name: string
    symbol: string
    address: string      // pool object ID
    tokenType?: string   // full type: "0x{pkg}::{mod}::{SYM}"
    currentPrice?: number
    bondingProgress?: number
  }
}


const BPS = 10000n
const SLIPPAGE_BPS = 200n

export default function BuySellPanel({ token }: BuySellPanelProps) {
  const { isConnected: connected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts?.[0]?.address
  const [mode, setMode]         = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount]     = useState('')
  const [slippage, setSlippage] = useState(2)
  const [status, setStatus]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [suiBalance, setSuiBalance]     = useState(0)
  const [tokenBalance, setTokenBalance] = useState(0)
  const [tokenCoinIds, setTokenCoinIds] = useState<string[]>([])

  const tokenPrice = token.currentPrice || 0.000045
  const poolId     = token.address
  const tokenType  = token.tokenType

  // ── Fetch wallet balances ─────────────────────────────────────────────────
  useEffect(() => {
    if (!connected || !address) return

    const RPC = 'https://fullnode.mainnet.sui.io:443'

    // SUI balance
    fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_getBalance',
        params: [{ owner: address, coinType: '0x2::sui::SUI' }]
      })
    })
      .then(r => r.json())
      .then(d => {
        if (d.result) setSuiBalance(parseInt(d.result.totalBalance) / 1e9)
      })
      .catch(() => {})

    // Token balance
    if (tokenType) {
      fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getCoins',
          params: [{ owner: address, coinType: tokenType }]
        })
      })
        .then(r => r.json())
        .then(d => {
          if (d.result) {
            const ids = d.result.data.map((c: any) => c.coinObjectId)
            setTokenCoinIds(ids)
            const total = d.result.data.reduce((s: number, c: any) => s + parseInt(c.balance), 0)
            setTokenBalance(total)
          }
        })
        .catch(() => {})
    }
  }, [connected, address, tokenType])

  const outputAmount = amount ? parseFloat(amount) * (mode === 'buy' ? (1 / tokenPrice) : tokenPrice) : 0

  // ── BUY ───────────────────────────────────────────────────────────────────
  const executeBuy = async () => {
    if (!poolId)    throw new Error('Pool ID not found — token may not be on-chain yet')
    if (!tokenType) throw new Error('Token type not found')

    const suiVal    = parseFloat(amount)
    const amtMist   = BigInt(Math.floor(suiVal * 1e9))
    const estOut    = BigInt(Math.floor(suiVal / tokenPrice))
    const minOut    = estOut * (BPS - BigInt(slippage * 100)) / BPS

    const tx = new Transaction()
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(amtMist)])

    const [memeCoins] = tx.moveCall({
      target: `${ODYSSEY_CONTRACT.packageId}::${ODYSSEY_CONTRACT.module}::buy`,
      typeArguments: [tokenType, QUOTE_COIN],
      arguments: [
        tx.object(poolId),
        payment,
        tx.pure.u64(minOut),
      ],
    })

    // Required — returned coin must be transferred to buyer
    tx.transferObjects([memeCoins], tx.pure.address(address!))

    return (currentWallet as any)?.features?.['sui:signAndExecuteTransactionBlock']?.signAndExecuteTransactionBlock({
      transactionBlock: tx as any,
      options: { showEffects: true },
    })
  }

  // ── SELL ──────────────────────────────────────────────────────────────────
  const executeSell = async () => {
    if (!poolId)              throw new Error('Pool ID not found')
    if (!tokenType)           throw new Error('Token type not found')
    if (!tokenCoinIds.length) throw new Error('No token coins in wallet')

    const sellAmt    = BigInt(Math.floor(parseFloat(amount)))
    const estSui     = BigInt(Math.floor(parseFloat(amount) * tokenPrice * 1e9))
    const minQuote   = estSui * (BPS - BigInt(slippage * 100)) / BPS

    const tx = new Transaction()

    let tokenCoin
    if (tokenCoinIds.length === 1) {
      tokenCoin = tx.object(tokenCoinIds[0])
    } else {
      const primary = tx.object(tokenCoinIds[0])
      const rest    = tokenCoinIds.slice(1).map(id => tx.object(id))
      tx.mergeCoins(primary, rest)
      const [split] = tx.splitCoins(primary, [tx.pure.u64(sellAmt)])
      tokenCoin = split
    }

    const [suiCoins] = tx.moveCall({
      target: `${ODYSSEY_CONTRACT.packageId}::${ODYSSEY_CONTRACT.module}::sell`,
      typeArguments: [tokenType, QUOTE_COIN],
      arguments: [
        tx.object(poolId),
        tokenCoin,
        tx.pure.u64(minQuote),
      ],
    })

    // Required — returned SUI must be transferred to seller
    tx.transferObjects([suiCoins], tx.pure.address(address!))

    return (currentWallet as any)?.features?.['sui:signAndExecuteTransactionBlock']?.signAndExecuteTransactionBlock({
      transactionBlock: tx as any,
      options: { showEffects: true },
    })
  }

  const handleTrade = async () => {
    if (!connected) { setStatus('Please connect your wallet'); return }
    if (!amount || parseFloat(amount) <= 0) { setStatus('Enter an amount'); return }

    setLoading(true)
    setStatus('Waiting for wallet approval...')

    try {
      const result = mode === 'buy' ? await executeBuy() : await executeSell()

      if (result?.effects?.status?.status === 'success') {
        setStatus(`✅ ${mode === 'buy' ? 'Bought' : 'Sold'}! Tx: ${result.digest.slice(0, 10)}...`)
        setAmount('')
        // Refresh balances
        setTimeout(() => {
          if (address) {
            fetch('https://fullnode.mainnet.sui.io:443', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'suix_getBalance',
                params: [{ owner: address, coinType: '0x2::sui::SUI' }]
              })
            })
              .then(r => r.json())
              .then(d => {
                if (d.result) setSuiBalance(parseInt(d.result.totalBalance) / 1e9)
              })
          }
        }, 2000)
      } else {
        setStatus(`⚠️ Tx: ${result?.digest?.slice(0, 10)}...`)
      }
    } catch (e: any) {
      console.error('Trade error:', e)
      setStatus(`❌ ${(e?.message || 'Trade failed').slice(0, 80)}`)
    }

    setLoading(false)
  }

  const isOnChain = !!(poolId && tokenType && !poolId.startsWith('0x1') && poolId.length > 10)

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h3 className="text-lg font-bold mb-4">Trade {token.symbol}</h3>

      {!isOnChain && (
        <div className="mb-4 p-3 rounded-lg bg-yellow-900/30 border border-yellow-500/40 text-yellow-400 text-xs">
          ⚠️ Token not yet on-chain. Complete pool creation to enable trading.
        </div>
      )}

      {/* Buy/Sell Tabs */}
      <div className="flex gap-2 mb-6">
        {(['buy', 'sell'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-3 rounded-lg font-semibold transition-all ${
              mode === m
                ? m === 'buy' ? 'bg-green-500 text-white shadow-lg shadow-green-500/25'
                              : 'bg-red-500 text-white shadow-lg shadow-red-500/25'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="mb-2">
        <label className="text-sm text-muted-foreground mb-2 block">
          {mode === 'buy' ? 'You pay (SUI)' : `You sell (${token.symbol})`}
        </label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-secondary border border-border rounded-xl py-4 px-4 text-xl font-semibold pr-16 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
            {mode === 'buy' ? 'SUI' : token.symbol}
          </span>
        </div>
      </div>

      {/* Balance */}
      {connected && (
        <div className="text-xs text-muted-foreground mb-4 flex items-center gap-1">
          <Wallet className="w-3 h-3" />
          Balance: {mode === 'buy'
            ? `${suiBalance.toFixed(3)} SUI`
            : `${tokenBalance.toLocaleString()} ${token.symbol}`}
        </div>
      )}

      {/* Swap Icon */}
      <div className="flex justify-center -my-2 relative z-10">
        <div className="bg-card border border-border p-2 rounded-full">
          <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>

      {/* Output */}
      <div className="mb-4">
        <label className="text-sm text-muted-foreground mb-2 block">
          {mode === 'buy' ? 'You receive (est.)' : 'You get (SUI, est.)'}
        </label>
        <div className="bg-secondary/50 border border-border rounded-xl py-4 px-4 text-xl font-semibold text-purple-400">
          {outputAmount > 0 ? outputAmount.toFixed(mode === 'buy' ? 0 : 6) : '0'}
          {' '}{mode === 'buy' ? token.symbol : 'SUI'}
        </div>
      </div>

      {/* Slippage */}
      <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
        <span>Slippage</span>
        <div className="flex items-center gap-2">
          {[1, 2, 5].map(s => (
            <button
              key={s}
              onClick={() => setSlippage(s)}
              className={`px-3 py-1 rounded-lg transition-colors ${
                slippage === s ? 'bg-purple-500/20 text-purple-400' : 'bg-secondary hover:bg-secondary/80'
              }`}
            >
              {s}%
            </button>
          ))}
        </div>
      </div>

      {/* Fee info */}
      <div className="flex justify-between text-sm mb-6 text-muted-foreground">
        <span>Trading Fee</span>
        <span>2% (45% admin · 25% creator · 30% stakers)</span>
      </div>

      {/* Status */}
      {status && (
        <div className={`mb-4 p-2 rounded-lg text-xs text-center ${
          status.startsWith('✅') ? 'bg-green-900/40 text-green-400 border border-green-500/30' :
          status.startsWith('❌') ? 'bg-red-900/40 text-red-400 border border-red-500/30' :
          'bg-purple-900/40 text-purple-300 border border-purple-500/30'
        }`}>
          {status}
        </div>
      )}

      {/* Action Button */}
      <button
        onClick={handleTrade}
        disabled={!amount || parseFloat(amount) <= 0 || loading || !isOnChain}
        className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${
          mode === 'buy'
            ? 'bg-green-500 hover:bg-green-600 shadow-lg shadow-green-500/25'
            : 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/25'
        } disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
      >
        {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Processing...</> :
         !connected ? 'Connect Wallet' :
         !isOnChain ? 'Not Yet On-Chain' :
         `${mode === 'buy' ? 'Buy' : 'Sell'} ${token.symbol}`}
      </button>
    </div>
  )
}
