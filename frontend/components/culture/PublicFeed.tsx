'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import Link from 'next/link'
import { Check, Clock, AlertCircle, ExternalLink } from 'lucide-react'
import {
  fetchAllGifts,
  timeUntil,
  formatAmount,
  detectRecipientKind,
  normaliseXHandle,
  GiftEvent,
} from '@/lib/culture'
import { useCultureRefresh } from '@/lib/cultureBus'
import { useGiftTokenMeta } from './useGiftTokenMeta'

function formatDate(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function RecipientCell({ handle }: { handle: string }) {
  const kind = detectRecipientKind(handle)
  if (kind === 'sui') return <span className="text-cyan-300">{handle}</span>
  return <span className="text-gray-200">@{normaliseXHandle(handle)}</span>
}

function StatusCell({ gift }: { gift: GiftEvent }) {
  if (gift.claimed) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
        <Check className="w-3 h-3" /> Claimed
      </span>
    )
  }
  if (gift.isExpired) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
        <AlertCircle className="w-3 h-3" /> Expired
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#D4AF37]/15 text-[#D4AF37]">
      <Clock className="w-3 h-3" /> {timeUntil(gift.expiresAt)}
    </span>
  )
}

export default function PublicFeed() {
  const suiClient = useSuiClient()
  const [gifts, setGifts] = useState<GiftEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'claimed'>('all')

  const reload = useCallback(() => {
    setLoading(true)
    fetchAllGifts(suiClient)
      .then(setGifts)
      .catch(() => setGifts([]))
      .finally(() => setLoading(false))
  }, [suiClient])

  useEffect(() => { reload() }, [reload])
  useCultureRefresh(reload)

  const resolveMeta = useGiftTokenMeta(gifts)

  const visible = gifts.filter(g =>
    filter === 'pending' ? !g.claimed && !g.isExpired
    : filter === 'claimed' ? g.claimed
    : true
  )

  const totalSent = gifts.length
  const totalClaimed = gifts.filter(g => g.claimed).length

  return (
    <div className="bg-[#0d0f1a]/60 border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-5 pb-3">
        <div>
          <h3 className="text-white font-semibold text-sm">Recent Airdrops</h3>
          <p className="text-[11px] text-gray-600 mt-0.5">
            {loading ? 'Loading…' : `${totalSent} sent · ${totalClaimed} claimed`}
          </p>
        </div>
        <div className="flex items-center gap-1 p-0.5 bg-[#07070e] border border-white/[0.06] rounded-lg">
          {(['all', 'pending', 'claimed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-colors ${
                filter === f ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] text-gray-500 uppercase tracking-wider border-y border-white/[0.04]">
              <th className="text-left font-medium px-5 py-2.5">Recipient</th>
              <th className="text-right font-medium px-5 py-2.5">Amount</th>
              <th className="text-left font-medium px-5 py-2.5">Date</th>
              <th className="text-left font-medium px-5 py-2.5">Status</th>
              <th className="text-right font-medium px-5 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {loading ? (
              <tr><td colSpan={5} className="py-8 text-center text-xs text-gray-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-xs text-gray-500">No airdrops yet</td></tr>
            ) : visible.map(g => {
              const { decimals, label } = resolveMeta(g)
              return (
                <tr key={g.giftId} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3"><RecipientCell handle={g.recipientHandle} /></td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span className="text-white font-semibold">{formatAmount(g.amount, decimals)}</span>
                    <span className="text-gray-500 text-xs ml-1">{label}</span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">{formatDate(g.timestampMs)}</td>
                  <td className="px-5 py-3"><StatusCell gift={g} /></td>
                  <td className="px-5 py-3 text-right">
                    {!g.claimed && !g.isExpired ? (
                      <Link href={`/airdrops/claim/${g.giftId}`} className="text-[11px] text-[#D4AF37] hover:underline inline-flex items-center gap-0.5">
                        link <ExternalLink className="w-3 h-3" />
                      </Link>
                    ) : (
                      <span className="text-[11px] text-gray-700">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="sm:hidden divide-y divide-white/[0.03]">
        {loading ? (
          <div className="py-8 text-center text-xs text-gray-500">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-500">No airdrops yet</div>
        ) : visible.map(g => {
          const { decimals, label } = resolveMeta(g)
          return (
            <div key={g.giftId} className="px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <RecipientCell handle={g.recipientHandle} />
                <span className="text-white font-semibold text-sm tabular-nums">
                  {formatAmount(g.amount, decimals)} <span className="text-gray-500 text-xs">{label}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">{formatDate(g.timestampMs)}</span>
                <div className="flex items-center gap-2">
                  <StatusCell gift={g} />
                  {!g.claimed && !g.isExpired && (
                    <Link href={`/airdrops/claim/${g.giftId}`} className="text-[11px] text-[#D4AF37] inline-flex items-center gap-0.5">
                      link <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
