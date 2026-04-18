'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useCurrentWallet, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import {
  ArrowLeft, Clock, Users, TrendingUp, Globe, Twitter, MessageCircle,
  Loader2, CheckCircle, AlertCircle, ExternalLink, Copy, Check
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { type PresaleToken } from '@/lib/presale'

const ConnectButton = dynamic(
  () => import('@mysten/dapp-kit').then(mod => mod.ConnectButton),
  { ssr: false }
)

const PriceChart = dynamic(
  () => import('@/components/coin/PriceChart'),
  { ssr: false }
)

const PRESALE_PACKAGE_ID = (process.env.NEXT_PUBLIC_PRESALE_PACKAGE_ID || '0x4c9f2fe6a524873adea66ff6f31d6caba0df10d10ffd8b28e99d0b8e26eabc76').trim()
const ADMIN_ADDRESS = '0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409'
const CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

function formatSui(mist: number): string {
  const sui = mist / 1e9
  if (sui >= 1000) return `${(sui / 1000).toFixed(1)}K`
  if (sui >= 1) return sui.toFixed(2)
  return sui.toFixed(4)
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'Ended'
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((ms % (1000 * 60)) / 1000)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  return `${minutes}m ${seconds}s`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function StatusBanner({ presale }: { presale: PresaleToken }) {
  const now = Date.now()
  const ended = now >= presale.endTimeMs && !presale.isSuccess && !presale.isFailed && !presale.isMigrated
  const filled = (presale.maxRaiseMist - presale.totalRaisedMist) < 1_000_000 && presale.maxRaiseMist > 0 && !presale.isSuccess && !presale.isFailed && !presale.isMigrated
  if (presale.isCancelled) return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
      <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
      <div>
        <p className="text-red-400 text-sm font-medium">Presale Cancelled</p>
        <p className="text-red-400/60 text-xs">This presale was cancelled by the platform. You can refund your SUI below.</p>
      </div>
    </div>
  )
  if (presale.isMigrated) return (
    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
      <CheckCircle className="w-5 h-5 text-blue-400 shrink-0" />
      <div>
        <p className="text-blue-400 text-sm font-medium">Launched on Momentum DEX</p>
        <p className="text-blue-400/60 text-xs">This token has graduated from presale and is now trading.</p>
      </div>
    </div>
  )
  if (presale.isSuccess) return (
    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
      <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
      <div>
        <p className="text-emerald-400 text-sm font-medium">Presale Successful</p>
        <p className="text-emerald-400/60 text-xs">Minimum raise met. Claim your tokens below. DEX migration pending.</p>
      </div>
    </div>
  )
  if (presale.isFailed) return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
      <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
      <div>
        <p className="text-red-400 text-sm font-medium">Presale Failed</p>
        <p className="text-red-400/60 text-xs">Minimum raise was not met. You can refund your SUI below.</p>
      </div>
    </div>
  )
  if (filled) return (
    <div className="bg-[#D4AF37]/10 border border-[#D4AF37]/20 rounded-xl px-4 py-3 flex items-center gap-3">
      <CheckCircle className="w-5 h-5 text-[#D4AF37] shrink-0" />
      <div>
        <p className="text-[#D4AF37] text-sm font-medium">Presale Filled — Ready to Finalize</p>
        <p className="text-[#D4AF37]/60 text-xs">Max raise reached. Click &quot;Finalize Presale&quot; below to settle.</p>
      </div>
    </div>
  )
  if (ended) return (
    <div className="bg-[#D4AF37]/10 border border-[#D4AF37]/20 rounded-xl px-4 py-3 flex items-center gap-3">
      <Clock className="w-5 h-5 text-[#D4AF37] shrink-0" />
      <div>
        <p className="text-[#D4AF37] text-sm font-medium">Presale Ended — Awaiting Finalization</p>
        <p className="text-[#D4AF37]/60 text-xs">The presale window has closed. Click &quot;Finalize Presale&quot; below to settle.</p>
      </div>
    </div>
  )
  return null
}

