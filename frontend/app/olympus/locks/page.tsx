'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useCurrentWallet, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { ArrowLeft, Lock, Loader2, ExternalLink } from 'lucide-react'
import { type PresaleToken } from '@/lib/presale'

const ConnectButton = dynamic(
  () => import('@mysten/dapp-kit').then(mod => mod.ConnectButton),
  { ssr: false }
)

const PRESALE_PACKAGE_ID = (process.env.NEXT_PUBLIC_PRESALE_PACKAGE_ID || '').trim()
const CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`
  return n.toLocaleString()
}

type LockEntry = {
  presale: PresaleToken
  type: 'creator' | 'team'
  cliffMs: number
  vestingEndMs: number
  lockedAmount: number
  unlocked: boolean   // cliff has passed
  fullyVested: boolean
}

function VestingBar({ cliffMs, vestingEndMs }: { cliffMs: number; vestingEndMs: number }) {
  const now = Date.now()
  if (now < cliffMs) {
    const total = cliffMs - (cliffMs - 30 * 24 * 60 * 60 * 1000) // approx
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Lock className="w-3 h-3 shrink-0" />
        <span>Locked until {formatDate(cliffMs)}</span>
      </div>
    )
  }
  if (vestingEndMs === 0 || now >= vestingEndMs) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
        <span>{vestingEndMs === 0 ? 'Cliff passed — fully releasable' : 'Fully vested'}</span>
      </div>
    )
  }
  const elapsed = now - cliffMs
  const duration = vestingEndMs - cliffMs
  const pct = Math.min(100, (elapsed / duration) * 100)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Vesting progress</span>
        <span className="text-emerald-400">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-gray-600">Fully vested {formatDate(vestingEndMs)}</p>
    </div>
  )
}

export default function LocksPage() {
  const { isConnected, currentWallet } = useCurrentWallet()
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction()
  const address = currentWallet?.accounts?.[0]?.address

  const [locks, setLocks] = useState<LockEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [releasing, setReleasing] = useState<string | null>(null) // presaleId + type
  const [msgs, setMsgs] = useState<Record<string, { text: string; ok: boolean }>>({})

  const fetchLocks = useCallback(async () => {
    if (!address) return
    setLoading(true)
    try {
      const res = await fetch('/api/presale')
      if (!res.ok) return
      const all: PresaleToken[] = await res.json()
      const now = Date.now()

      const entries: LockEntry[] = []

      for (const p of all) {
        // Creator locks
        if (
          p.creator?.toLowerCase() === address.toLowerCase() &&
          p.creatorCliffMs > 0 &&
          p.creatorTokenSupply > 0
        ) {
          entries.push({
            presale: p,
            type: 'creator',
            cliffMs: p.creatorCliffMs,
            vestingEndMs: p.creatorVestingEndMs,
            lockedAmount: p.creatorTokenSupply,
            unlocked: now >= p.creatorCliffMs,
            fullyVested: p.creatorVestingEndMs === 0 ? now >= p.creatorCliffMs : now >= p.creatorVestingEndMs,
          })
        }
        // Team locks
        if (
          p.teamWallet?.toLowerCase() === address.toLowerCase() &&
          p.teamCliffMs > 0 &&
          p.teamTokenSupply > 0
        ) {
          entries.push({
            presale: p,
            type: 'team',
            cliffMs: p.teamCliffMs,
            vestingEndMs: p.teamVestingEndMs,
            lockedAmount: p.teamTokenSupply,
            unlocked: now >= p.teamCliffMs,
            fullyVested: p.teamVestingEndMs === 0 ? now >= p.teamCliffMs : now >= p.teamVestingEndMs,
          })
        }
      }

      // Sort: unlocked first, then by cliff date
      entries.sort((a, b) => {
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1
        return a.cliffMs - b.cliffMs
      })

      setLocks(entries)
    } catch (e) {
      console.error('Failed to fetch locks:', e)
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    if (address) fetchLocks()
  }, [address, fetchLocks])

  async function handleRelease(entry: LockEntry) {
    if (!isConnected) return
    const key = `${entry.presale.id}-${entry.type}`
    const pkgId = entry.presale.packageId || PRESALE_PACKAGE_ID
    const fn = entry.type === 'creator' ? 'release_creator_tokens' : 'release_team_tokens'

    setReleasing(key)
    setMsgs(prev => ({ ...prev, [key]: { text: 'Signing transaction...', ok: true } }))

    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${pkgId}::presale::${fn}`,
        typeArguments: [entry.presale.tokenType || entry.presale.tokenAddress],
        arguments: [tx.object(entry.presale.id), tx.object(CLOCK)],
      })
      await signAndExecuteTransaction({ transaction: tx as any, chain: 'sui:mainnet' })
      setMsgs(prev => ({ ...prev, [key]: { text: 'Released successfully!', ok: true } }))
      setTimeout(fetchLocks, 3000)
    } catch (e: any) {
      setMsgs(prev => ({ ...prev, [key]: { text: e.message || 'Release failed', ok: false } }))
    } finally {
      setReleasing(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#07070e] pt-20 pb-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">

        <Link href="/olympus" className="inline-flex items-center gap-1.5 text-gray-500 text-sm hover:text-white transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" />
          Back to Olympus
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center">
            <Lock className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">My Locks</h1>
            <p className="text-gray-500 text-sm">Token allocations locked from presales you created or are team beneficiary of</p>
          </div>
        </div>

        {!isConnected ? (
          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-12 text-center">
            <Lock className="w-10 h-10 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-sm mb-6">Connect your wallet to view your locked token positions</p>
            <ConnectButton />
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          </div>
        ) : locks.length === 0 ? (
          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-12 text-center">
            <Lock className="w-10 h-10 text-gray-600 mx-auto mb-4" />
            <p className="text-white font-semibold mb-1">No locked positions</p>
            <p className="text-gray-500 text-sm">
              You don&apos;t have any locked creator or team token allocations from presales.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {locks.map((entry) => {
              const key = `${entry.presale.id}-${entry.type}`
              const msg = msgs[key]
              const isReleasing = releasing === key
              const canRelease = entry.unlocked && entry.presale.isMigrated && entry.lockedAmount > 0

              return (
                <div
                  key={key}
                  className={`bg-[#0d0f1a] border rounded-2xl p-6 ${
                    entry.unlocked ? 'border-[#D4AF37]/20' : 'border-white/[0.06]'
                  }`}
                >
                  <div className="flex items-start gap-4 mb-4">
                    {/* Token avatar */}
                    <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-gradient-to-br from-[#D4AF37] to-[#B8860B] flex items-center justify-center">
                      {entry.presale.imageUrl ? (
                        <img src={entry.presale.imageUrl} alt={entry.presale.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-black text-sm font-bold">{entry.presale.symbol?.slice(0, 2)}</span>
                      )}
                    </div>

                    {/* Header info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="text-white font-semibold text-sm">{entry.presale.name}</h3>
                        <span className="text-gray-500 text-xs">${entry.presale.symbol}</span>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                          entry.type === 'creator'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        }`}>
                          {entry.type === 'creator' ? 'CREATOR' : 'TEAM'}
                        </span>
                        {entry.unlocked && (
                          <span className="text-[9px] font-bold bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30 px-2 py-0.5 rounded-full">
                            UNLOCKED
                          </span>
                        )}
                      </div>
                      <Link
                        href={`/olympus/${entry.presale.id}`}
                        className="text-gray-500 text-xs hover:text-gray-300 transition-colors flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {entry.presale.id.slice(0, 12)}...{entry.presale.id.slice(-6)}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </Link>
                    </div>

                    {/* Locked amount */}
                    <div className="text-right shrink-0">
                      <p className="text-white font-semibold text-sm">{formatTokens(entry.lockedAmount)}</p>
                      <p className="text-gray-500 text-xs">${entry.presale.symbol} locked</p>
                    </div>
                  </div>

                  {/* Vesting bar */}
                  <div className="mb-4">
                    <VestingBar cliffMs={entry.cliffMs} vestingEndMs={entry.vestingEndMs} />
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-[#07070e] rounded-xl p-3">
                      <p className="text-gray-500 text-[10px] mb-0.5">Cliff date</p>
                      <p className="text-white text-xs font-medium">{formatDate(entry.cliffMs)}</p>
                    </div>
                    <div className="bg-[#07070e] rounded-xl p-3">
                      <p className="text-gray-500 text-[10px] mb-0.5">
                        {entry.vestingEndMs > 0 ? 'Vesting end' : 'Release type'}
                      </p>
                      <p className="text-white text-xs font-medium">
                        {entry.vestingEndMs > 0 ? formatDate(entry.vestingEndMs) : 'Cliff only (one-time)'}
                      </p>
                    </div>
                  </div>

                  {/* Status / action */}
                  {!entry.presale.isMigrated && (
                    <div className="bg-[#07070e] rounded-xl px-4 py-3 text-xs text-gray-500">
                      Presale not yet migrated to DEX — tokens release after graduation
                    </div>
                  )}

                  {canRelease && (
                    <button
                      onClick={() => handleRelease(entry)}
                      disabled={!!isReleasing}
                      className={`w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-30 flex items-center justify-center gap-2 ${
                        entry.type === 'creator'
                          ? 'bg-emerald-500 text-white hover:opacity-90'
                          : 'bg-purple-500 text-white hover:opacity-90'
                      }`}
                    >
                      {isReleasing
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <>Release {entry.fullyVested ? 'All' : 'Vested'} Tokens</>
                      }
                    </button>
                  )}

                  {msg && (
                    <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {msg.text}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
