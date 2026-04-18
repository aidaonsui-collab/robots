'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Search, Plus, Clock, Users, TrendingUp, Zap, ChevronDown, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type PresaleToken, PRESALE_STATUS } from '@/lib/presale'

function formatSui(mist: number): string {
  const sui = mist / 1e9
  if (sui >= 1000) return `${(sui / 1000).toFixed(1)}K`
  if (sui >= 1) return sui.toFixed(1)
  return sui.toFixed(4)
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'Ended'
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatTimeUntilStart(ms: number): string {
  if (ms <= 0) return 'Starting...'
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  if (hours >= 24) return `in ${Math.floor(hours / 24)}d ${hours % 24}h`
  if (hours > 0) return `in ${hours}h ${minutes}m`
  return `in ${minutes}m`
}

function StatusBadge({ presale }: { presale: PresaleToken }) {
  if (presale.isMigrated) return (
    <span className="text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">LAUNCHED</span>
  )
  if (presale.isSuccess) return (
    <span className="text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">SUCCESS</span>
  )
  if (presale.isFailed) return (
    <span className="text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full">FAILED</span>
  )
  if (presale.hasEnded) return (
    <span className="text-[10px] font-bold bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30 px-2 py-0.5 rounded-full">ENDED</span>
  )
  if (presale.isActive) return (
    <span className="text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
      LIVE
    </span>
  )
  return (
    <span className="text-[10px] font-bold bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30 px-2 py-0.5 rounded-full">UPCOMING</span>
  )
}

function PresaleCard({ presale }: { presale: PresaleToken }) {
  const now = Date.now()

  return (
    <Link href={`/olympus/${presale.id}`}>
      <div className="group bg-[#0d0f1a] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-[#D4AF37]/5">
        {/* Token Image */}
        <div className="relative h-40 bg-gradient-to-br from-[#D4AF37]/10 to-[#B8860B]/5 flex items-center justify-center overflow-hidden">
          {presale.imageUrl ? (
            <img src={presale.imageUrl} alt={presale.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] flex items-center justify-center text-black text-2xl font-bold">
              {presale.symbol?.slice(0, 2) || '??'}
            </div>
          )}
          <div className="absolute top-3 right-3">
            <StatusBadge presale={presale} />
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-white font-semibold text-sm truncate">{presale.name}</h3>
              <p className="text-gray-500 text-xs">${presale.symbol}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[#D4AF37] text-xs font-medium">{presale.pricePerTokenSui.toFixed(6)} SUI</p>
              <p className="text-gray-600 text-[10px]">per token</p>
            </div>
          </div>

          {/* Progress Bar */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-gray-400">{formatSui(presale.totalRaisedMist)} SUI raised</span>
              <span className="text-gray-500">{presale.progress.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#D4AF37] to-[#B8860B] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, presale.progress)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-gray-600 mt-1">
              <span>Min: {formatSui(presale.minRaiseMist)} SUI</span>
              <span>Max: {formatSui(presale.maxRaiseMist)} SUI</span>
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-gray-400">
              <Users className="w-3 h-3" />
              <span>{presale.contributorCount}</span>
            </div>
            <div className="flex items-center gap-1 text-gray-400">
              <Clock className="w-3 h-3" />
              <span>
                {presale.isActive
                  ? formatTimeRemaining(presale.timeRemaining)
                  : presale.isPending
                    ? formatTimeUntilStart(presale.startTimeMs - now)
                    : 'Ended'
                }
              </span>
            </div>
          </div>

          {/* Lock badges */}
          {(presale.teamCliffMs > 0 || presale.creatorCliffMs > 0) && (
            <div className="flex items-center gap-1.5 pt-1 border-t border-white/[0.04]">
              <Lock className="w-2.5 h-2.5 text-gray-600 shrink-0" />
              {presale.teamCliffMs > 0 && (
                <span className="text-[9px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded-full">
                  Team {(presale.teamBps / 100).toFixed(0)}% locked
                </span>
              )}
              {presale.creatorCliffMs > 0 && (
                <span className="text-[9px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                  Creator {(presale.creatorBps / 100).toFixed(0)}% locked
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

type FilterType = 'all' | 'live' | 'upcoming' | 'ended'
type SortType = 'newest' | 'ending_soon' | 'most_raised' | 'most_contributors'

export default function OlympusPage() {
  const [presales, setPresales] = useState<PresaleToken[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [sort, setSort] = useState<SortType>('newest')

  useEffect(() => {
    fetchPresales()
    const interval = setInterval(fetchPresales, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchPresales() {
    try {
      const res = await fetch('/api/presale')
      if (res.ok) {
        const data = await res.json()
        setPresales(Array.isArray(data) ? data : [])
      }
    } catch (e) {
      console.error('Failed to fetch presales:', e)
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    let list = [...presales]

    // Search
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.symbol.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      )
    }

    // Filter
    switch (filter) {
      case 'live':
        list = list.filter(p => p.isActive)
        break
      case 'upcoming':
        list = list.filter(p => p.isPending)
        break
      case 'ended':
        list = list.filter(p => p.isSuccess || p.isFailed || p.isMigrated || p.hasEnded)
        break
    }

    // Sort
    switch (sort) {
      case 'newest':
        list.sort((a, b) => b.createdAt - a.createdAt)
        break
      case 'ending_soon':
        list.sort((a, b) => a.endTimeMs - b.endTimeMs)
        break
      case 'most_raised':
        list.sort((a, b) => b.totalRaisedMist - a.totalRaisedMist)
        break
      case 'most_contributors':
        list.sort((a, b) => b.contributorCount - a.contributorCount)
        break
    }

    return list
  }, [presales, search, filter, sort])

  const stats = useMemo(() => ({
    total: presales.length,
    live: presales.filter(p => p.isActive).length,
    totalRaised: presales.reduce((sum, p) => sum + p.totalRaisedSui, 0),
    totalContributors: presales.reduce((sum, p) => sum + p.contributorCount, 0),
  }), [presales])

  return (
    <div className="min-h-screen bg-[#07070e] pt-20 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-white">Olympus</h1>
              <span className="text-[10px] font-bold bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30 px-2.5 py-1 rounded-full tracking-wider">
                PRESALE
              </span>
            </div>
            <p className="text-gray-500 text-sm">
              Fixed-price token presales with guaranteed allocation. Successful launches migrate to Momentum DEX.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/olympus/locks"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.06] text-gray-300 font-medium text-sm hover:bg-white/[0.1] hover:text-white transition-all border border-white/[0.06]"
            >
              <Lock className="w-4 h-4" />
              My Locks
            </Link>
            <Link
              href="/olympus/create"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4AF37] text-black font-semibold text-sm hover:opacity-90 hover:shadow-lg hover:shadow-[#D4AF37]/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              Create Presale
            </Link>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          {[
            { label: 'Total Presales', value: stats.total.toString(), icon: Zap },
            { label: 'Live Now', value: stats.live.toString(), icon: TrendingUp },
            { label: 'Total Raised', value: `${stats.totalRaised.toFixed(1)} SUI`, icon: TrendingUp },
            { label: 'Contributors', value: stats.totalContributors.toString(), icon: Users },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <stat.icon className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span className="text-gray-500 text-xs">{stat.label}</span>
              </div>
              <p className="text-white text-lg font-semibold">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Search / Filter / Sort Bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search presales..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[#0d0f1a] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'live', 'upcoming', 'ended'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3.5 py-2 rounded-xl text-xs font-medium capitalize transition-all',
                  filter === f
                    ? 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30'
                    : 'bg-[#0d0f1a] text-gray-500 border border-white/[0.06] hover:text-white hover:border-white/[0.12]'
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortType)}
              className="appearance-none pl-3 pr-8 py-2.5 bg-[#0d0f1a] border border-white/[0.06] rounded-xl text-gray-400 text-xs focus:outline-none focus:border-[#D4AF37]/40 cursor-pointer"
            >
              <option value="newest">Newest</option>
              <option value="ending_soon">Ending Soon</option>
              <option value="most_raised">Most Raised</option>
              <option value="most_contributors">Most Contributors</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
          </div>
        </div>

        {/* Presale Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#D4AF37]/10 flex items-center justify-center">
              <Zap className="w-8 h-8 text-[#D4AF37]/50" />
            </div>
            <h3 className="text-white font-semibold mb-2">
              {search || filter !== 'all' ? 'No presales found' : 'No presales yet'}
            </h3>
            <p className="text-gray-500 text-sm mb-6">
              {search || filter !== 'all'
                ? 'Try adjusting your search or filters.'
                : 'Be the first to launch a presale on Olympus.'
              }
            </p>
            {!search && filter === 'all' && (
              <Link
                href="/olympus/create"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4AF37] text-black font-semibold text-sm hover:opacity-90 transition-all"
              >
                <Plus className="w-4 h-4" />
                Create Presale
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((presale) => (
              <PresaleCard key={presale.id} presale={presale} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
