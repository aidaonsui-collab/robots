'use client'

import { useState } from 'react'
import { Transaction } from '@mysten/sui/transactions'
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit'
import { Gift, Loader2, ExternalLink } from 'lucide-react'
import {
  CULTURE_LATEST_PKG,
  CULTURE_CONFIG_ID,
  CULTURE_TOKENS,
  SUI_CLOCK,
  SUI_COIN_TYPE,
  normaliseXHandle,
} from '@/lib/culture'

export default function SendForm() {
  const account = useCurrentAccount()
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [tokenSymbol, setTokenSymbol] = useState('SUI')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successDigest, setSuccessDigest] = useState<string | null>(null)

  const token = CULTURE_TOKENS.find(t => t.symbol === tokenSymbol) ?? CULTURE_TOKENS[0]

  const handleSend = async () => {
    if (!account?.address) { setError('Connect wallet first'); return }
    if (!CULTURE_CONFIG_ID) { setError('Culture tab not configured — ask an admin to set NEXT_PUBLIC_CULTURE_CONFIG_ID'); return }
    const normalisedHandle = normaliseXHandle(recipient)
    if (!normalisedHandle) { setError('Enter a valid X handle'); return }
    const amtFloat = parseFloat(amount)
    if (!isFinite(amtFloat) || amtFloat <= 0) { setError('Enter an amount'); return }

    setSending(true); setError(null); setSuccessDigest(null)
    try {
      const amountRaw = BigInt(Math.floor(amtFloat * Math.pow(10, token.decimals)))

      const tx = new Transaction()
      tx.setGasBudget(50_000_000)

      let coinArg
      if (token.type === SUI_COIN_TYPE) {
        const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(amountRaw)])
        coinArg = c
      } else {
        // Fetch existing coins of this type from the sender, merge, then split
        const { data: coins } = await suiClient.getCoins({ owner: account.address, coinType: token.type })
        if (!coins.length) throw new Error(`No ${token.symbol} in wallet`)
        const base = tx.object(coins[0].coinObjectId)
        if (coins.length > 1) {
          tx.mergeCoins(base, coins.slice(1).map(c => tx.object(c.coinObjectId)))
        }
        const [c] = tx.splitCoins(base, [tx.pure.u64(amountRaw)])
        coinArg = c
      }

      tx.moveCall({
        target: `${CULTURE_LATEST_PKG}::culture_fund::deposit`,
        typeArguments: [token.type],
        arguments: [
          tx.object(CULTURE_CONFIG_ID),
          tx.object(SUI_CLOCK),
          tx.pure.string(normalisedHandle),
          tx.pure.string(token.symbol),
          tx.pure.string(message.slice(0, 280)),
          coinArg,
        ],
      })

      const result = await signAndExecute({ transaction: tx })
      // Wait for finality so the "Recent sent" list reflects the new gift
      await suiClient.waitForTransaction({ digest: result.digest, options: { showEffects: true } })
      setSuccessDigest(result.digest)
      setRecipient(''); setAmount(''); setMessage('')
    } catch (e: any) {
      setError(e?.message || 'Failed to send gift')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="card-lift bg-[#0d0f1a]/80 backdrop-blur-md border border-white/[0.06] rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/15 flex items-center justify-center">
          <Gift className="w-4 h-4 text-[#D4AF37]" />
        </div>
        <div>
          <h3 className="text-white font-semibold text-sm">Send an Airdrop</h3>
          <p className="text-gray-500 text-xs">Gift tokens to any X handle. Recipient claims in 48h or you get a refund.</p>
        </div>
      </div>

      <div>
        <label className="block text-gray-400 text-xs font-medium mb-1.5">Recipient X handle</label>
        <input
          value={recipient}
          onChange={e => setRecipient(e.target.value)}
          placeholder="@handle or https://x.com/handle"
          className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40"
        />
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label className="block text-gray-400 text-xs font-medium mb-1.5">Amount</label>
          <input
            type="number"
            step="any"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40"
          />
        </div>
        <div>
          <label className="block text-gray-400 text-xs font-medium mb-1.5">Token</label>
          <select
            value={tokenSymbol}
            onChange={e => setTokenSymbol(e.target.value)}
            className="px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40"
          >
            {CULTURE_TOKENS.map(t => <option key={t.symbol} value={t.symbol}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-gray-400 text-xs font-medium mb-1.5">Message <span className="text-gray-600">(optional, ≤280 chars)</span></label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value.slice(0, 280))}
          placeholder="gm, enjoy…"
          rows={2}
          className="w-full px-3 py-2 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 resize-none focus:outline-none focus:border-[#D4AF37]/40"
        />
      </div>

      <div className="text-[11px] text-gray-500 space-y-0.5">
        <div>• 2% platform fee taken at claim time</div>
        <div>• 48h claim window — unclaimed gifts refund to you</div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">{error}</div>
      )}
      {successDigest && (
        <div className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center justify-between gap-2">
          <span>Gift sent. The recipient has 48h to claim.</span>
          <a
            href={`https://suivision.xyz/txblock/${successDigest}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline hover:no-underline"
          >
            view <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={sending || !account?.address || !CULTURE_CONFIG_ID}
        className="w-full py-3 rounded-xl bg-[#D4AF37] text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : account?.address ? 'Send Gift' : 'Connect Wallet'}
      </button>
    </div>
  )
}
