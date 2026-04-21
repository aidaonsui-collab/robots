'use client'

import { useEffect, useState } from 'react'
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit'
import { ExternalLink, Clock, Check, AlertCircle } from 'lucide-react'
import {
  fetchAllGifts,
  timeUntil,
  shortenAddr,
  tokenConfigFor,
  formatAmount,
  GiftEvent,
} from '@/lib/culture'

type Filter = 'sent' | 'received'

export default function GiftsDashboard() {
  const account = useCurrentAccount()
  const suiClient = useSuiClient()
  const [filter, setFilter] = useState<Filter>('sent')
  const [gifts, setGifts] = useState<GiftEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!account?.address) return
    setLoading(true)
    fetchAllGifts(suiClient)
      .then(setGifts)
      .catch(() => setGifts([]))
      .finally(() => setLoading(false))
  }, [account?.address, suiClient])

  const mine = gifts.filter(g =>
    filter === 'sent'
      ? g.depositor.toLowerCase() === account?.address?.toLowerCase()
      : false // "received" requires an X handle to match against — user doesn't have one bound here; that view lives on the claim page for now
  )

  if (!account?.address) {
    return (
      <div className="bg-[#0d0f1a]/60 border border-white/[0.06] rounded-2xl p-6 text-center">
        <p className="text-gray-500 text-sm">Connect your wallet to see your airdrops.</p>
      </div>
    )
  }

  return (
    <div className="bg-[#0d0f1a]/60 border border-white/[0.06] rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-white font-semibold text-sm">Your Airdrops</h3>
        <div className="flex items-center gap-1 p-0.5 bg-[#07070e] border border-white/[0.06] rounded-lg">
          {(['sent'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors ${
                filter === f ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
      ) : mine.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-gray-400">No airdrops yet</p>
          <p className="text-[11px] text-gray-600 mt-1">Gifts you send will appear here with their claim status.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {mine.map(g => {
            const cfg = tokenConfigFor(g.tokenType)
            const decimals = cfg?.decimals ?? 9
            const label = cfg?.label ?? g.tokenSymbol
            return (
              <div key={g.giftId} className="p-3 rounded-xl bg-black/30 border border-white/5 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-white">
                      {formatAmount(g.amount, decimals)} <span className="text-gray-500 text-xs">{label}</span>
                    </p>
                    {g.claimed
                      ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400"><Check className="w-3 h-3" /> Claimed</span>
                      : g.isExpired
                        ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400"><AlertCircle className="w-3 h-3" /> Expired</span>
                        : <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#D4AF37]/15 text-[#D4AF37]"><Clock className="w-3 h-3" /> {timeUntil(g.expiresAt)}</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    to <span className="text-gray-300">@{g.recipientHandle}</span>
                    {g.message && <span className="text-gray-600"> · "{g.message.slice(0, 80)}"</span>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <a
                    href={`/airdrops/claim/${g.giftId}`}
                    className="text-[11px] text-[#D4AF37] hover:underline inline-flex items-center gap-0.5"
                  >
                    claim link <ExternalLink className="w-3 h-3" />
                  </a>
                  <span className="text-[10px] text-gray-600">by {shortenAddr(g.depositor)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
