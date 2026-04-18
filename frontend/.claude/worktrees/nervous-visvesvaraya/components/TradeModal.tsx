'use client'

import { useState } from 'react'
import { X, ArrowUpDown, Settings, Loader2 } from 'lucide-react'
import { useCurrentWallet } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { ODYSSEY_CONTRACT, QUOTE_COIN } from '@/lib/contracts'

const SUI_RPC = 'https://fullnode.mainnet.sui.io:443'

interface TradeModalProps {
  isOpen: boolean
  onClose: () => void
  token: {
    name: string
    symbol: string
    price: number          // price in SUI per token
    address?: string       // pool object ID
    tokenType?: string     // full token type
  } | null
}


const BPS = 10000n

export default function TradeModal({ isOpen, onClose, token }: TradeModalProps) {
  const { isConnected: connected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts?.[0]?.address
  const [mode, setMode]       = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount]   = useState('')
  const [slippage, setSlippage] = useState(2)
  const [loading, setLoading] = useState(false)
  const [status, setStatus]   = useState('')

  if (!isOpen || !token) return null

  const poolId    = token.address
  const tokenType = token.tokenType
  const isOnChain = !!(poolId && tokenType && poolId.length > 10 && !poolId.startsWith('0x1'))
  const outputAmount = amount ? parseFloat(amount) * (mode === 'buy' ? 1 / token.price : token.price) : 0

  const handleTrade = async () => {
    if (!connected) { setStatus('Connect your wallet first'); return }
    if (!amount || parseFloat(amount) <= 0) { setStatus('Enter an amount'); return }

    if (!isOnChain) {
      setStatus('❌ This token is not yet on-chain. Create a pool first.')
      return
    }

    setLoading(true)
    setStatus('Building transaction...')

    try {
      const tx = new Transaction()
      const slippageBps = BigInt(slippage * 100)

      if (mode === 'buy') {
        const amtMist  = BigInt(Math.floor(parseFloat(amount) * 1e9))
        const estOut   = BigInt(Math.floor(parseFloat(amount) / token.price))
        const minOut   = estOut * (BPS - slippageBps) / BPS

        const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(amtMist)])
        const [memeCoins] = tx.moveCall({
          target: `${ODYSSEY_CONTRACT.packageId}::${ODYSSEY_CONTRACT.module}::buy`,
          typeArguments: [tokenType!, QUOTE_COIN],
          arguments: [tx.object(poolId!), payment, tx.pure.u64(minOut)],
        })
        tx.transferObjects([memeCoins], tx.pure.address(address!))

      } else {
        // Get user's token coins via RPC
        const coinsData = await fetch(SUI_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'suix_getCoins',
            params: [{ owner: address!, coinType: tokenType! }]
          })
        }).then(r => r.json())
        const coinsResp = { data: coinsData.result?.data || [] }
        if (!coinsResp.data.length) { setStatus('❌ No tokens in wallet'); setLoading(false); return }

        const sellAmt   = BigInt(Math.floor(parseFloat(amount)))
        const estSui    = BigInt(Math.floor(parseFloat(amount) * token.price * 1e9))
        const minQuote  = estSui * (BPS - slippageBps) / BPS

        let tokenCoin
        if (coinsResp.data.length === 1) {
          tokenCoin = tx.object(coinsResp.data[0].coinObjectId)
        } else {
          const primary = tx.object(coinsResp.data[0].coinObjectId)
          tx.mergeCoins(primary, coinsResp.data.slice(1).map((c: any) => tx.object(c.coinObjectId)))
          const [split] = tx.splitCoins(primary, [tx.pure.u64(sellAmt)])
          tokenCoin = split
        }

        const [suiCoins] = tx.moveCall({
          target: `${ODYSSEY_CONTRACT.packageId}::${ODYSSEY_CONTRACT.module}::sell`,
          typeArguments: [tokenType!, QUOTE_COIN],
          arguments: [tx.object(poolId!), tokenCoin, tx.pure.u64(minQuote)],
        })
        tx.transferObjects([suiCoins], tx.pure.address(address!))
      }

      setStatus('Waiting for wallet approval...')
      const result = await (currentWallet as any)?.features?.['sui:signAndExecuteTransactionBlock']?.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        options: { showEffects: true },
      })

      if (result?.effects?.status?.status === 'success') {
        setStatus(`✅ Success! ${result.digest.slice(0, 10)}...`)
        setTimeout(() => { setAmount(''); setStatus(''); onClose() }, 1500)
      } else {
        setStatus(`⚠️ Submitted: ${result?.digest?.slice(0, 10)}...`)
      }
    } catch (e: any) {
      setStatus(`❌ ${(e?.message || 'Failed').slice(0, 80)}`)
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Trade {token.name}</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        {!isOnChain && (
          <div className="mb-4 p-3 rounded-lg bg-yellow-900/30 border border-yellow-500/40 text-yellow-400 text-xs text-center">
            ⚠️ Token not yet on-chain — create_pool step needed before trading
          </div>
        )}

        {/* Buy/Sell Tabs */}
        <div className="flex gap-2 mb-6">
          {(['buy', 'sell'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                mode === m
                  ? m === 'buy' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="mb-4">
          <label className="text-sm text-muted-foreground mb-2 block">
            {mode === 'buy' ? 'You pay (SUI)' : `You sell (${token.symbol})`}
          </label>
          <div className="relative">
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-secondary border border-border rounded-xl py-4 px-4 text-xl font-semibold pr-20 focus:outline-none focus:ring-2 focus:ring-purple-500" />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground">
              {mode === 'buy' ? 'SUI' : token.symbol}
            </span>
          </div>
        </div>

        <div className="flex justify-center -my-2 relative z-10">
          <div className="bg-card border border-border p-2 rounded-full">
            <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>

        {/* Output */}
        <div className="mb-6">
          <label className="text-sm text-muted-foreground mb-2 block">
            {mode === 'buy' ? 'You receive (est.)' : 'You get back SUI (est.)'}
          </label>
          <div className="bg-secondary/50 border border-border rounded-xl py-4 px-4 text-xl font-semibold text-purple-400">
            {outputAmount > 0 ? outputAmount.toFixed(mode === 'buy' ? 0 : 6) : '0'} {mode === 'buy' ? token.symbol : 'SUI'}
          </div>
        </div>

        {/* Slippage */}
        <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
          <span>Slippage</span>
          <div className="flex items-center gap-2">
            {[1, 2, 5].map(s => (
              <button key={s} onClick={() => setSlippage(s)}
                className={`px-3 py-1 rounded-lg transition-colors ${slippage === s ? 'bg-purple-500/20 text-purple-400' : 'bg-secondary'}`}>
                {s}%
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-between text-sm mb-6 text-muted-foreground">
          <span>Fee</span><span>2% (25% → creator · 30% → AIDA stakers)</span>
        </div>

        {/* Status */}
        {status && (
          <div className={`mb-4 p-2 rounded-lg text-xs text-center border ${
            status.startsWith('✅') ? 'bg-green-900/40 text-green-400 border-green-500/30' :
            status.startsWith('❌') ? 'bg-red-900/40 text-red-400 border-red-500/30' :
            'bg-purple-900/40 text-purple-300 border-purple-500/30'
          }`}>{status}</div>
        )}

        <button onClick={handleTrade}
          disabled={!amount || parseFloat(amount) <= 0 || loading || !isOnChain}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-2 ${
            mode === 'buy' ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-red-500 hover:bg-red-600 text-white'
          } disabled:opacity-50 disabled:cursor-not-allowed`}>
          {loading ? <><Loader2 className="w-5 h-5 animate-spin" />Processing...</> :
           !connected ? 'Connect Wallet' :
           !isOnChain ? 'Not On-Chain' :
           `${mode === 'buy' ? 'Buy' : 'Sell'} ${token.symbol}`}
        </button>
      </div>
    </div>
  )
}
