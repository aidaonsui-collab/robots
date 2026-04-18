'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentWallet, useSuiClient } from '@mysten/dapp-kit'
import { ConnectButton } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { Rocket, Upload, Globe, Twitter, MessageCircle, Video, Loader2, CheckCircle } from 'lucide-react'
import axios from 'axios'
import { MOONBAGS_CONTRACT, CETUS_CONTRACT, BACKEND_URL, SUI_CLOCK } from '@/lib/contracts'

// ── Constants ─────────────────────────────────────────────────
// Bonding curve calibrated to Moonbags exact math:
// 1 SUI→1,597,603.59460839, 10→15,763,546.79803245, 50→74,418,604.65117544, 100→139,130,434.78263023
// Formula: tokens = VIRTUAL_TOKEN_RESERVES * sui_mist / (VIRTUAL_SUI_START + sui_mist)
const POOL_CREATION_FEE_MIST = BigInt(10_000_000)        // 0.01 SUI
const GRADUATION_THRESHOLD_MIST = BigInt(2_000_000_000_000) // 2,000 SUI graduation threshold
const VIRTUAL_TOKEN_RESERVES = BigInt(1_066_666_667_000_000)  // calibrated from Moonbags data
const VIRTUAL_SUI_START = BigInt(666_666_666_666)            // ~0.667 SUI virtual start (MIST)
const TOKEN_DECIMALS = 6
const SUI_METADATA_ID = '0xf256d3fb6a50eaa748d94335b34f2982fbc3b63ceec78cafaa29ebc9ebaf2bbc'

// Pre-compiled coin module bytecode — coin_template::COIN_TEMPLATE, sui 1.68.0
const COIN_BYTECODE_B64 = 'oRzrCwYAAAAKAQAMAgweAyoiBEwIBVRUB6gBwAEI6AJgBsgDGwrjAwUM6AMoAAcBDAIGAhACEQISAAACAAECBwEAAAIBDAEAAQIDDAEAAQQEAgAFBQcAAAoAAQABCwEEAQACCAYHAQIDDQkBAQwDDg0BAQwEDwoLAAEDAgUDCAQMAggABwgEAAILAgEIAAsDAQgAAQgFAQsBAQkAAQgABwkAAgoCCgIKAgsBAQgFBwgEAgsDAQkACwIBCQABCwIBCAABCQABBggEAQUBCwMBCAACCQAFDUNPSU5fVEVNUExBVEUMQ29pbk1ldGFkYXRhBk9wdGlvbgtUcmVhc3VyeUNhcAlUeENvbnRleHQDVXJsBGNvaW4NY29pbl90ZW1wbGF0ZQ9jcmVhdGVfY3VycmVuY3kLZHVtbXlfZmllbGQEaW5pdARub25lBm9wdGlvbhRwdWJsaWNfZnJlZXplX29iamVjdA9wdWJsaWNfdHJhbnNmZXIGc2VuZGVyCHRyYW5zZmVyCnR4X2NvbnRleHQDdXJsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCgIGBVRva2VuCgILClRva2VuIE5hbWUKAgEAAAIBCQEAAAAAAhILADEJBwAHAQcCOAAKATgBDAIMAwsCOAILAwsBLhEFOAMCAA=='

// ── Token amount estimation ────────────────────────────────────
function estimateTokensFromSui(suiMist: bigint): number {
  if (suiMist <= 0n) return 0
  const rawTokens = (VIRTUAL_TOKEN_RESERVES * suiMist) / (VIRTUAL_SUI_START + suiMist)
  return Number(rawTokens) / Math.pow(10, TOKEN_DECIMALS)
}

// ── Migrate options ──────────────────────────────────────────
// Cetus only (Turbos removed from v4)
const MIGRATE_OPTIONS = [
  { id: 'turbos', label: 'Turbos', color: 'purple', desc: 'Primary' },
]

