'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentWallet, useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { ConnectButton } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { Rocket, Upload, Globe, Twitter, MessageCircle, Loader2, CheckCircle, Clock, Users, TrendingUp, ArrowLeft, Info } from 'lucide-react'
import axios from 'axios'
import Link from 'next/link'
import { getCoinModuleBytes, extractPublishResult } from '@/lib/coinPublish'

// ── Constants ─────────────────────────────────────────────────
const PRESALE_PACKAGE_ID = (process.env.NEXT_PUBLIC_PRESALE_PACKAGE_ID || '0x4c9f2fe6a524873adea66ff6f31d6caba0df10d10ffd8b28e99d0b8e26eabc76').trim()
const PRESALE_CONFIG_ID = (process.env.NEXT_PUBLIC_PRESALE_CONFIG_ID || '0xa81d4889856be45bb6ca6b6dc47891a3aa259076052cf5182577aba060f88660').trim()

const TOKEN_DECIMALS = 6
const DEFAULT_TOTAL_SUPPLY = 1_000_000_000  // 1B tokens
const PRESALE_CREATION_FEE_MIST = BigInt(20_000_000_000) // 20 SUI
const ADMIN_ADDRESS = '0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409'

// ── ASCII sanitizer (same as bonding curve create) ────────────
function toAscii(input: string, maxLen: number): string {
  if (!input) return ''
  const transliterated = input
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2022\u2023\u25E6]/g, '*')
  const ascii = transliterated.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
  return ascii.slice(0, maxLen)
}

function formatNumber(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toString()
}

