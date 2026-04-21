'use client'

import { useEffect, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import Link from 'next/link'
import { Search, Clock, Check, AlertCircle, ArrowRight, Loader2 } from 'lucide-react'
import {
  fetchAllGifts,
  timeUntil,
  formatAmount,
  canonicaliseRecipient,
  recipientMatches,
  GiftEvent,
} from '@/lib/culture'
import { useGiftTokenMeta } from './useGiftTokenMeta'

/**
 * Claim search: recipient types their X handle or .sui name, we filter the
 * public gift list, and link each unclaimed match to the standard claim
 * page at /airdrops/claim/<giftId> (which handles the X-OAuth verify step).
 */
export default function ClaimSearch() {
  const suiClient = useSuiClient()
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allGifts, setAllGifts] = useState<GiftEvent[]>([])

  useEffect(() => {
    if (!submitted) return
    setLoading(true); setError(null)
    fetchAllGifts(suiClient)
      .then(setAllGifts)
      .catch(e => setError(e?.message || 'Failed to load gifts'))
      .finally(() => setLoading(false))
  }, [submitted, suiClient])

  const resolveMeta = useGiftTokenMeta(allGifts)

  const canon = submitted ? canonicaliseRecipient(submitted) : null
  const matches = canon
    ? allGifts
        .filter(g => recipientMatches(g.recipientHandle, canon))
        .sort((a, b) => (a.claimed ? 1 : 0) - (b.claimed ? 1 : 0) || b.timestampMs - a.timestampMs)
    : []
  const pending = matches.filter(g => !g.claimed && !g.isExpired)
  const claimed = matches.filter(g => g.claimed)
  const expired = matches.filter(g => !g.claimed && g.isExpired)

  return (
    <div className="card-lift bg-[#0d0f1a]/80 backdrop-blur-md border border-white/[0.06] rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/15 flex items-center justify-center">
          <Search className="w-4 h-4 text-[#D4AF37]" />
        </div>
        <div>
          <h3 className="text-white font-semibold text-sm">Claim an Airdrop</h3>
          <p className="text-gray-500 text-xs">Search by your X handle or .sui name to see gifts waiting for you.</p>
        </div>
      </div>

      <form
        onSubmit={e => { e.preventDefault(); setSubmitted(query.trim()) }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="@handle, x.com/handle, or name.sui"
          className="flex-1 px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40"
        />
        <button
          type="submit"
          disabled={!query.trim() || loading}
          className="px-4 py-2.5 rounded-xl bg-[#D4AF37] text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
        </button>
      </form>

      {error && (
        <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">{error}</div>
      )}

      {submitted && !loading && matches.length === 0 && !error && (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-400">No airdrops found for <span className="text-white">{canon?.kind === 'sui' ? canon.value : `@${canon?.value}`}</span></p>
          <p className="text-[11px] text-gray-600 mt-1">Ask the sender to check the handle they used, or try a different capitalisation.</p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-wide">Pending — action required</p>
          {pending.map(g => <ClaimRow key={g.giftId} gift={g} meta={resolveMeta(g)} />)}
        </div>
      )}
      {claimed.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Already claimed</p>
          {claimed.map(g => <ClaimRow key={g.giftId} gift={g} meta={resolveMeta(g)} />)}
        </div>
      )}
      {expired.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Expired (refunded to sender)</p>
          {expired.map(g => <ClaimRow key={g.giftId} gift={g} meta={resolveMeta(g)} />)}
        </div>
      )}
    </div>
  )
}

function ClaimRow({ gift, meta }: { gift: GiftEvent; meta: { decimals: number; label: string } }) {
  const { decimals, label } = meta
  const statusIcon = gift.claimed
    ? <Check className="w-3 h-3" />
    : gift.isExpired
      ? <AlertCircle className="w-3 h-3" />
      : <Clock className="w-3 h-3" />
  const statusText = gift.claimed ? 'Claimed' : gift.isExpired ? 'Expired' : timeUntil(gift.expiresAt)
  const statusClass = gift.claimed
    ? 'bg-emerald-500/15 text-emerald-400'
    : gift.isExpired
      ? 'bg-red-500/15 text-red-400'
      : 'bg-[#D4AF37]/15 text-[#D4AF37]'

  return (
    <div className="p-3 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-white">
            {formatAmount(gift.amount, decimals)} <span className="text-gray-500 text-xs">{label}</span>
          </p>
          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${statusClass}`}>
            {statusIcon} {statusText}
          </span>
        </div>
        {gift.message && (
          <p className="text-[11px] text-gray-600 mt-1 italic truncate">"{gift.message}"</p>
        )}
      </div>
      {!gift.claimed && !gift.isExpired && (
        <Link
          href={`/airdrops/claim/${gift.giftId}`}
          className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#D4AF37] text-black text-xs font-bold hover:opacity-90 transition-opacity"
        >
          Claim <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  )
}