export default function CreateTokenPage() {
  const router = useRouter()
  const { isConnected: connected, currentWallet } = useCurrentWallet()
  const suiClient = useSuiClient()
  const address = currentWallet?.accounts?.[0]?.address

  const [loading, setLoading]     = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info')
  const [image, setImage]         = useState<string | null>(null)
  const [imageUrl, setImageUrl]   = useState('')
  const [launched, setLaunched]   = useState(false)
  const [poolId, setPoolId]       = useState('')

  // Pool config step state
  const [showPoolConfig, setShowPoolConfig] = useState(false)
  const [publishResult, setPublishResult] = useState<{tokenType: string, capObjId: string, metaObjId: string, pkgId: string} | null>(null)
  const [firstBuyAmount, setFirstBuyAmount] = useState('')
  const [migrateTo, setMigrateTo] = useState('turbos')
  const [targetRaise, setTargetRaise] = useState('2000')

  const [formData, setFormData] = useState({
    name: '', ticker: '', description: '',
    twitter: '', telegram: '', website: '', liveStream: '',
    initialSui: '1',
  })

  const set = (field: string, value: string) =>
    setFormData(prev => ({ ...prev, [field]: value }))

  const setStatus = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setStatusMsg(msg); setStatusType(type)
  }

  // Estimated tokens from initial buy
  const suiVal = parseFloat(formData.initialSui) || 0
  const suiMist = BigInt(Math.floor(suiVal * 1e9))
  const estTokens = estimateTokensFromSui(suiMist)

  // Pool config step tokens
  const configSuiVal = parseFloat(firstBuyAmount) || 0
  const configSuiMist = BigInt(Math.floor(configSuiVal * 1e9))
  const configEstTokens = estimateTokensFromSui(configSuiMist)

  // ── Image upload ──────────────────────────────────────────
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setImage(ev.target?.result as string)
    reader.readAsDataURL(file)
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('upload_preset', 'launchpad'); fd.append('folder', 'launchpad')
      const res = await axios.post('https://api.cloudinary.com/v1_1/dtgdfntom/image/upload', fd)
      setImageUrl(res.data.secure_url)
    } catch { /* non-fatal */ }
  }

  // ── TX 1: Publish coin module ──────────────────────────────
  const handlePublish = async () => {
    if (!connected) { setStatus('Connect your wallet first', 'error'); return }
    if (!formData.name || !formData.ticker || !formData.description) {
      setStatus('Name, Ticker, and Description are required', 'error'); return
    }

    setLoading(true)
    try {
      setStatus('Publishing coin module…', 'info')
      const moduleBytes = Uint8Array.from(atob(COIN_BYTECODE_B64), c => c.charCodeAt(0))
      const tx1 = new Transaction()
      tx1.setGasBudget(100_000_000)
      const [upgradeCap] = tx1.publish({
        modules: [Array.from(moduleBytes)],
        dependencies: [
          '0x0000000000000000000000000000000000000000000000000000000000000001',
          '0x0000000000000000000000000000000000000000000000000000000000000002',
        ],
      })
      tx1.transferObjects([upgradeCap], tx1.pure.address(address!))

      setStatus('Approve in wallet…', 'info')
      let pub;
      try {
        // Use direct wallet API - pass Transaction object directly without pre-building
        // The wallet will build with the correct sender from the connected account
        const walletFeature = currentWallet!.features['sui:signAndExecuteTransactionBlock'] as any
        if (!walletFeature) throw new Error('Wallet does not support sui:signAndExecuteTransactionBlock')

        const result = await walletFeature.signAndExecuteTransactionBlock({
          transactionBlock: tx1,
          account: currentWallet!.accounts![0],
          chain: 'sui:mainnet',
          options: { showEffects: true, showObjectChanges: true },
        })

        pub = await suiClient.getTransactionBlock({
          digest: result.digest,
          options: { showEffects: true, showObjectChanges: true },
        })
      } catch (e: any) {
        throw new Error('Wallet rejected or errored: ' + (e?.message || 'Unknown'))
      }

      if (pub?.effects?.status?.status !== 'success') {
        throw new Error(pub?.effects?.status?.error || 'Publish failed')
      }

      const changes = pub.objectChanges || []
      const pkg = changes.find((c: any) => c.type === 'published') as any
      if (!pkg?.packageId) throw new Error('Package ID not found')

      const tokenType = `${pkg.packageId}::coin_template::COIN_TEMPLATE`
      const capObj  = changes.find((c: any) => c.type === 'created' && c.objectType?.includes('TreasuryCap')) as any
      const metaObj = changes.find((c: any) => c.type === 'created' && c.objectType?.includes('CoinMetadata')) as any
      if (!capObj?.objectId) throw new Error('TreasuryCap not found')
      if (!metaObj?.objectId) throw new Error('CoinMetadata not found')

      // Store publish result and show pool config step
      setPublishResult({
        tokenType,
        capObjId: capObj.objectId,
        metaObjId: metaObj.objectId,
        pkgId: pkg.packageId,
      })
      setFirstBuyAmount(formData.initialSui)
      setShowPoolConfig(true)
      setStatus('Configure your pool', 'info')

    } catch (e: any) {
      console.error('Publish error:', e)
      setStatus(e?.message || 'Publish failed', 'error')
    }
    setLoading(false)
  }

  // ── TX 2: Create pool with config ─────────────────────────
  const handleCreatePool = async () => {
    if (!publishResult) return

    const { tokenType, capObjId, metaObjId } = publishResult
    const configSuiMist = BigInt(Math.floor((parseFloat(firstBuyAmount) || 0) * 1e9))
    const targetRaiseMist = BigInt(Math.floor((parseFloat(targetRaise) || 0) * 1e9))

    setLoading(true)
    try {
      setStatus('Creating bonding curve pool…', 'info')
      const tx2 = new Transaction()

      // Dynamic gas budget: use 80% of user's SUI balance to avoid SDK coin selection issues
      try {
        const balance = await suiClient.getBalance({ owner: address! })
        const safeBudget = (BigInt(balance.totalBalance) * BigInt(3)) / BigInt(4) // 75% of balance
        if (safeBudget > 0n) tx2.setGasBudget(Number(safeBudget))
      } catch { /* fallback to SDK auto-selection */ }

      const [fee] = tx2.splitCoins(tx2.gas, [tx2.pure.u64(POOL_CREATION_FEE_MIST)])

      // First buy
      const [firstBuy] = configSuiMist > 0n
        ? tx2.splitCoins(tx2.gas, [tx2.pure.u64(configSuiMist)])
        : [tx2.moveCall({ target: '0x2::coin::zero', typeArguments: ['0x2::sui::SUI'], arguments: [] })]

      // Migrate to: 0=Cetus (legacy), 1=Turbos, 2=Bluefin (reserved)
      // Turbos is primary for new tokens
      const migrateId = MIGRATE_OPTIONS.findIndex(m => m.id === migrateTo)

      // BCS encode Option<u64> as some(value): flag byte 0x01 + 8 bytes little-endian u64
      const thresholdBytes = new Uint8Array(9)
      thresholdBytes[0] = 0x01 // some flag
      const mistView = new DataView(thresholdBytes.buffer)
      mistView.setBigUint64(1, targetRaiseMist, true) // little-endian

      tx2.moveCall({
        target: `${MOONBAGS_CONTRACT.packageId}::${MOONBAGS_CONTRACT.module}::create_and_lock_first_buy_with_fee`,
        typeArguments: [tokenType],
        arguments: [
          tx2.object(MOONBAGS_CONTRACT.configuration),
          tx2.object(MOONBAGS_CONTRACT.stakeConfig),
          tx2.object(MOONBAGS_CONTRACT.lockConfig),
          tx2.object(capObjId),
          fee,
          tx2.pure.u8(migrateId),
          firstBuy,
          tx2.pure.u64(targetRaiseMist),   // amount_out
          tx2.pure(thresholdBytes),         // threshold: Option<u64> = some(targetRaiseMist)
          tx2.pure.u64(0),                   // locking_time_ms
          tx2.object(SUI_CLOCK),             // clock
          tx2.pure.string(formData.name),
          tx2.pure.string(formData.ticker.toUpperCase()),
          tx2.pure.string(imageUrl || ''),
          tx2.pure.string(formData.description),
          tx2.pure.string(formData.twitter || ''),
          tx2.pure.string(formData.telegram || ''),
          tx2.pure.string(formData.website || ''),
          tx2.object(CETUS_CONTRACT.burnManager),
          tx2.object(CETUS_CONTRACT.pools),
          tx2.object(CETUS_CONTRACT.globalConfig),
          tx2.object(SUI_METADATA_ID),
          tx2.object(metaObjId),
        ],
      })

      // Set explicit gas budget to skip SDK dry-run (which fails due to CoinMetadata<SUI> type resolution issue)
      // tx2.setGasBudget(4_200_000_000) // removed - let SDK pick appropriate gas

      setStatus('Approve in wallet…', 'info')
      const walletFeature2 = currentWallet!.features['sui:signAndExecuteTransactionBlock'] as any
      const result2 = await walletFeature2.signAndExecuteTransactionBlock({
        transactionBlock: tx2,
        account: currentWallet!.accounts![0],
        chain: 'sui:mainnet',
        options: { showEffects: true, showObjectChanges: true, showEvents: true },
      })
      const createTx = await suiClient.getTransactionBlock({
        digest: result2.digest,
        options: { showEffects: true, showObjectChanges: true, showEvents: true },
      })

      if (createTx?.effects?.status?.status !== 'success') {
        throw new Error(createTx?.effects?.status?.error || 'Pool creation failed')
      }

      const ev = createTx.events?.find((e: any) => e.type?.includes('CreatedEventV2'))
      const newPoolId = (ev?.parsedJson as any)?.pool_id || ''

      // Register with backend
      axios.post(`${BACKEND_URL}/memecoins/create`, {
        name: formData.name, ticker: formData.ticker.toUpperCase(),
        desc: formData.description, creator: address,
        image: imageUrl, xSocial: formData.twitter,
        telegramSocial: formData.telegram, websiteUrl: formData.website,
        streamUrl: formData.liveStream, coinAddress: tokenType,
      }).catch(() => {})

      if (newPoolId) {
        axios.post(`${BACKEND_URL}/tokens/confirm`, {
          poolId: newPoolId, tokenType, creator: address,
          transactionDigest: createTx.digest,
        }).catch(() => {})
      }

      setLaunched(true); setPoolId(newPoolId)
      setStatus('Token launched!', 'success')
      setTimeout(() => router.push(newPoolId ? `/bondingcurve/coins/${newPoolId}` : '/bondingcurve'), 2000)

    } catch (e: any) {
      console.error('Launch error:', e)
      setStatus(e?.message || 'Launch failed', 'error')
    }
    setLoading(false)
  }

  const handleCancelConfig = () => {
    setShowPoolConfig(false)
    setPublishResult(null)
    setStatus('', 'info')
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <main className="min-h-screen pt-20 pb-12 bg-[#0a0a0f]">
      <div className="max-w-xl mx-auto px-4">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-green-400 bg-clip-text text-transparent mb-3">
            {showPoolConfig ? 'Configure Pool' : 'Start your Odyssey'}
          </h1>
          <p className="text-gray-400">
            {showPoolConfig ? 'Set up your bonding curve pool parameters' : 'Create a fairlaunch memecoin with bonding curve on Sui'}
          </p>
        </div>

        {/* Success */}
        {launched ? (
          <div className="bg-[#0f0f17] border border-green-500/30 rounded-2xl p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Token Launched! 🚀</h2>
            <p className="text-gray-400 mb-4">Your token is now live on the bonding curve</p>
            {poolId && <p className="text-sm text-gray-500 mb-6 font-mono">Pool: <span className="text-purple-400">{poolId.slice(0, 20)}…</span></p>}
            <a href={poolId ? `/bondingcurve/coins/${poolId}` : '/bondingcurve'}
              className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold transition-colors">
              View Token →
            </a>
          </div>
        ) : showPoolConfig ? (
          // ── Pool Configuration Step ──────────────────────────────────────
          <div className="bg-[#0f0f17] border border-gray-800/60 rounded-2xl p-6 space-y-5">

            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-white mb-1">First Buy</h2>
              <p className="text-sm text-gray-400">Choose how many SUI to contribute to the initial liquidity</p>
            </div>

            {/* First Buy Amount */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-300">Amount</label>
                <span className="text-xs text-gray-500">Balance: 3.99 SUI</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={firstBuyAmount}
                  onChange={e => setFirstBuyAmount(e.target.value)}
                  placeholder="50"
                  className="w-full bg-white/5 border border-gray-700 rounded-xl py-4 px-4 pr-16 text-white text-2xl font-bold placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg">SUI</span>
              </div>
              {/* Percentage buttons */}
              <div className="flex gap-2 mt-3">
                {[25, 50, 75, 100].map(pct => (
                  <button
                    key={pct}
                    onClick={() => setFirstBuyAmount(((3.99 * pct) / 100).toFixed(2))}
                    className="flex-1 py-2 rounded-lg border border-gray-700 text-gray-400 text-sm hover:border-purple-500/50 hover:text-white transition-colors"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            {/* You Will Receive */}
            <div className="bg-purple-900/20 border border-purple-500/20 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">You will receive</span>
                <span className="text-2xl font-bold text-purple-300">
                  {configEstTokens.toLocaleString()} {formData.ticker.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-purple-500/20">
                <span className="text-gray-500 text-sm">Deployment fee</span>
                <span className="text-gray-300">1 SUI</span>
              </div>
            </div>

            {/* Migrate To */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">Migrate To</label>
              <div className="grid grid-cols-2 gap-2">
                {MIGRATE_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setMigrateTo(opt.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      migrateTo === opt.id
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-gray-700 bg-white/5 hover:border-gray-600'
                    }`}
                  >
                    <div className={`w-6 h-6 rounded border-2 flex items-center justify-center ${
                      migrateTo === opt.id ? 'border-blue-500 bg-blue-500' : 'border-gray-600'
                    }`}>
                      {migrateTo === opt.id && (
                        <div className="w-2 h-2 rounded-full bg-white" />
                      )}
                    </div>
                    <div className="text-left">
                      <div className="text-white font-medium">{opt.label}</div>
                      <div className="text-xs text-gray-500">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Target Raise */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Target Raise <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={targetRaise}
                  onChange={e => setTargetRaise(e.target.value)}
                  placeholder="2000"
                  className="w-full bg-white/5 border border-gray-700 rounded-xl py-3 px-4 pr-16 text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500">SUI</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">Minimum target is 2000 SUI</p>
            </div>

            {/* Status */}
            {statusMsg && (
              <div className={`p-4 rounded-xl text-sm text-center border ${
                statusType === 'success' ? 'bg-green-900/20 border-green-500/30 text-green-400' :
                statusType === 'error'   ? 'bg-red-900/20 border-red-500/30 text-red-400' :
                'bg-purple-900/20 border-purple-500/30 text-gray-300 animate-pulse'
              }`}>
                {statusMsg}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCancelConfig}
                disabled={loading}
                className="flex-1 py-4 rounded-xl border border-gray-700 text-gray-400 font-semibold hover:border-gray-600 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePool}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 text-white font-bold transition-all disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Rocket className="w-5 h-5" />}
                {loading ? 'Creating…' : 'Launch'}
              </button>
            </div>
          </div>
        ) : (
          // ── Initial Form ────────────────────────────────────────────────
          <div className="bg-[#0f0f17] border border-gray-800/60 rounded-2xl p-6 space-y-5">

            {/* Logo */}
            <div className="flex flex-col items-center">
              <label className="cursor-pointer group">
                {image ? (
                  <div className="relative">
                    <img src={image} alt="logo" className="w-24 h-24 rounded-2xl object-cover border-2 border-purple-500/50" />
                    <div className="absolute inset-0 bg-black/50 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Upload className="w-6 h-6 text-white" />
                    </div>
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-700 hover:border-purple-500/50 transition-colors flex flex-col items-center justify-center">
                    <Upload className="w-8 h-8 text-gray-500 mb-1" /><span className="text-xs text-gray-500">Logo</span>
                  </div>
                )}
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
              <p className="text-xs text-gray-500 mt-2">Click to upload token logo</p>
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Token Name <span className="text-red-400">*</span></label>
              <input type="text" value={formData.name} onChange={e => set('name', e.target.value)}
                placeholder="My Awesome Token"
                className="w-full bg-white/5 border border-gray-700 rounded-xl py-3 px-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50" />
            </div>

            {/* Ticker */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Ticker <span className="text-red-400">*</span></label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input type="text" value={formData.ticker}
                  onChange={e => set('ticker', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                  placeholder="SYM" maxLength={10}
                  className="w-full bg-white/5 border border-gray-700 rounded-xl py-3 pl-8 pr-4 text-white placeholder:text-gray-600 uppercase focus:outline-none focus:border-purple-500/50" />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Description <span className="text-red-400">*</span></label>
              <textarea value={formData.description} onChange={e => set('description', e.target.value)}
                placeholder="Describe your token…" rows={3}
                className="w-full bg-white/5 border border-gray-700 rounded-xl py-3 px-4 text-white placeholder:text-gray-600 resize-none focus:outline-none focus:border-purple-500/50" />
            </div>

            {/* Live Stream */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                <Video className="w-4 h-4 text-red-400" />
                Live Stream URL
                <span className="text-xs text-gray-500 font-normal">(YouTube, Twitch)</span>
              </label>
              <input type="url" value={formData.liveStream} onChange={e => set('liveStream', e.target.value)}
                placeholder="https://youtube.com/live/…"
                className="w-full bg-white/5 border border-gray-700 rounded-xl py-3 px-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-red-500/50" />
            </div>

            {/* Socials */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([
                { icon: Twitter, field: 'twitter', placeholder: '@twitter' },
                { icon: MessageCircle, field: 'telegram', placeholder: '@telegram' },
                { icon: Globe, field: 'website', placeholder: 'website.com' },
              ] as const).map(({ icon: Icon, field, placeholder }) => (
                <div key={field} className="flex items-center gap-2 bg-white/5 border border-gray-700 rounded-xl px-3 py-2">
                  <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                  <input type="text" value={(formData as any)[field]} onChange={e => set(field, e.target.value)}
                    placeholder={placeholder}
                    className="bg-transparent w-full text-white placeholder:text-gray-600 focus:outline-none text-sm" />
                </div>
              ))}
            </div>

            {/* Initial Buy */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Initial Buy (SUI)</label>
              <div className="relative">
                <input type="number" min="1" step="0.5" value={formData.initialSui}
                  onChange={e => set('initialSui', e.target.value)}
                  className="w-full bg-white/5 border border-gray-700 rounded-xl py-3 px-4 pr-16 text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50" />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500">SUI</span>
              </div>
              <div className="mt-2 flex items-center justify-between bg-purple-900/20 border border-purple-500/20 rounded-xl px-4 py-2.5">
                <span className="text-xs text-gray-400">You will receive ~</span>
                <span className="text-sm font-bold text-purple-300">
                  {estTokens > 0 ? `${estTokens.toLocaleString()} ${formData.ticker.toUpperCase() || 'TOKENS'}` : '—'}
                </span>
              </div>
            </div>

            {/* Curve info */}
            <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
              <div className="bg-white/3 rounded-lg p-2 text-center">
                <div className="text-gray-300 font-medium">0.01 SUI</div>
                <div>creation fee</div>
              </div>
              <div className="bg-white/3 rounded-lg p-2 text-center">
                <div className="text-gray-300 font-medium">{targetRaise} SUI</div>
                <div>to graduate</div>
              </div>
              <div className="bg-white/3 rounded-lg p-2 text-center">
                <div className="text-gray-300 font-medium">1%</div>
                <div>trading fee</div>
              </div>
            </div>

            {/* Status */}
            {statusMsg && (
              <div className={`p-4 rounded-xl text-sm text-center border ${
                statusType === 'success' ? 'bg-green-900/20 border-green-500/30 text-green-400' :
                statusType === 'error'   ? 'bg-red-900/20 border-red-500/30 text-red-400' :
                'bg-purple-900/20 border-purple-500/30 text-gray-300 animate-pulse'
              }`}>
                {statusMsg}
              </div>
            )}

            {/* Publish */}
            {!connected ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <ConnectButton 
                  className="!bg-gradient-to-r from-purple-600 to-pink-600 !border !border-purple-500 !text-white !rounded-xl !px-8 !py-4 !font-bold !text-lg" />
              </div>
            ) : (
              <button onClick={handlePublish} disabled={loading}
                className="w-full flex items-center justify-center gap-3 py-4 rounded-xl bg-gradient-to-r from-purple-600 via-pink-600 to-green-600 hover:opacity-90 disabled:opacity-50 text-white font-bold text-lg transition-all hover:scale-[1.02] active:scale-[0.98]">
                {loading
                  ? <><Loader2 className="w-5 h-5 animate-spin" />{statusMsg || 'Publishing…'}</>
                  : <><Rocket className="w-5 h-5" />🚀 Publish Token</>}
              </button>
            )}

            <p className="text-xs text-gray-600 text-center">
              0.01 SUI creation fee · fees: 15% platform · 25% creator · 20% AIDA stakers
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