export default function CreatePresalePage() {
  const router = useRouter()
  const { isConnected: connected } = useCurrentWallet()
  const account = useCurrentAccount()
  const isAdmin = account?.address?.toLowerCase() === ADMIN_ADDRESS.toLowerCase()
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction()
  const suiClient = useSuiClient()

  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info')
  const [image, setImage] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [launched, setLaunched] = useState(false)
  const [presaleId, setPresaleId] = useState('')
  const [step, setStep] = useState<1 | 2>(1) // Step 1: Token info, Step 2: Presale params

  const [formData, setFormData] = useState({
    name: '',
    ticker: '',
    description: '',
    twitter: '',
    telegram: '',
    website: '',
  })

  const [presaleParams, setPresaleParams] = useState({
    totalSupply: DEFAULT_TOTAL_SUPPLY.toString(),
    pricePerToken: '0.001',        // SUI per token
    minRaise: '100',               // SUI
    maxRaise: '500',               // SUI
    maxPerWallet: '10',            // SUI (0 = unlimited)
    durationHours: '48',           // hours
    startDate: '',                 // ISO date string (empty = starts immediately)
    presalePercent: '60',          // % of supply for presale
    liquidityPercent: '20',        // % for DEX liquidity
    teamPercent: '0',              // % for team (0 = no team allocation)
    teamWallet: '',                // beneficiary address for team tokens
    teamCliffDate: '',             // ISO datetime — empty = no lock (send directly)
    teamVestingEndDate: '',        // ISO datetime — empty = cliff only (no linear vesting)
    creatorCliffDate: '',          // ISO datetime — empty = no lock (send directly to creator)
    creatorVestingEndDate: '',     // ISO datetime — empty = cliff only
    creatorSuiPercent: '0',        // % of raised SUI sent to creator wallet at migration (0–50)
    // creator gets remainder of token supply
    creatorX: '',                  // Optional: the CREATOR's personal X/Twitter profile (not the project's).
                                   // Stored off-chain (KV), not in the Move contract.
  })

  const set = (field: string, value: string) =>
    setFormData(prev => ({ ...prev, [field]: value }))

  const setParam = (field: string, value: string) =>
    setPresaleParams(prev => ({ ...prev, [field]: value }))

  // Computed values
  const totalSupply = Number(presaleParams.totalSupply) || 0
  const pricePerToken = Number(presaleParams.pricePerToken) || 0
  const presalePct = Number(presaleParams.presalePercent) || 0
  const liqPct = Number(presaleParams.liquidityPercent) || 0
  const teamPct = Number(presaleParams.teamPercent) || 0
  const creatorPct = Math.max(0, 100 - presalePct - liqPct - teamPct)
  const presaleTokens = totalSupply * (presalePct / 100)
  const liquidityTokens = totalSupply * (liqPct / 100)
  const teamTokens = totalSupply * (teamPct / 100)
  const creatorTokens = totalSupply * (creatorPct / 100)
  const maxRaise = Number(presaleParams.maxRaise) || 0
  const minRaise = Number(presaleParams.minRaise) || 0
  const tokensPerSui = pricePerToken > 0 ? 1 / pricePerToken : 0

  const creatorSuiPct = Math.min(50, Math.max(0, Number(presaleParams.creatorSuiPercent) || 0))
  const liqSuiPct = 100 - creatorSuiPct
  // At max raise: how much SUI goes where
  const creatorSuiAtMax = maxRaise * (creatorSuiPct / 100)
  const liqSuiAtMax = maxRaise * (liqSuiPct / 100)

  const isValidSplit = presalePct + liqPct + teamPct <= 100 && presalePct > 0
  const teamWalletValid = teamPct === 0 || (presaleParams.teamWallet.trim().startsWith('0x') && presaleParams.teamWallet.trim().length > 10)
  const isStep1Valid = formData.name.trim() && formData.ticker.trim()
  const MIN_RAISE_SUI = 100
  const isStep2Valid = isValidSplit && teamWalletValid && pricePerToken > 0 && maxRaise >= minRaise && minRaise >= MIN_RAISE_SUI && Number(presaleParams.durationHours) > 0

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => setImage(reader.result as string)
    reader.readAsDataURL(file)

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('upload_preset', 'launchpad')
      fd.append('folder', 'launchpad')
      const res = await axios.post('https://api.cloudinary.com/v1_1/dtgdfntom/image/upload', fd)
      setImageUrl(res.data.secure_url)
    } catch {
      setStatusMsg('Image upload failed — presale will use placeholder')
      setStatusType('error')
    }
  }

  async function handleCreate() {
    if (!connected || !PRESALE_PACKAGE_ID) {
      if (!PRESALE_PACKAGE_ID) {
        setStatusMsg('Presale contract not yet deployed. Coming soon!')
        setStatusType('error')
      }
      return
    }

    if (minRaise < 100) {
      setStatusMsg('Min Raise must be at least 100 SUI')
      setStatusType('error')
      return
    }

    setLoading(true)
    setStatusMsg('Publishing coin module...')
    setStatusType('info')

    try {
      // Step 1: Publish the coin module (same as bonding curve)
      const name = toAscii(formData.name, 100).trim()
      const symbol = toAscii(formData.ticker, 10).toUpperCase().trim()
      const description = toAscii(formData.description, 1000).trim()
      const uri = toAscii(imageUrl, 300).trim()
      const twitter = toAscii(formData.twitter, 500)
      const telegram = toAscii(formData.telegram, 500)
      const website = toAscii(formData.website, 500)

      const moduleBytes = await getCoinModuleBytes(symbol)
      const publishTx = new Transaction()
      const [upgradeCap] = publishTx.publish({ modules: [Array.from(moduleBytes)], dependencies: ['0x1', '0x2'] })
      publishTx.moveCall({ target: '0x2::package::make_immutable', arguments: [upgradeCap] })

      setStatusMsg('Sign transaction to publish coin...')
      const publishResult = await signAndExecuteTransaction({
        transaction: publishTx as any,
        chain: 'sui:mainnet',
      })

      // Wait for the transaction to be indexed and get object changes
      const txResponse = await suiClient.waitForTransaction({
        digest: publishResult.digest,
        options: { showObjectChanges: true },
      })
      const objectChanges = txResponse.objectChanges || []
      const extracted = extractPublishResult(objectChanges, symbol)
      if (!extracted) {
        throw new Error('Failed to extract coin publish result — check transaction on explorer')
      }

      setStatusMsg('Coin published! Creating presale...')

      // Step 2: Create the presale
      const totalSupplyBase = BigInt(totalSupply) * BigInt(10 ** TOKEN_DECIMALS)
      const pricePerTokenMist = BigInt(Math.round(pricePerToken * 1e9))
      const minRaiseMist = BigInt(Math.round(minRaise * 1e9))
      const maxRaiseMist = BigInt(Math.round(maxRaise * 1e9))
      const maxPerWalletMist = BigInt(Math.round(Number(presaleParams.maxPerWallet) * 1e9))
      const durationMs = BigInt(Math.round(Number(presaleParams.durationHours) * 60 * 60 * 1000))
      const nowMs = BigInt(Date.now())
      const startTimeMs = presaleParams.startDate
        ? BigInt(new Date(presaleParams.startDate).getTime())
        : nowMs + BigInt(60_000)
      const endTimeMs = startTimeMs + durationMs
      const presaleBps = BigInt(presalePct * 100)
      const liquidityBps = BigInt(liqPct * 100)
      const teamBps = BigInt(teamPct * 100)
      const teamWalletAddr = presaleParams.teamWallet.trim() || '0x0000000000000000000000000000000000000000000000000000000000000000'
      const teamCliffMs = presaleParams.teamCliffDate
        ? BigInt(new Date(presaleParams.teamCliffDate).getTime())
        : 0n
      const teamVestingEndMs = presaleParams.teamVestingEndDate
        ? BigInt(new Date(presaleParams.teamVestingEndDate).getTime())
        : 0n
      const creatorCliffMs = presaleParams.creatorCliffDate
        ? BigInt(new Date(presaleParams.creatorCliffDate).getTime())
        : 0n
      const creatorVestingEndMs = presaleParams.creatorVestingEndDate
        ? BigInt(new Date(presaleParams.creatorVestingEndDate).getTime())
        : 0n
      const creatorSuiBps = BigInt(Math.round(creatorSuiPct * 100))

      const tx = new Transaction()

      // Creation fee — admin wallet is exempt (pass zero coin)
      const creationFee = isAdmin
        ? tx.moveCall({ target: '0x2::coin::zero', typeArguments: ['0x2::sui::SUI'], arguments: [] })
        : tx.splitCoins(tx.gas, [tx.pure.u64(PRESALE_CREATION_FEE_MIST)])[0]

      tx.moveCall({
        target: `${PRESALE_PACKAGE_ID}::presale::create_presale`,
        typeArguments: [extracted.coinType],
        arguments: [
          tx.object(process.env.NEXT_PUBLIC_PRESALE_CONFIG_ID || '0x7cf0df658bc8fb7b4ecbb95c75141e9635d1c9fabdef97c63934853534eb052b'), // PresaleConfig
          tx.object(extracted.treasuryCapId),
          tx.object(extracted.metadataId),
          creationFee,
          tx.pure.u64(totalSupplyBase),
          tx.pure.u64(pricePerTokenMist),
          tx.pure.u64(minRaiseMist),
          tx.pure.u64(maxRaiseMist),
          tx.pure.u64(maxPerWalletMist),
          tx.pure.u64(startTimeMs),
          tx.pure.u64(endTimeMs),
          tx.pure.u64(presaleBps),
          tx.pure.u64(liquidityBps),
          tx.pure.u64(teamBps),
          tx.pure.address(teamWalletAddr),
          tx.pure.u64(teamCliffMs),
          tx.pure.u64(teamVestingEndMs),
          tx.pure.u64(creatorCliffMs),
          tx.pure.u64(creatorVestingEndMs),
          tx.pure.u64(creatorSuiBps),
          tx.pure.u8(TOKEN_DECIMALS),
          tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'), // Clock
          tx.pure(bcs.string().serialize(name).toBytes()),
          tx.pure(bcs.string().serialize(symbol).toBytes()),
          tx.pure(bcs.string().serialize(uri).toBytes()),
          tx.pure(bcs.string().serialize(description).toBytes()),
          tx.pure(bcs.string().serialize(twitter).toBytes()),
          tx.pure(bcs.string().serialize(telegram).toBytes()),
          tx.pure(bcs.string().serialize(website).toBytes()),
        ],
      })

      setStatusMsg('Sign transaction to create presale...')
      const result = await signAndExecuteTransaction({
        transaction: tx as any,
        chain: 'sui:mainnet',
      })

      // Wait for indexing and extract presale ID
      const txResult = await suiClient.waitForTransaction({
        digest: result.digest,
        options: { showObjectChanges: true },
      })
      const presaleObj = (txResult.objectChanges || []).find(
        (c: any) => c.type === 'created' && c.objectType?.includes('::presale::Presale<')
      )

      const newPresaleId = (presaleObj as any)?.objectId || ''
      setPresaleId(newPresaleId)

      // Stash the creator's X handle off-chain (the Move struct has no field for it).
      const creatorXTrimmed = presaleParams.creatorX.trim()
      if (newPresaleId && creatorXTrimmed) {
        fetch(`/api/presale/${newPresaleId}/creator-profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorX: creatorXTrimmed, creator: account?.address }),
        }).catch(() => {})
      }

      setLaunched(true)
      setStatusMsg('Presale created successfully!')
      setStatusType('success')
    } catch (e: any) {
      console.error('Presale creation failed:', e)
      setStatusMsg(e.message || 'Failed to create presale')
      setStatusType('error')
    } finally {
      setLoading(false)
    }
  }

  if (launched) {
    return (
      <div className="min-h-screen bg-[#07070e] pt-20 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Presale Created!</h2>
          <p className="text-gray-400 text-sm mb-6">
            Your presale on Olympus is now live. Contributors can start participating once the start time arrives.
          </p>
          {presaleId && (
            <Link
              href={`/olympus/${presaleId}`}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#D4AF37] text-black font-semibold text-sm hover:opacity-90 transition-all"
            >
              View Presale
              <TrendingUp className="w-4 h-4" />
            </Link>
          )}
          <div className="mt-4">
            <Link href="/olympus" className="text-gray-500 text-sm hover:text-white transition-colors">
              Back to Olympus
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#07070e] pt-20 pb-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">

        {/* Back Link */}
        <Link href="/olympus" className="inline-flex items-center gap-1.5 text-gray-500 text-sm hover:text-white transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" />
          Back to Olympus
        </Link>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Create Presale</h1>
          <p className="text-gray-500 text-sm">
            Launch your token on Olympus. Set a fixed price, raise SUI, and auto-migrate to Momentum DEX.
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-3 mb-8">
          {[
            { num: 1, label: 'Token Info' },
            { num: 2, label: 'Presale Config' },
          ].map((s) => (
            <button
              key={s.num}
              onClick={() => s.num === 1 ? setStep(1) : (isStep1Valid ? setStep(2) : null)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                step === s.num
                  ? 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30'
                  : step > s.num
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-[#0d0f1a] text-gray-500 border border-white/[0.06]'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">
                {step > s.num ? '✓' : s.num}
              </span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Step 1: Token Info */}
        {step === 1 && (
          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-400 text-xs font-medium mb-1.5">Token Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Olympus AI"
                  className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-xs font-medium mb-1.5">Ticker Symbol *</label>
                <input
                  type="text"
                  value={formData.ticker}
                  onChange={(e) => set('ticker', e.target.value.toUpperCase())}
                  placeholder="e.g. OLYMP"
                  maxLength={10}
                  className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-400 text-xs font-medium mb-1.5">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="What's your project about?"
                rows={3}
                className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40 resize-none"
              />
            </div>

            {/* Image Upload */}
            <div>
              <label className="block text-gray-400 text-xs font-medium mb-1.5">Token Image</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 px-4 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-gray-400 text-sm cursor-pointer hover:border-[#D4AF37]/30 transition-colors">
                  <Upload className="w-4 h-4" />
                  Upload
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
                {image && (
                  <img src={image} alt="preview" className="w-10 h-10 rounded-lg object-cover border border-white/[0.06]" />
                )}
              </div>
            </div>

            {/* Socials */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="relative">
                <Twitter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <input
                  type="text"
                  value={formData.twitter}
                  onChange={(e) => set('twitter', e.target.value)}
                  placeholder="Twitter URL"
                  className="w-full pl-9 pr-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40"
                />
              </div>
              <div className="relative">
                <MessageCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <input
                  type="text"
                  value={formData.telegram}
                  onChange={(e) => set('telegram', e.target.value)}
                  placeholder="Telegram URL"
                  className="w-full pl-9 pr-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40"
                />
              </div>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <input
                  type="text"
                  value={formData.website}
                  onChange={(e) => set('website', e.target.value)}
                  placeholder="Website URL"
                  className="w-full pl-9 pr-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40"
                />
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!isStep1Valid}
              className="w-full py-3 rounded-xl bg-[#D4AF37] text-black font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next: Presale Configuration
            </button>
          </div>
        )}

        {/* Step 2: Presale Config */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 space-y-5">
              <h3 className="text-white font-semibold text-sm">Presale Parameters</h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-xs font-medium mb-1.5">Total Supply</label>
                  <input
                    type="number"
                    value={presaleParams.totalSupply}
                    onChange={(e) => setParam('totalSupply', e.target.value)}
                    className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs font-medium mb-1.5">Price per Token (SUI)</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={presaleParams.pricePerToken}
                    onChange={(e) => setParam('pricePerToken', e.target.value)}
                    className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-xs font-medium mb-1.5">Min Raise (SUI)</label>
                  <input
                    type="number"
                    min={100}
                    value={presaleParams.minRaise}
                    onChange={(e) => setParam('minRaise', e.target.value)}
                    className={`w-full px-3 py-2.5 bg-[#07070e] border rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40 ${
                      minRaise > 0 && minRaise < 100 ? 'border-red-500/50' : 'border-white/[0.06]'
                    }`}
                  />
                  {minRaise > 0 && minRaise < 100 && (
                    <p className="text-red-400 text-[10px] mt-1">Minimum 100 SUI</p>
                  )}
                </div>
                <div>
                  <label className="block text-gray-400 text-xs font-medium mb-1.5">Max Raise (SUI)</label>
                  <input
                    type="number"
                    value={presaleParams.maxRaise}
                    onChange={(e) => setParam('maxRaise', e.target.value)}
                    className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-xs font-medium mb-1.5">Max per Wallet (SUI)</label>
                  <input
                    type="number"
                    value={presaleParams.maxPerWallet}
                    onChange={(e) => setParam('maxPerWallet', e.target.value)}
                    placeholder="0 = unlimited"
                    className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs font-medium mb-1.5">Duration (hours)</label>
                  <input
                    type="number"
                    value={presaleParams.durationHours}
                    onChange={(e) => setParam('durationHours', e.target.value)}
                    className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-400 text-xs font-medium mb-1.5">Start Date & Time</label>
                <input
                  type="datetime-local"
                  value={presaleParams.startDate}
                  onChange={(e) => setParam('startDate', e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40 [color-scheme:dark]"
                />
                <p className="text-gray-600 text-[10px] mt-1">Leave empty to start immediately after creation</p>
              </div>

              {/* Token Distribution */}
              <div>
                <h4 className="text-gray-400 text-xs font-medium mb-3">Token Distribution</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-gray-500 text-[10px] mb-1">Presale %</label>
                    <input
                      type="number"
                      value={presaleParams.presalePercent}
                      onChange={(e) => setParam('presalePercent', e.target.value)}
                      min={1} max={100}
                      className="w-full px-3 py-2 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-500 text-[10px] mb-1">Liquidity %</label>
                    <input
                      type="number"
                      value={presaleParams.liquidityPercent}
                      onChange={(e) => setParam('liquidityPercent', e.target.value)}
                      min={0} max={100}
                      className="w-full px-3 py-2 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-500 text-[10px] mb-1">Team %</label>
                    <input
                      type="number"
                      value={presaleParams.teamPercent}
                      onChange={(e) => setParam('teamPercent', e.target.value)}
                      min={0} max={50}
                      className="w-full px-3 py-2 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-500 text-[10px] mb-1">Creator % (auto)</label>
                    <div className="w-full px-3 py-2 bg-[#07070e] border border-white/[0.06] rounded-xl text-[#D4AF37] text-sm">
                      {creatorPct.toFixed(0)}%
                    </div>
                  </div>
                </div>
                {!isValidSplit && (
                  <p className="text-red-400 text-xs mt-2">Presale + Liquidity + Team must be ≤ 100%</p>
                )}

                {/* Team vesting fields — only shown when teamPercent > 0 */}
                {teamPct > 0 && (
                  <div className="mt-4 space-y-3 border border-white/[0.06] rounded-xl p-4">
                    <p className="text-gray-400 text-xs font-medium">Team Vesting</p>
                    <div>
                      <label className="block text-gray-500 text-[10px] mb-1">Team Wallet Address *</label>
                      <input
                        type="text"
                        value={presaleParams.teamWallet}
                        onChange={(e) => setParam('teamWallet', e.target.value)}
                        placeholder="0x..."
                        className={`w-full px-3 py-2 bg-[#07070e] border rounded-xl text-white text-sm font-mono focus:outline-none focus:border-[#D4AF37]/40 ${!teamWalletValid && presaleParams.teamWallet ? 'border-red-500/50' : 'border-white/[0.06]'}`}
                      />
                      <p className="text-gray-600 text-[10px] mt-1">Tokens go to this address. Leave cliff empty to send immediately at graduation.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-gray-500 text-[10px] mb-1">Cliff Date (optional)</label>
                        <input
                          type="datetime-local"
                          value={presaleParams.teamCliffDate}
                          onChange={(e) => setParam('teamCliffDate', e.target.value)}
                          min={new Date().toISOString().slice(0, 16)}
                          className="w-full px-3 py-2 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40 [color-scheme:dark]"
                        />
                        <p className="text-gray-600 text-[10px] mt-1">No unlock before this date</p>
                      </div>
                      <div>
                        <label className="block text-gray-500 text-[10px] mb-1">Vesting End (optional)</label>
                        <input
                          type="datetime-local"
                          value={presaleParams.teamVestingEndDate}
                          onChange={(e) => setParam('teamVestingEndDate', e.target.value)}
                          min={presaleParams.teamCliffDate || new Date().toISOString().slice(0, 16)}
                          className="w-full px-3 py-2 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40 [color-scheme:dark]"
                        />
                        <p className="text-gray-600 text-[10px] mt-1">Linear vesting from cliff to this date</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Creator lock */}
                <div className="mt-3 bg-[#07070e] border border-white/[0.06] rounded-xl p-4 space-y-3">
                  <div>
                    <p className="text-white text-xs font-medium mb-0.5">Creator Token Lock <span className="text-gray-600 font-normal">(optional)</span></p>
                    <p className="text-gray-600 text-[10px]">Lock your creator allocation with a cliff and/or linear vesting. Leave empty to receive immediately at graduation.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gray-500 text-[10px] mb-1">Cliff Date</label>
                      <input
                        type="datetime-local"
                        value={presaleParams.creatorCliffDate}
                        onChange={(e) => setParam('creatorCliffDate', e.target.value)}
                        min={new Date().toISOString().slice(0, 16)}
                        className="w-full px-3 py-2 bg-[#0d0f1a] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40 [color-scheme:dark]"
                      />
                      <p className="text-gray-600 text-[10px] mt-1">No unlock before this date</p>
                    </div>
                    <div>
                      <label className="block text-gray-500 text-[10px] mb-1">Vesting End</label>
                      <input
                        type="datetime-local"
                        value={presaleParams.creatorVestingEndDate}
                        onChange={(e) => setParam('creatorVestingEndDate', e.target.value)}
                        min={presaleParams.creatorCliffDate || new Date().toISOString().slice(0, 16)}
                        disabled={!presaleParams.creatorCliffDate}
                        className="w-full px-3 py-2 bg-[#0d0f1a] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40 [color-scheme:dark] disabled:opacity-40"
                      />
                      <p className="text-gray-600 text-[10px] mt-1">Linear vesting from cliff to here</p>
                    </div>
                  </div>
                </div>

                {/* Raised SUI split */}
                <div className="mt-3 bg-[#07070e] border border-white/[0.06] rounded-xl p-4 space-y-3">
                  <div>
                    <p className="text-white text-xs font-medium mb-0.5">Raised SUI Allocation <span className="text-gray-600 font-normal">(optional)</span></p>
                    <p className="text-gray-600 text-[10px]">Choose what % of raised SUI goes to your wallet at graduation (for marketing, development, etc.). The rest goes to the DEX liquidity pool. Max 50%.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gray-500 text-[10px] mb-1">To Your Wallet %</label>
                      <input
                        type="number"
                        value={presaleParams.creatorSuiPercent}
                        onChange={(e) => setParam('creatorSuiPercent', e.target.value)}
                        min={0} max={50} step={1}
                        placeholder="0"
                        className="w-full px-3 py-2 bg-[#0d0f1a] border border-white/[0.06] rounded-xl text-white text-sm focus:outline-none focus:border-[#D4AF37]/40"
                      />
                      <p className="text-gray-600 text-[10px] mt-1">0 = all SUI to DEX (default)</p>
                    </div>
                    <div>
                      <label className="block text-gray-500 text-[10px] mb-1">To DEX Liquidity %</label>
                      <div className="w-full px-3 py-2 bg-[#0d0f1a] border border-white/[0.06] rounded-xl text-[#D4AF37] text-sm">
                        {liqSuiPct}%
                      </div>
                      <p className="text-gray-600 text-[10px] mt-1">
                        {creatorSuiPct > 0 ? `~${creatorSuiAtMax.toFixed(1)} / ${liqSuiAtMax.toFixed(1)} SUI at max raise` : 'All raised SUI to liquidity'}
                      </p>
                    </div>
                  </div>
                  {creatorSuiPct > 0 && (
                    <div className="flex items-center gap-2 bg-[#D4AF37]/5 border border-[#D4AF37]/15 rounded-lg px-3 py-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] shrink-0" />
                      <p className="text-[#D4AF37]/70 text-[10px]">
                        At max raise: <strong className="text-[#D4AF37]">{creatorSuiAtMax.toFixed(1)} SUI</strong> to your wallet · <strong className="text-[#D4AF37]">{liqSuiAtMax.toFixed(1)} SUI</strong> to DEX pool. Investors will see this split on the presale page.
                      </p>
                    </div>
                  )}
                </div>

                {/* Always-on burn notice */}
                <div className="mt-3 flex items-center gap-2 bg-orange-500/5 border border-orange-500/10 rounded-xl px-4 py-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                  <p className="text-orange-400/80 text-[10px]">Tokens are always burned to @0x0 if the presale fails or is cancelled — no stranded supply.</p>
                </div>
              </div>
            </div>

            {/* Creator Profile (off-chain) */}
            <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 space-y-4">
              <div>
                <h3 className="text-white font-semibold text-sm">Creator Profile</h3>
                <p className="text-gray-500 text-xs mt-1">Optional. This is <span className="text-gray-300">your</span> personal profile, not the project's. Shown on the presale page so contributors know who launched it.</p>
              </div>
              <div>
                <label className="block text-gray-400 text-xs font-medium mb-1.5">Your X (Twitter) Profile</label>
                <input
                  type="text"
                  value={presaleParams.creatorX}
                  onChange={(e) => setParam('creatorX', e.target.value)}
                  placeholder="@yourhandle or https://x.com/yourhandle"
                  className="w-full px-3 py-2.5 bg-[#07070e] border border-white/[0.06] rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#D4AF37]/40"
                />
              </div>
            </div>

            {/* Preview Card */}
            <div className="bg-[#0d0f1a] border border-[#D4AF37]/20 rounded-2xl p-6">
              <h3 className="text-[#D4AF37] font-semibold text-sm mb-4 flex items-center gap-2">
                <Info className="w-4 h-4" />
                Presale Preview
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Token</p>
                  <p className="text-white font-medium">{formData.name || '—'} ({formData.ticker || '—'})</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Price</p>
                  <p className="text-white font-medium">{pricePerToken} SUI</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Raise Target</p>
                  <p className="text-white font-medium">{minRaise} – {maxRaise} SUI</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Starts</p>
                  <p className="text-white font-medium">{presaleParams.startDate ? new Date(presaleParams.startDate).toLocaleDateString() : 'Immediately'}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Presale Tokens</p>
                  <p className="text-white font-medium">{formatNumber(presaleTokens)}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Liquidity Tokens</p>
                  <p className="text-white font-medium">{formatNumber(liquidityTokens)}</p>
                </div>
                {teamPct > 0 && (
                  <div>
                    <p className="text-gray-500 text-xs">Team Tokens</p>
                    <p className="text-white font-medium">{formatNumber(teamTokens)}</p>
                  </div>
                )}
                <div>
                  <p className="text-gray-500 text-xs">Creator Tokens</p>
                  <p className="text-white font-medium">{formatNumber(creatorTokens)}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Tokens per SUI</p>
                  <p className="text-white font-medium">{formatNumber(tokensPerSui)}</p>
                </div>
                {creatorSuiPct > 0 && (
                  <div>
                    <p className="text-gray-500 text-xs">SUI to Your Wallet</p>
                    <p className="text-[#D4AF37] font-medium">{creatorSuiPct}% (~{creatorSuiAtMax.toFixed(1)} SUI)</p>
                  </div>
                )}
                <div>
                  <p className="text-gray-500 text-xs">Creation Fee</p>
                  <p className={`font-medium text-sm ${isAdmin ? 'text-emerald-400' : 'text-white'}`}>
                    {isAdmin ? 'Exempt (admin)' : '20 SUI'}
                  </p>
                </div>
              </div>

              {/* Distribution Bar */}
              <div className="mt-4">
                <div className="h-3 bg-white/[0.06] rounded-full overflow-hidden flex">
                  <div className="bg-[#D4AF37] transition-all" style={{ width: `${presalePct}%` }} />
                  <div className="bg-blue-500 transition-all" style={{ width: `${liqPct}%` }} />
                  {teamPct > 0 && <div className="bg-purple-500 transition-all" style={{ width: `${teamPct}%` }} />}
                  <div className="bg-emerald-500 transition-all" style={{ width: `${creatorPct}%` }} />
                </div>
                <div className="flex items-center justify-center flex-wrap gap-3 mt-2">
                  <span className="flex items-center gap-1 text-[10px] text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-[#D4AF37]" /> Presale {presalePct}%
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-blue-500" /> Liquidity {liqPct}%
                  </span>
                  {teamPct > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-gray-400">
                      <span className="w-2 h-2 rounded-full bg-purple-500" /> Team {teamPct}%
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[10px] text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" /> Creator {creatorPct}%
                  </span>
                </div>
              </div>
            </div>

            {/* Status Message */}
            {statusMsg && (
              <div className={`px-4 py-3 rounded-xl text-sm ${
                statusType === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                statusType === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20'
              }`}>
                {statusMsg}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-3 rounded-xl bg-[#0d0f1a] border border-white/[0.06] text-gray-400 font-medium text-sm hover:text-white hover:border-white/[0.12] transition-all"
              >
                Back
              </button>
              {!connected ? (
                <div className="flex-1">
                  <ConnectButton />
                </div>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={loading || !isStep2Valid || !PRESALE_PACKAGE_ID}
                  className="flex-1 py-3 rounded-xl bg-[#D4AF37] text-black font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {statusMsg || 'Creating...'}
                    </>
                  ) : !PRESALE_PACKAGE_ID ? (
                    'Contract Not Deployed Yet'
                  ) : (
                    <>
                      <Rocket className="w-4 h-4" />
                      Launch Presale on Olympus
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