export default function PresaleDetailPage() {
  const params = useParams()
  const presaleId = params.id as string
  const { isConnected: connected, currentWallet } = useCurrentWallet()
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction()
  const suiClient = useSuiClient()
  const address = currentWallet?.accounts?.[0]?.address
  const isAdmin = address?.toLowerCase() === ADMIN_ADDRESS.toLowerCase()

  const [presale, setPresale] = useState<PresaleToken | null>(null)
  const [loading, setLoading] = useState(true)
  const [userContribution, setUserContribution] = useState(0)
  const [contributeAmount, setContributeAmount] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState('')
  const [actionType, setActionType] = useState<'info' | 'success' | 'error'>('info')
  const [graduateLoading, setGraduateLoading] = useState(false)
  const [graduateMsg, setGraduateMsg] = useState('')
  const [graduateType, setGraduateType] = useState<'info' | 'success' | 'error'>('info')
  const [showRetryPool, setShowRetryPool] = useState(false)
  const [copied, setCopied] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const [contributors, setContributors] = useState<{ address: string; amount: number }[]>([])

  const fetchContributors = useCallback(async () => {
    if (!presaleId) return
    try {
      const RPC = 'https://fullnode.mainnet.sui.io'
      // Get contributions Table ID from the presale object
      const objRes = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sui_getObject',
          params: [presaleId, { showContent: true }] }),
      }).then(r => r.json())
      const tableId = objRes.result?.data?.content?.fields?.contributions?.fields?.id?.id
      if (!tableId) return

      // Fetch all table entries (up to 100)
      const dynRes = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getDynamicFields',
          params: [tableId, null, 100] }),
      }).then(r => r.json())
      const entries: any[] = dynRes.result?.data || []
      if (entries.length === 0) { setContributors([]); return }

      // Batch-fetch all entry objects to get amounts
      const multiRes = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sui_multiGetObjects',
          params: [entries.map((e: any) => e.objectId), { showContent: true }] }),
      }).then(r => r.json())

      const list = (multiRes.result || [])
        .map((obj: any) => ({
          address: obj?.data?.content?.fields?.name || '',
          amount: Number(obj?.data?.content?.fields?.value || 0),
        }))
        .filter((c: any) => c.address)
        .sort((a: any, b: any) => b.amount - a.amount)
      setContributors(list)
    } catch (e) {
      console.error('fetchContributors error', e)
    }
  }, [presaleId])

  const fetchData = useCallback(async () => {
    try {
      const url = address
        ? `/api/presale/${presaleId}?user=${address}`
        : `/api/presale/${presaleId}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setPresale(data)
        setUserContribution(data.userContribution || 0)
      }
    } catch (e) {
      console.error('Failed to fetch presale:', e)
    } finally {
      setLoading(false)
    }
  }, [presaleId, address])

  useEffect(() => {
    fetchData()
    fetchContributors()
    const interval = setInterval(() => { fetchData(); fetchContributors() }, 15000)
    return () => clearInterval(interval)
  }, [fetchData, fetchContributors])

  // Live countdown
  useEffect(() => {
    if (!presale) return
    const tick = () => {
      const now = Date.now()
      if (presale.isActive) {
        setTimeLeft(Math.max(0, presale.endTimeMs - now))
      } else if (presale.isPending) {
        setTimeLeft(Math.max(0, presale.startTimeMs - now))
      } else {
        setTimeLeft(0)
      }
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [presale])

  async function handleContribute() {
    if (!connected || !presale) return
    const pkgId = presale.packageId || PRESALE_PACKAGE_ID
    const amount = parseFloat(contributeAmount)
    if (!amount || amount <= 0) return

    setActionLoading(true)
    setActionMsg('Preparing contribution...')
    setActionType('info')

    try {
      const amountMist = BigInt(Math.round(amount * 1e9))
      const tx = new Transaction()
      const [payment] = tx.splitCoins(tx.gas, [amountMist])

      tx.moveCall({
        target: `${pkgId}::presale::contribute`,
        typeArguments: [presale.tokenType || presale.tokenAddress],
        arguments: [
          tx.object(presaleId),
          payment,
          tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
        ],
      })

      setActionMsg('Sign transaction...')
      await signAndExecuteTransaction({
        transaction: tx as any,
        chain: 'sui:mainnet',
      })

      setActionMsg('Contribution successful!')
      setActionType('success')
      setContributeAmount('')
      fetchData()
    } catch (e: any) {
      setActionMsg(e.message || 'Contribution failed')
      setActionType('error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleFinalize() {
    if (!connected || !presale) return
    const pkgId = presale.packageId || PRESALE_PACKAGE_ID

    setActionLoading(true)
    setActionMsg('Finalizing presale...')
    setActionType('info')

    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${pkgId}::presale::finalize`,
        typeArguments: [presale.tokenType || presale.tokenAddress],
        arguments: [
          tx.object(presaleId),
          tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
        ],
      })

      await signAndExecuteTransaction({
        transaction: tx as any,
        chain: 'sui:mainnet',
      })

      setActionMsg('Presale finalized!')
      setActionType('success')
      fetchData()
    } catch (e: any) {
      setActionMsg(e.message || 'Finalization failed')
      setActionType('error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleGraduate() {
    if (!presale) return
    setGraduateLoading(true)
    setGraduateMsg('Triggering migration...')
    setGraduateType('info')

    try {
      const res = await fetch(`/api/presale/${presaleId}/graduate`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        setGraduateMsg(data.error || 'Migration failed')
        setGraduateType('error')
      } else {
        setGraduateMsg('Migration triggered! Pool is being created on Momentum DEX.')
        setGraduateType('success')
        setTimeout(fetchData, 5000) // Refresh after 5s
      }
    } catch (e: any) {
      setGraduateMsg(e.message || 'Migration request failed')
      setGraduateType('error')
    } finally {
      setGraduateLoading(false)
    }
  }

  async function handleClaim() {
    if (!connected || !presale) return
    const pkgId = presale.packageId || PRESALE_PACKAGE_ID

    setActionLoading(true)
    setActionMsg('Claiming tokens...')
    setActionType('info')

    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${pkgId}::presale::claim`,
        typeArguments: [presale.tokenType || presale.tokenAddress],
        arguments: [
          tx.object(presaleId),
          tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
        ],
      })

      await signAndExecuteTransaction({
        transaction: tx as any,
        chain: 'sui:mainnet',
      })

      setActionMsg('Tokens claimed!')
      setActionType('success')
      fetchData()
    } catch (e: any) {
      setActionMsg(e.message || 'Claim failed')
      setActionType('error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleRefund() {
    if (!connected || !presale) return
    const pkgId = presale.packageId || PRESALE_PACKAGE_ID

    setActionLoading(true)
    setActionMsg('Processing refund...')
    setActionType('info')

    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${pkgId}::presale::refund`,
        typeArguments: [presale.tokenType || presale.tokenAddress],
        arguments: [
          tx.object(presaleId),
          tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
        ],
      })

      await signAndExecuteTransaction({
        transaction: tx as any,
        chain: 'sui:mainnet',
      })

      setActionMsg('Refund successful!')
      setActionType('success')
      fetchData()
    } catch (e: any) {
      setActionMsg(e.message || 'Refund failed')
      setActionType('error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleCancel() {
    if (!connected || !presale || !isAdmin) return
    const pkgId = presale.packageId || PRESALE_PACKAGE_ID
    if (!confirm('Cancel this presale? Contributors will be able to refund their SUI.')) return

    setActionLoading(true)
    setActionMsg('Cancelling presale...')
    setActionType('info')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${pkgId}::presale::cancel_presale`,
        typeArguments: [presale.tokenType || presale.tokenAddress],
        arguments: [tx.object(presaleId), tx.object(CLOCK)],
      })
      await signAndExecuteTransaction({ transaction: tx as any, chain: 'sui:mainnet' })
      setActionMsg('Presale cancelled — contributors can now refund')
      setActionType('success')
      fetchData()
    } catch (e: any) {
      setActionMsg(e.message || 'Cancel failed')
      setActionType('error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReleaseTeam() {
    if (!connected || !presale) return
    const pkgId = presale.packageId || PRESALE_PACKAGE_ID

    setActionLoading(true)
    setActionMsg('Releasing team tokens...')
    setActionType('info')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${pkgId}::presale::release_team_tokens`,
        typeArguments: [presale.tokenType || presale.tokenAddress],
        arguments: [tx.object(presaleId), tx.object(CLOCK)],
      })
      await signAndExecuteTransaction({ transaction: tx as any, chain: 'sui:mainnet' })
      setActionMsg('Team tokens released!')
      setActionType('success')
      fetchData()
    } catch (e: any) {
      setActionMsg(e.message || 'Release failed')
      setActionType('error')
    } finally {
      setActionLoading(false)
    }
  }

  function copyAddress(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Client-side derived state — recompute from live clock, not stale server data
  const now = Date.now()
  const timeExpired = presale ? now >= presale.endTimeMs : false
  // Treat as "effectively filled" when remaining amount is dust (< 0.001 SUI = 1M mist)
  const isFilled = presale ? (presale.maxRaiseMist - presale.totalRaisedMist) < 1_000_000 && presale.maxRaiseMist > 0 : false
  const clientHasEnded = presale
    ? (timeExpired || isFilled) && !presale.isSuccess && !presale.isFailed && !presale.isMigrated && !presale.isCancelled
    : false
  const clientIsActive = presale
    ? !timeExpired && !isFilled && !presale.isCancelled && (presale.status === 1 || (presale.status === 0 && now >= presale.startTimeMs))
    : false
  // Show finalize when time expired OR filled (contract v3+ supports early finalize)
  const showFinalize = clientHasEnded || (presale?.hasEnded && !presale?.isSuccess && !presale?.isFailed && !presale?.isMigrated)

  const estimatedTokens = presale && contributeAmount
    ? (parseFloat(contributeAmount) / presale.pricePerTokenSui).toFixed(2)
    : '0'

  const userContributionSui = userContribution / 1e9
  // Use fixed price to compute allocation — independent of live pool balance
  // (pool balances drain to 0 after withdraw_for_migration)
  const userEstimatedTokens = presale && userContribution > 0 && presale.pricePerTokenMist > 0
    ? (userContribution / presale.pricePerTokenMist).toFixed(2)
    : '0'

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07070e] pt-20 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    )
  }

  if (!presale) {
    return (
      <div className="min-h-screen bg-[#07070e] pt-20 flex items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-white text-xl font-bold mb-2">Presale Not Found</h2>
          <p className="text-gray-500 text-sm mb-4">This presale doesn't exist or hasn't been indexed yet.</p>
          <Link href="/olympus" className="text-[#D4AF37] text-sm hover:underline">Back to Olympus</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#07070e] pt-20 pb-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">

        {/* Back */}
        <Link href="/olympus" className="inline-flex items-center gap-1.5 text-gray-500 text-sm hover:text-white transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" />
          Back to Olympus
        </Link>

        {/* Status Banner */}
        <div className="mb-6">
          <StatusBanner presale={presale} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left Column: Token Info + Progress */}
          <div className="lg:col-span-2 space-y-6">

            {/* Token Header */}
            <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-gradient-to-br from-[#D4AF37] to-[#B8860B] flex items-center justify-center">
                  {presale.imageUrl ? (
                    <img src={presale.imageUrl} alt={presale.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-black text-xl font-bold">{presale.symbol?.slice(0, 2)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h1 className="text-xl font-bold text-white truncate">{presale.name}</h1>
                    <span className="text-gray-500 text-sm">${presale.symbol}</span>
                  </div>
                  {presale.tokenType && (
                    <button
                      onClick={() => { navigator.clipboard.writeText(presale.tokenType); copyAddress(presale.tokenType) }}
                      className="flex items-center gap-1 text-gray-600 hover:text-gray-400 text-xs transition-colors mb-1.5 font-mono"
                      title="Copy token contract address"
                    >
                      {copied ? <Check className="w-3 h-3 shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
                      <span className="truncate max-w-[260px]">{presale.tokenType}</span>
                    </button>
                  )}
                  <p className="text-gray-400 text-sm line-clamp-2">{presale.description || 'No description'}</p>
                  {/* Socials */}
                  <div className="flex items-center gap-3 mt-3">
                    {presale.twitter && (
                      <a href={presale.twitter} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-[#D4AF37] transition-colors">
                        <Twitter className="w-4 h-4" />
                      </a>
                    )}
                    {presale.telegram && (
                      <a href={presale.telegram} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-[#D4AF37] transition-colors">
                        <MessageCircle className="w-4 h-4" />
                      </a>
                    )}
                    {presale.website && (
                      <a href={presale.website} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-[#D4AF37] transition-colors">
                        <Globe className="w-4 h-4" />
                      </a>
                    )}
                    <button
                      onClick={() => copyAddress(presale.id)}
                      className="flex items-center gap-1 text-gray-600 hover:text-gray-400 text-xs transition-colors"
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {presale.id.slice(0, 8)}...{presale.id.slice(-4)}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Progress Card */}
            <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6">
              <h3 className="text-white font-semibold text-sm mb-4">Raise Progress</h3>

              {/* Large Progress Bar */}
              <div className="mb-4">
                <div className="flex items-end justify-between mb-2">
                  <div>
                    <span className="text-2xl font-bold text-white">{formatSui(presale.totalRaisedMist)}</span>
                    <span className="text-gray-500 text-sm ml-1">SUI raised</span>
                  </div>
                  <span className="text-[#D4AF37] font-semibold">{presale.progress.toFixed(1)}%</span>
                </div>
                <div className="h-4 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#D4AF37] to-[#B8860B] rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(100, presale.progress)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 mt-1.5">
                  <span>Min: {formatSui(presale.minRaiseMist)} SUI</span>
                  <span>Max: {formatSui(presale.maxRaiseMist)} SUI</span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-[#07070e] rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1">
                    <TrendingUp className="w-3 h-3" /> Price
                  </div>
                  <p className="text-white text-sm font-medium">{presale.pricePerTokenSui.toFixed(6)} SUI</p>
                </div>
                <div className="bg-[#07070e] rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1">
                    <Users className="w-3 h-3" /> Contributors
                  </div>
                  <p className="text-white text-sm font-medium">{presale.contributorCount}</p>
                </div>
                <div className="bg-[#07070e] rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1">
                    <Clock className="w-3 h-3" /> {presale.isPending ? 'Starts' : 'Ends'}
                  </div>
                  <p className="text-white text-sm font-medium">{formatTimeRemaining(timeLeft)}</p>
                </div>
                <div className="bg-[#07070e] rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1">
                    <Clock className="w-3 h-3" /> End Date
                  </div>
                  <p className="text-white text-sm font-medium">{formatDate(presale.endTimeMs)}</p>
                </div>
              </div>
            </div>

            {/* Token Distribution */}
            <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6">
              <h3 className="text-white font-semibold text-sm mb-4">Token Distribution</h3>
              <div className="h-3 bg-white/[0.06] rounded-full overflow-hidden flex mb-3">
                <div className="bg-[#D4AF37] transition-all" style={{ width: `${presale.presaleBps / 100}%` }} />
                <div className="bg-blue-500 transition-all" style={{ width: `${presale.liquidityBps / 100}%` }} />
                {presale.teamBps > 0 && <div className="bg-purple-500 transition-all" style={{ width: `${presale.teamBps / 100}%` }} />}
                <div className="bg-emerald-500 transition-all" style={{ width: `${presale.creatorBps / 100}%` }} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#D4AF37] shrink-0" />
                  <div>
                    <p className="text-gray-400 text-xs">Presale</p>
                    <p className="text-white font-medium">{(presale.presaleBps / 100).toFixed(0)}%</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
                  <div>
                    <p className="text-gray-400 text-xs">Liquidity</p>
                    <p className="text-white font-medium">{(presale.liquidityBps / 100).toFixed(0)}%</p>
                  </div>
                </div>
                {presale.teamBps > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0" />
                    <div>
                      <p className="text-gray-400 text-xs">Team</p>
                      <p className="text-white font-medium">{(presale.teamBps / 100).toFixed(0)}%</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                  <div>
                    <p className="text-gray-400 text-xs">Creator</p>
                    <p className="text-white font-medium">{(presale.creatorBps / 100).toFixed(0)}%</p>
                  </div>
                </div>
              </div>

              {/* Team vesting info */}
              {presale.teamBps > 0 && presale.teamCliffMs > 0 && (
                <div className="mt-4 bg-purple-500/5 border border-purple-500/20 rounded-xl p-3 space-y-1.5">
                  <p className="text-purple-400 text-xs font-medium">Team Token Lock</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">Wallet</span>
                    <span className="text-gray-300 font-mono">{presale.teamWallet.slice(0, 8)}...{presale.teamWallet.slice(-4)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">Cliff</span>
                    <span className="text-gray-300">{formatDate(presale.teamCliffMs)}</span>
                  </div>
                  {presale.teamVestingEndMs > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Fully Vested</span>
                      <span className="text-gray-300">{formatDate(presale.teamVestingEndMs)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">Still Locked</span>
                    <span className="text-white font-medium">{presale.teamTokenSupply.toLocaleString()} {presale.symbol}</span>
                  </div>
                </div>
              )}

              {/* Raised SUI allocation — shown when creator takes a cut */}
              {presale.creatorSuiBps > 0 && (
                <div className="mt-4 bg-[#D4AF37]/5 border border-[#D4AF37]/15 rounded-xl p-3 space-y-2">
                  <p className="text-[#D4AF37] text-xs font-medium">Raised SUI Allocation</p>
                  <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden flex">
                    <div className="bg-[#D4AF37]/60" style={{ width: `${presale.creatorSuiBps / 100}%` }} />
                    <div className="bg-blue-500" style={{ width: `${100 - presale.creatorSuiBps / 100}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-gray-400">
                      <span className="w-2 h-2 rounded-full bg-[#D4AF37]/60" />
                      Creator wallet
                    </span>
                    <span className="text-white font-medium">{(presale.creatorSuiBps / 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-gray-400">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      DEX liquidity pool
                    </span>
                    <span className="text-white font-medium">{(100 - presale.creatorSuiBps / 100).toFixed(0)}%</span>
                  </div>
                  {presale.maxRaiseSui > 0 && (
                    <p className="text-gray-600 text-[10px] pt-1 border-t border-white/[0.04]">
                      At max raise: ~{(presale.maxRaiseSui * presale.creatorSuiBps / 10000).toFixed(1)} SUI to creator · ~{(presale.maxRaiseSui * (1 - presale.creatorSuiBps / 10000)).toFixed(1)} SUI to DEX
                    </p>
                  )}
                </div>
              )}

              {/* Burn on fail / burned badge */}
              {(presale.isFailed || presale.isCancelled || presale.tokensBurned) && (
                <div className="mt-3 flex items-center gap-2 text-xs text-orange-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                  {presale.tokensBurned ? 'Tokens burned' : 'Burns on failure'}
                </div>
              )}
            </div>

            {/* Live DEX Chart — only shown after migration to Momentum */}
            {presale.isMigrated && presale.tokenType && (
              <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                  <h3 className="text-white font-semibold text-sm">Live Chart — Momentum DEX</h3>
                  <a
                    href={`https://app.mmt.finance/trade?coinTypeA=0x2::sui::SUI&coinTypeB=${encodeURIComponent(presale.tokenType)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#D4AF37] hover:opacity-80 transition-opacity flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Trade on Momentum
                  </a>
                </div>
                <PriceChart
                  chartApiUrl={`/api/momentum-ohlcv?tokenType=${encodeURIComponent(presale.tokenType)}`}
                  symbol={presale.symbol}
                />
                <p className="px-4 py-2 text-[10px] text-gray-600">
                  Prices in USD via GeckoTerminal. Chart updates every 30s. May show &quot;No trades yet&quot; until the pool is indexed (~5–15 min after launch).
                </p>
              </div>
            )}
          </div>

          {/* Right Column: Action Panel */}
          <div className="space-y-6">

            {/* Contribute Panel (active presale) */}
            {(clientIsActive || presale.isPending) && !showFinalize && (
              <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6">
                <h3 className="text-white font-semibold text-sm mb-4">Contribute</h3>

                {presale.isPending && (
                  <div className="bg-[#D4AF37]/10 border border-[#D4AF37]/20 rounded-xl px-3 py-2 mb-4">
                    <p className="text-[#D4AF37] text-xs">Presale starts {formatDate(presale.startTimeMs)}</p>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-gray-400 text-xs font-medium mb-1.5">Amount (SUI)</label>
                    <input
                      type="number"
                      value={contributeAmount}
                      onChange={(e) => setContributeAmount(e.target.value)}
                      placeholder="0.0"
                      step="0.1"
                      className="w-full px-3 py-3 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-lg focus:outline-none focus:border-[#D4AF37]/40"
                    />
                    {presale.maxPerWalletMist > 0 && (
                      <p className="text-gray-600 text-[10px] mt-1">
                        Max per wallet: {formatSui(presale.maxPerWalletMist)} SUI
                      </p>
                    )}
                  </div>

                  {/* Estimated tokens */}
                  <div className="bg-[#07070e] rounded-xl p-3">
                    <p className="text-gray-500 text-xs mb-0.5">You receive (estimated)</p>
                    <p className="text-white font-semibold">
                      {Number(estimatedTokens).toLocaleString()} <span className="text-gray-500 text-sm">${presale.symbol}</span>
                    </p>
                  </div>

                  {!connected ? (
                    <ConnectButton />
                  ) : (
                    <button
                      onClick={handleContribute}
                      disabled={actionLoading || !clientIsActive || !contributeAmount || parseFloat(contributeAmount) <= 0}
                      className="w-full py-3 rounded-xl bg-[#D4AF37] text-black font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {actionLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>Contribute SUI</>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Finalize Panel (presale filled or time expired) */}
            {showFinalize && (
              <div className="bg-[#0d0f1a] border border-[#D4AF37]/20 rounded-2xl p-6">
                <h3 className="text-[#D4AF37] font-semibold text-sm mb-3">
                  {isFilled && !timeExpired ? 'Presale Filled' : 'Presale Ended'}
                </h3>
                <p className="text-gray-400 text-xs mb-4">
                  {isFilled && !timeExpired
                    ? 'Max raise reached! Finalize to settle the presale and enable token claims.'
                    : 'The presale window has closed. Finalize to settle the presale.'}
                </p>
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Raised</span>
                    <span className="text-white font-medium">{formatSui(presale.totalRaisedMist)} / {formatSui(presale.maxRaiseMist)} SUI</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Min Required</span>
                    <span className="text-white font-medium">{formatSui(presale.minRaiseMist)} SUI</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Result</span>
                    <span className={presale.totalRaisedMist >= presale.minRaiseMist ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
                      {presale.totalRaisedMist >= presale.minRaiseMist ? 'Success' : 'Failed'}
                    </span>
                  </div>
                </div>
                {!connected ? (
                  <ConnectButton />
                ) : (
                  <button
                    onClick={handleFinalize}
                    disabled={actionLoading}
                    className="w-full py-3 rounded-xl bg-[#D4AF37] text-black font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Finalize Presale</>}
                  </button>
                )}
              </div>
            )}

            {/* Claim Panel (success or migrated — contributors can always claim) */}
            {(presale.isSuccess || presale.isMigrated) && (
              <div className="bg-[#0d0f1a] border border-emerald-500/20 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  {presale.isMigrated && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                  <h3 className="text-emerald-400 font-semibold text-sm">
                    {presale.isMigrated ? 'Presale Complete — Claim Tokens' : 'Claim Tokens'}
                  </h3>
                </div>
                {presale.isMigrated && (
                  <p className="text-gray-500 text-xs mb-4">
                    This presale has migrated to Momentum DEX. Claim your tokens below, then trade on DEX.
                  </p>
                )}
                <div className="space-y-3">
                  {userContribution > 0 && (
                    <>
                      <div className="bg-[#07070e] rounded-xl p-3">
                        <p className="text-gray-500 text-xs mb-0.5">Your contribution</p>
                        <p className="text-white font-semibold">{userContributionSui.toFixed(4)} SUI</p>
                      </div>
                      <div className="bg-[#07070e] rounded-xl p-3">
                        <p className="text-gray-500 text-xs mb-0.5">Tokens to claim</p>
                        <p className="text-white font-semibold">
                          {Number(userEstimatedTokens).toLocaleString()} <span className="text-gray-500">${presale.symbol}</span>
                        </p>
                      </div>
                    </>
                  )}
                  {!connected ? (
                    <div>
                      <p className="text-gray-400 text-xs mb-3">Connect your wallet to claim tokens.</p>
                      <ConnectButton />
                    </div>
                  ) : (
                    <button
                      onClick={handleClaim}
                      disabled={actionLoading}
                      className="w-full py-3 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Claim Tokens</>}
                    </button>
                  )}
                  {presale.isMigrated && presale.tokenType && (
                    <a
                      href={`https://app.mmt.finance/trade?coinTypeA=0x2::sui::SUI&coinTypeB=${encodeURIComponent(presale.tokenType)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[#D4AF37] text-sm font-medium hover:opacity-80 transition-opacity"
                    >
                      Trade on Momentum DEX →
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Retry Pool Creation (collapsed by default — for edge cases only) */}
            {presale.isMigrated && (
              <div>
                <button
                  onClick={() => setShowRetryPool(v => !v)}
                  className="text-gray-600 text-xs hover:text-gray-400 transition-colors"
                >
                  {showRetryPool ? 'Hide' : 'Token not on Momentum yet?'}
                </button>
                {showRetryPool && (
                  <div className="mt-2 bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-4">
                    <button
                      onClick={async () => {
                        setGraduateLoading(true)
                        setGraduateMsg('Creating Momentum pool...')
                        setGraduateType('info')
                        try {
                          const res = await fetch(`/api/presale/${presaleId}/create-pool`, { method: 'POST' })
                          const data = await res.json()
                          if (!res.ok) {
                            setGraduateMsg(data.error || 'Pool creation failed')
                            setGraduateType('error')
                          } else {
                            setGraduateMsg(`Pool created! ID: ${data.poolId || 'see Momentum DEX'}`)
                            setGraduateType('success')
                          }
                        } catch (e: any) {
                          setGraduateMsg(e.message || 'Request failed')
                          setGraduateType('error')
                        } finally {
                          setGraduateLoading(false)
                        }
                      }}
                      disabled={graduateLoading}
                      className="w-full py-2.5 rounded-xl bg-white/[0.06] text-gray-300 text-sm font-medium hover:bg-white/[0.1] transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                    >
                      {graduateLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Retry Pool Creation</>}
                    </button>
                    {graduateMsg && (
                      <p className={`mt-2 text-xs ${
                        graduateType === 'error' ? 'text-red-400' :
                        graduateType === 'success' ? 'text-emerald-400' : 'text-[#D4AF37]'
                      }`}>{graduateMsg}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Release Team Tokens (migrated + cliff passed + tokens remain) */}
            {presale.isMigrated && presale.teamBps > 0 && presale.teamCliffMs > 0 && presale.teamTokenSupply > 0 && now >= presale.teamCliffMs && (
              <div className="bg-[#0d0f1a] border border-purple-500/20 rounded-2xl p-6">
                <h3 className="text-purple-400 font-semibold text-sm mb-3">Release Team Tokens</h3>
                <div className="space-y-3">
                  <p className="text-gray-400 text-xs">
                    Team tokens are unlocked and ready to release. Anyone can call this — tokens always go directly to the team wallet.
                  </p>
                  <div className="bg-[#07070e] rounded-xl p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Locked balance</span>
                      <span className="text-white font-medium">{presale.teamTokenSupply.toLocaleString()} {presale.symbol}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Team wallet</span>
                      <span className="text-gray-300 font-mono">{presale.teamWallet.slice(0, 8)}...{presale.teamWallet.slice(-4)}</span>
                    </div>
                    {presale.teamVestingEndMs > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">Fully vested</span>
                        <span className="text-gray-300">{formatDate(presale.teamVestingEndMs)}</span>
                      </div>
                    )}
                  </div>
                  {!connected ? (
                    <ConnectButton />
                  ) : (
                    <button
                      onClick={handleReleaseTeam}
                      disabled={actionLoading}
                      className="w-full py-3 rounded-xl bg-purple-500 text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Release Team Tokens</>}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Migration Panel (successful but not yet migrated) */}
            {presale.isSuccess && !presale.isMigrated && (
              <div className="bg-[#0d0f1a] border border-blue-500/20 rounded-2xl p-6">
                <h3 className="text-blue-400 font-semibold text-sm mb-2">DEX Migration</h3>
                <p className="text-gray-400 text-xs mb-4">
                  Liquidity is ready to be deployed on Momentum DEX. Anyone can trigger this — the admin wallet handles the on-chain transactions.
                </p>
                <button
                  onClick={handleGraduate}
                  disabled={graduateLoading}
                  className="w-full py-3 rounded-xl bg-blue-500 text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  {graduateLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>Trigger Migration</>
                  )}
                </button>
                {graduateMsg && (
                  <p className={`mt-3 text-xs ${
                    graduateType === 'error' ? 'text-red-400' :
                    graduateType === 'success' ? 'text-emerald-400' :
                    'text-[#D4AF37]'
                  }`}>
                    {graduateMsg}
                  </p>
                )}
              </div>
            )}

            {/* Refund Panel (failed presale) */}
            {presale.isFailed && (
              <div className="bg-[#0d0f1a] border border-red-500/20 rounded-2xl p-6">
                <h3 className="text-red-400 font-semibold text-sm mb-4">Refund</h3>
                <div className="space-y-3">
                  {userContribution > 0 && (
                    <div className="bg-[#07070e] rounded-xl p-3">
                      <p className="text-gray-500 text-xs mb-0.5">Your contribution</p>
                      <p className="text-white font-semibold">{userContributionSui.toFixed(4)} SUI</p>
                    </div>
                  )}
                  {!connected ? (
                    <div>
                      <p className="text-gray-400 text-xs mb-3">Connect your wallet to request a refund.</p>
                      <ConnectButton />
                    </div>
                  ) : (
                    <button
                      onClick={handleRefund}
                      disabled={actionLoading}
                      className="w-full py-3 rounded-xl bg-red-500 text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Refund SUI</>}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Refund Panel (cancelled presale) */}
            {presale.isCancelled && (
              <div className="bg-[#0d0f1a] border border-red-500/20 rounded-2xl p-6">
                <h3 className="text-red-400 font-semibold text-sm mb-4">Refund</h3>
                <div className="space-y-3">
                  {userContribution > 0 && (
                    <div className="bg-[#07070e] rounded-xl p-3">
                      <p className="text-gray-500 text-xs mb-0.5">Your contribution</p>
                      <p className="text-white font-semibold">{userContributionSui.toFixed(4)} SUI</p>
                    </div>
                  )}
                  {!connected ? (
                    <div>
                      <p className="text-gray-400 text-xs mb-3">Connect your wallet to request a refund.</p>
                      <ConnectButton />
                    </div>
                  ) : (
                    <button
                      onClick={handleRefund}
                      disabled={actionLoading}
                      className="w-full py-3 rounded-xl bg-red-500 text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Refund SUI</>}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Admin Cancel Panel */}
            {isAdmin && (presale.isActive || presale.isPending) && !presale.isCancelled && (
              <div className="bg-[#0d0f1a] border border-red-500/10 rounded-2xl p-6">
                <h3 className="text-red-400 font-semibold text-sm mb-2">Admin: Cancel Presale</h3>
                <p className="text-gray-500 text-xs mb-4">
                  Cancel this presale early. Contributors will be able to refund their SUI.
                </p>
                {!connected ? (
                  <ConnectButton />
                ) : (
                  <button
                    onClick={handleCancel}
                    disabled={actionLoading}
                    className="w-full py-2.5 rounded-xl border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Cancel Presale</>}
                  </button>
                )}
              </div>
            )}

            {/* Your Position (always show if contributed) */}
            {userContribution > 0 && (
              <div className="bg-[#0d0f1a] border border-[#D4AF37]/20 rounded-2xl p-6">
                <h3 className="text-[#D4AF37] font-semibold text-sm mb-3">Your Position</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Contributed</span>
                    <span className="text-white font-medium">{userContributionSui.toFixed(4)} SUI</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Est. tokens</span>
                    <span className="text-white font-medium">{Number(userEstimatedTokens).toLocaleString()} ${presale.symbol}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Share of raise</span>
                    <span className="text-white font-medium">
                      {presale.totalRaisedMist > 0 ? ((userContribution / presale.totalRaisedMist) * 100).toFixed(2) : '0'}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Action Message */}
            {actionMsg && (
              <div className={`px-4 py-3 rounded-xl text-sm ${
                actionType === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                actionType === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20'
              }`}>
                {actionMsg}
              </div>
            )}

            {/* Presale Info */}
            <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6">
              <h3 className="text-white font-semibold text-sm mb-3">Presale Info</h3>
              <div className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Creator</span>
                  <span className="text-gray-300 font-mono text-xs">{presale.creator.slice(0, 8)}...{presale.creator.slice(-4)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Token Price</span>
                  <span className="text-white">{presale.pricePerTokenSui.toFixed(6)} SUI</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Raise Range</span>
                  <span className="text-white">{formatSui(presale.minRaiseMist)} – {formatSui(presale.maxRaiseMist)} SUI</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Start</span>
                  <span className="text-white">{formatDate(presale.startTimeMs)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">End</span>
                  <span className="text-white">{formatDate(presale.endTimeMs)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Platform Fee</span>
                  <span className="text-white">2%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">DEX Migration</span>
                  <span className="text-[#D4AF37]">Momentum</span>
                </div>
                {presale.tokenType && (
                  <div className="pt-2 border-t border-white/[0.06]">
                    <p className="text-gray-500 text-xs mb-1">Token Contract</p>
                    <button
                      onClick={() => copyAddress(presale.tokenType)}
                      className="flex items-center gap-1.5 text-gray-300 font-mono text-[10px] hover:text-white transition-colors break-all text-left"
                    >
                      {copied ? <Check className="w-3 h-3 shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
                      {presale.tokenType}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Contributors */}
            {contributors.length > 0 && (
              <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6">
                <h3 className="text-white font-semibold text-sm mb-3 flex items-center justify-between">
                  Contributors
                  <span className="text-gray-500 font-normal text-xs">{contributors.length} wallets</span>
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {contributors.map((c, i) => (
                    <div key={c.address} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600 w-4 shrink-0">{i + 1}</span>
                        <button
                          onClick={() => { navigator.clipboard.writeText(c.address) }}
                          className="font-mono text-gray-300 hover:text-white transition-colors"
                          title={c.address}
                        >
                          {c.address.slice(0, 6)}...{c.address.slice(-4)}
                        </button>
                      </div>
                      <div className="text-right">
                        <span className="text-white font-medium">{(c.amount / 1e9).toFixed(2)} SUI</span>
                        {presale && presale.totalRaisedMist > 0 && (
                          <span className="text-gray-500 ml-1.5">
                            {((c.amount / presale.totalRaisedMist) * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
