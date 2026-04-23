'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentWallet, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { ConnectButton } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { Rocket, Upload, Globe, Twitter, MessageCircle, Video, Loader2, CheckCircle } from 'lucide-react'
import axios from 'axios'
import { MOONBAGS_CONTRACT_V12, BACKEND_URL, SUI_CLOCK } from '@/lib/contracts';
import { MOONBAGS_AIDA_CONTRACT, AIDA_COIN_TYPE } from '@/lib/contracts_aida'

// ── Constants ─────────────────────────────────────────────────
// Bonding curve matches Moonbags pool depth AND magnitude.
// Formula: tokens = VIRTUAL_TOKEN_RESERVES * sui_mist / (VIRTUAL_SUI_START + sui_mist)
// Pool creation fee is read live from the pair's Configuration object —
// both contracts now expose a mutable `pool_creation_fee: u64` field set
// via `setter_pool_creation_fee`. These fallbacks are used only while the
// on-chain read is in flight or if it fails.
const DEFAULT_FEE_SUI_MIST  = BigInt(5_000_000_000)           // 5 SUI
const DEFAULT_FEE_AIDA_MIST = BigInt(200_000_000_000_000)     // 200,000 AIDA
type PairType = 'SUI' | 'AIDA';
// Pool virtual reserves (from V12 + AIDA configs, both unified 2026-04-20):
//   I = initial_virtual_token_reserves =   100_000_000_000_000 (config field)
//   R = remain_token_reserves          =   400_000_000_000_000 (config field, 4×I)
//   virtual_token at pool creation     = R²/(R-I) = 533,333,333,333,333 (~533M)
//   virtual_sui at pool creation       = threshold * I/(R-I) = threshold/3
//   total minted per pool              = 2R = 800M tokens
const POOL_VIRTUAL_TOKEN     = BigInt(533_333_333_333_333)   // R²/(R-I) with unified 800M-supply config
import { getCoinModuleBytes, extractPublishResult } from '@/lib/coinPublish'

const DEFAULT_THRESHOLD_MIST = BigInt(3_000_000_000)           // 3 SUI default graduation threshold
const TOKEN_DECIMALS = 6

// ── Token amount estimation ────────────────────────────────────
// virtual_sui_start = threshold/3 (from config: remain = 4 × initial)
function estimateTokensFromSui(suiMist: bigint, thresholdMist: bigint = DEFAULT_THRESHOLD_MIST): number {
  if (suiMist <= 0n) return 0
  const virtualSuiStart = thresholdMist / 3n  // threshold/3 with new config ratio
  const rawTokens = (POOL_VIRTUAL_TOKEN * suiMist) / (virtualSuiStart + suiMist)
  return Number(rawTokens) / Math.pow(10, TOKEN_DECIMALS)
}

// ── ASCII sanitizer ───────────────────────────────────────────
// The v11 Move contract types all string fields as `std::ascii::String`,
// so any non-ASCII byte (emoji, smart quote, em dash, ellipsis, accented
// letter…) makes BCS deserialization fail with InvalidBCSBytes. Common
// culprits come from iOS autocorrect (curly quotes, em dashes, ellipsis)
// and from users pasting formatted text. We transliterate the common
// Unicode punctuation to ASCII equivalents, then strip anything else,
// then clamp to the contract's length limit.
function toAscii(input: string, maxLen: number): string {
  if (!input) return ''
  const transliterated = input
    // Smart quotes → straight
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // Dashes → hyphen
    .replace(/[\u2013\u2014\u2015]/g, '-')
    // Ellipsis → three dots
    .replace(/\u2026/g, '...')
    // Non-breaking space → space
    .replace(/\u00A0/g, ' ')
    // Bullet → asterisk
    .replace(/[\u2022\u2023\u25E6]/g, '*')
  // Strip everything that's still outside ASCII printable range (plus newlines/tabs)
  const ascii = transliterated.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
  return ascii.slice(0, maxLen)
}

// v11 contract always sends graduated funds to admin wallet via transfer_pool.
// The cron (/api/cron/graduate) auto-creates a Momentum CLMM pool within ~5 minutes.

export default function CreateTokenPage() {
  const router = useRouter()
  const { isConnected: connected, currentWallet } = useCurrentWallet()
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction()
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
  // DEX routing for graduation. 0 = Cetus (automated on-chain pool creation +
  // LP burn, recommended). 1 = Turbos (falls back to admin-dump until
  // init_turbos_pool ships — phase 2).
  const [bondingDex, setBondingDex] = useState<0 | 1>(0)
  const [targetRaise, setTargetRaise] = useState('2000')
  const [pairType, setPairType] = useState<PairType>('SUI')

  // Live on-chain `pool_creation_fee` from the selected pair's Configuration.
  // Refetches whenever the user flips SUI ↔ AIDA so the fee shown always
  // matches what `setter_pool_creation_fee` currently has on mainnet.
  const [creationFeeMist, setCreationFeeMist] = useState<bigint | null>(null)

  const MIN_AIDA = 20_000_000

  useEffect(() => {
    if (pairType === 'AIDA' && parseFloat(targetRaise) < MIN_AIDA) {
      setTargetRaise(String(MIN_AIDA))
    }
  }, [pairType])

  useEffect(() => {
    const isAida = pairType === 'AIDA'
    const configId = isAida
      ? MOONBAGS_AIDA_CONTRACT.configuration
      : MOONBAGS_CONTRACT_V12.configuration
    const fallback = isAida ? DEFAULT_FEE_AIDA_MIST : DEFAULT_FEE_SUI_MIST
    let cancelled = false
    setCreationFeeMist(null) // show loading until the new value lands
    suiClient.getObject({ id: configId, options: { showContent: true } })
      .then((res) => {
        if (cancelled) return
        const fields = (res.data?.content as any)?.fields
        const raw = fields?.pool_creation_fee
        if (raw != null) setCreationFeeMist(BigInt(raw))
        else setCreationFeeMist(fallback)
      })
      .catch(() => { if (!cancelled) setCreationFeeMist(fallback) })
    return () => { cancelled = true }
  }, [pairType, suiClient])

  // Both SUI and AIDA use 9 decimals. Round whole-number fees so the UI
  // reads "5 SUI" / "200,000 AIDA" instead of "5.0000".
  const formatFee = (mist: bigint | null, currency: PairType): string => {
    if (mist == null) return `… ${currency}`
    const tokens = Number(mist) / 1e9
    if (!isFinite(tokens)) return `… ${currency}`
    const isWhole = Math.abs(tokens - Math.round(tokens)) < 1e-9
    const formatted = tokens.toLocaleString(undefined, {
      maximumFractionDigits: isWhole ? 0 : 4,
      minimumFractionDigits: 0,
    })
    return `${formatted} ${currency}`
  }

  const [formData, setFormData] = useState({
    name: '', ticker: '', description: '',
    twitter: '', telegram: '', website: '', liveStream: '',
    initialSui: '1',
  })

  const set = (field: string, value: string) =>
    setFormData(prev => ({ ...prev, [field]: value }))

  // Pre-fill from agent creation flow (localStorage set by /agents/create).
  // One-shot: consume the draft on first read so it doesn't repopulate forever
  // if the user bails before publishing. The submit handler below also reads
  // it (for the post-publish agent registration step), so we keep a copy in
  // state instead of re-reading from storage.
  useEffect(() => {
    try {
      const pending = localStorage.getItem('pendingAgentCreation')
      if (!pending) return
      localStorage.removeItem('pendingAgentCreation')
      sessionStorage.setItem('pendingAgentCreation', pending)
      const data = JSON.parse(pending)
      setFormData(prev => ({
        ...prev,
        name: data.name || prev.name,
        ticker: data.ticker || prev.ticker,
        description: data.description || prev.description,
        twitter: data.twitter || prev.twitter,
        telegram: data.telegram || prev.telegram,
        website: data.website || prev.website,
      }))
      if (data.image) {
        setImageUrl(data.image)
        setImage(data.image)
      }
      if (data.initialBuy) setFirstBuyAmount(String(data.initialBuy))
      if (data.targetRaise) setTargetRaise(String(data.targetRaise))
    } catch {}
  }, [])

  const setStatus = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setStatusMsg(msg); setStatusType(type)
  }

  // Estimated tokens from initial buy (use user's chosen threshold for accuracy)
  const suiVal = parseFloat(formData.initialSui) || 0
  const suiMist = BigInt(Math.floor(suiVal * 1e9))
  const displayThresholdMist = BigInt(Math.floor((parseFloat(targetRaise) || 3) * 1e9))
  const estTokens = estimateTokensFromSui(suiMist, displayThresholdMist)

  // Pool config step tokens
  const configSuiVal = parseFloat(firstBuyAmount) || 0
  const configSuiMist = BigInt(Math.floor(configSuiVal * 1e9))
  const configEstTokens = estimateTokensFromSui(configSuiMist, displayThresholdMist)

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
      setStatus('Compiling Move bytecode…', 'info')
      // Compile fresh bytecode so coin type is e.g. 0xABC::hope::HOPE
      const compiledBytes = await getCoinModuleBytes(formData.ticker)
      
      setStatus('Publishing coin module…', 'info')
      const tx1 = new Transaction()
      tx1.setGasBudget(100_000_000)
      const [upgradeCap] = tx1.publish({
        modules: [compiledBytes],
        dependencies: [
          '0x0000000000000000000000000000000000000000000000000000000000000001',
          '0x0000000000000000000000000000000000000000000000000000000000000002',
        ],
      })
      tx1.transferObjects([upgradeCap], tx1.pure.address(address!))

      setStatus('Approve in wallet…', 'info')
      let pub;
      try {
        // Use dapp-kit's useSignAndExecuteTransaction hook. It works with both
        // the legacy `sui:signAndExecuteTransactionBlock` feature AND the new
        // `sui:signTransaction` wallet-standard feature (Slush/SuiNS Wallet
        // and other modern wallets only implement the new one).
        const result = await signAndExecuteTransaction({
          transaction: tx1,
          chain: 'sui:mainnet',
        })

        // Wait for TX1 to be fully indexed before using its objects in TX2
        await suiClient.waitForTransaction({ digest: result.digest })
        // The node can index effects before objectChanges — retry until populated
        for (let attempt = 0; attempt < 8; attempt++) {
          pub = await suiClient.getTransactionBlock({
            digest: result.digest,
            options: { showEffects: true, showObjectChanges: true },
          })
          if (pub?.objectChanges && pub.objectChanges.length > 0) break
          if (attempt < 7) await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
        }
      } catch (e: any) {
        throw new Error('Wallet rejected or errored: ' + (e?.message || 'Unknown'))
      }

      if (pub?.effects?.status?.status !== 'success') {
        throw new Error(pub?.effects?.status?.error || 'Publish failed')
      }

      const changes = pub.objectChanges || []
      const { coinType: tokenType, treasuryCapId, metadataId: metaObjId2 } = extractPublishResult(changes, formData.ticker)
      if (!treasuryCapId) throw new Error('TreasuryCap not found')
      if (!metaObjId2) throw new Error('CoinMetadata not found')

      // Store publish result and show pool config step
      setPublishResult({
        tokenType,
        capObjId: treasuryCapId,
        metaObjId: metaObjId2,
        pkgId: tokenType.split('::')[0],
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
    const targetRaiseNum = parseFloat(targetRaise) || 0
    if (pairType === 'AIDA' && targetRaiseNum < MIN_AIDA) {
      return alert(`Minimum target raise is ${MIN_AIDA.toLocaleString()} AIDA`)
    }
    if (pairType === 'SUI' && targetRaiseNum < 1000) {
      return alert('Minimum target raise is 1000 SUI')
    }
    const targetRaiseMist = BigInt(Math.floor(targetRaiseNum * 1e9))

    setLoading(true)
    try {
      setStatus('Creating bonding curve pool…', 'info')
      const tx2 = new Transaction()
      tx2.setGasBudget(500_000_000)

      const isAidaPair = pairType === 'AIDA'
      const coinType = isAidaPair ? AIDA_COIN_TYPE : '0x2::sui::SUI'

      // Live on-chain creation fee — matches `configuration.pool_creation_fee`
      // the Move entry asserts against. Fall back to the hard defaults if
      // the read never landed (better to try the tx with the expected
      // value than to block launch outright on an RPC hiccup).
      const feeMist = creationFeeMist ?? (isAidaPair ? DEFAULT_FEE_AIDA_MIST : DEFAULT_FEE_SUI_MIST)

      // ── firstBuy + fee coins ───────────────────────────────────────
      // AIDA pair: both fee and firstBuy are Coin<AIDA>, split from user's AIDA balance
      // SUI pair: both are Coin<SUI>, split from gas
      let firstBuy: any
      let fee: any
      if (isAidaPair) {
        if (!address) throw new Error('Connect wallet')
        const { data: aidaCoins } = await suiClient.getCoins({ owner: address, coinType: AIDA_COIN_TYPE })
        if (!aidaCoins.length) throw new Error('No AIDA coins found in wallet. Please acquire AIDA before creating an AIDA pair pool.')
        const baseCoin = tx2.object(aidaCoins[0].coinObjectId)
        for (let i = 1; i < aidaCoins.length; i++) {
          tx2.moveCall({
            target: '0x2::pay::join',
            typeArguments: [AIDA_COIN_TYPE],
            arguments: [baseCoin, tx2.object(aidaCoins[i].coinObjectId)],
          })
        }
        const [feeCoin] = tx2.splitCoins(baseCoin, [tx2.pure.u64(feeMist)])
        fee = feeCoin
        if (configSuiMist > 0n) {
          const [fb] = tx2.splitCoins(baseCoin, [tx2.pure.u64(configSuiMist)])
          firstBuy = fb
        } else {
          firstBuy = tx2.moveCall({ target: '0x2::coin::zero', typeArguments: [AIDA_COIN_TYPE], arguments: [] })
        }
      } else {
        const [feeCoin] = tx2.splitCoins(tx2.gas, [tx2.pure.u64(feeMist)])
        fee = feeCoin
        if (configSuiMist > 0n) {
          const [fb] = tx2.splitCoins(tx2.gas, [tx2.pure.u64(configSuiMist)])
          firstBuy = fb
        } else {
          firstBuy = tx2.moveCall({ target: '0x2::coin::zero', typeArguments: ['0x2::sui::SUI'], arguments: [] })
        }
      }

      const virtualSuiStart = targetRaiseMist / 3n  // threshold/3 with new config ratio
      const minTokensOut: bigint = configSuiMist > 0n
        ? (POOL_VIRTUAL_TOKEN * configSuiMist * 95n / 100n) / (virtualSuiStart + configSuiMist)
        : 1n

      if (!metaObjId) throw new Error('CoinMetadata object ID missing — please retry TX1')
      if (!capObjId)  throw new Error('TreasuryCap object ID missing — please retry TX1')

      // Sanitize all string fields — the v11 Move contract uses std::ascii::String
      // for name/symbol/uri/description/twitter/telegram/website. Non-ASCII bytes
      // (smart quotes from iOS autocorrect, em dashes, emoji, accents) cause the
      // transaction to fail with InvalidBCSBytes at the matching arg index.
      // Length caps match the contract's assertions (lines 599-603 of moonbags.move).
      const nameAscii        = toAscii(formData.name, 100)
      const symbolAscii      = toAscii(formData.ticker.toUpperCase(), 20)
      const uriAscii         = toAscii(imageUrl || '', 300)
      const descriptionAscii = toAscii(formData.description, 1000)
      const twitterAscii     = toAscii(formData.twitter || '', 500)
      const telegramAscii    = toAscii(formData.telegram || '', 500)
      const websiteAscii     = toAscii(formData.website || '', 500)

      // Warn the user if we had to strip characters
      const stripped: string[] = []
      if (nameAscii !== formData.name) stripped.push('name')
      if (symbolAscii !== formData.ticker.toUpperCase()) stripped.push('symbol')
      if (descriptionAscii !== formData.description) stripped.push('description')
      if (twitterAscii !== (formData.twitter || '')) stripped.push('twitter')
      if (telegramAscii !== (formData.telegram || '')) stripped.push('telegram')
      if (websiteAscii !== (formData.website || '')) stripped.push('website')
      if (stripped.length > 0) {
        console.warn(`[create] Non-ASCII characters stripped from: ${stripped.join(', ')}`)
        setStatus(`Note: non-ASCII characters removed from ${stripped.join(', ')}. Launching…`, 'info')
      }

      // Update CoinMetadata with actual token info BEFORE pool creation.
      // The compiled coin module creates CoinMetadata with empty/placeholder values.
      // These calls write the real name, description, and logo into the on-chain
      // CoinMetadata object so that explorers (SuiVision, Suiscan) display them.
      // The update calls take arguments by reference; the pool creation below
      // takes them by value — Sui PTB execution handles this correctly.
      tx2.moveCall({
        target: '0x2::coin::update_name',
        typeArguments: [tokenType],
        arguments: [tx2.object(capObjId), tx2.object(metaObjId), tx2.pure.string(nameAscii)],
      })
      tx2.moveCall({
        target: '0x2::coin::update_symbol',
        typeArguments: [tokenType],
        arguments: [tx2.object(capObjId), tx2.object(metaObjId), tx2.pure.string(symbolAscii)],
      })
      tx2.moveCall({
        target: '0x2::coin::update_description',
        typeArguments: [tokenType],
        arguments: [tx2.object(capObjId), tx2.object(metaObjId), tx2.pure.string(descriptionAscii)],
      })
      if (uriAscii) {
        tx2.moveCall({
          target: '0x2::coin::update_icon_url',
          typeArguments: [tokenType],
          arguments: [tx2.object(capObjId), tx2.object(metaObjId), tx2.pure.string(uriAscii)],
        })
      }

      // ── Choose contract based on pair type ──────────────────────
      // AIDA pairs use moonbags_aida contract (forked from moonbags v12)
      // SUI pairs use the standard moonbags v12 contract
      const contract = isAidaPair ? MOONBAGS_AIDA_CONTRACT : MOONBAGS_CONTRACT_V12

      // Warn if AIDA contract not yet deployed
      if (isAidaPair && contract.packageId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        return alert('AIDA contract not yet deployed. Please deploy moonbags_aida first.')
      }

      // For AIDA pairs, initialize the staking pool so new tokens self-stake.
      if (isAidaPair) {
        tx2.moveCall({
          target: `${contract.packageId}::moonbags_stake::initialize_staking_pool`,
          typeArguments: [tokenType],
          arguments: [tx2.object(contract.stakeConfig), tx2.object(SUI_CLOCK)],
        })
      }

      // Create pool with metadata (moonbags for SUI, moonbags_aida for AIDA).
      //
      // === DEX MIGRATION (Cetus/Turbos) ================================
      // When moonbags-contracts-sui is republished with bonding_dex support,
      // swap the arguments list for the "DEX-AWARE" block below and update
      // `contract.*` constants in lib/contracts*.ts to the new package IDs
      // (Configuration, StakeConfig, LockConfig, and the Cetus shared
      // objects: BurnManager / Pools / GlobalConfig, plus metadata_sui).
      // The current code path works with the deployed (non-DEX-aware) fork.
      // ================================================================
      tx2.moveCall({
        target: `${contract.packageId}::${contract.module}::create_and_lock_first_buy_with_fee`,
        typeArguments: [tokenType],
        arguments: [
          tx2.object(contract.configuration),                  // configuration
          tx2.object(contract.stakeConfig),                    // stake_config
          tx2.object(contract.lockConfig),                      // token_lock_config
          tx2.object(capObjId),                                // treasury_cap
          fee,                                                 // pool_creation_fee
          firstBuy,                                            // coin_sui / coin_aida
          tx2.pure.u64(minTokensOut),                          // amount_out
          tx2.pure.u64(targetRaiseMist),                       // threshold
          tx2.pure.u64(0),                                     // locking_time_ms
          tx2.object(SUI_CLOCK),                               // clock
          tx2.pure.string(nameAscii),                          // name
          tx2.pure.string(symbolAscii),                         // symbol
          tx2.pure.string(uriAscii),                           // uri
          tx2.pure.string(descriptionAscii),                    // description
          tx2.pure.string(twitterAscii),                       // twitter
          tx2.pure.string(telegramAscii),                      // telegram
          tx2.pure.string(websiteAscii),                       // website
          tx2.object(metaObjId),                               // metadata_token
        ],
      })
      /* === DEX-AWARE ARGUMENTS — uncomment after moonbags republish ====
      tx2.moveCall({
        target: `${contract.packageId}::${contract.module}::create_and_lock_first_buy_with_fee`,
        typeArguments: [tokenType],
        arguments: [
          tx2.object(contract.configuration),                  // configuration
          tx2.object(contract.stakeConfig),                    // stake_config
          tx2.object(contract.lockConfig),                      // token_lock_config
          tx2.object(capObjId),                                // treasury_cap
          fee,                                                 // pool_creation_fee
          tx2.pure.u8(bondingDex),                             // bonding_dex (0=Cetus, 1=Turbos)
          firstBuy,                                            // coin_sui / coin_aida
          tx2.pure.u64(minTokensOut),                          // amount_out
          tx2.pure.u64(targetRaiseMist),                       // threshold  (wrap with Option<u64> helper if contract expects Option)
          tx2.pure.u64(0),                                     // locking_time_ms
          tx2.object(SUI_CLOCK),                               // clock
          tx2.pure.string(nameAscii),                          // name
          tx2.pure.string(symbolAscii),                         // symbol
          tx2.pure.string(uriAscii),                           // uri
          tx2.pure.string(descriptionAscii),                    // description
          tx2.pure.string(twitterAscii),                       // twitter
          tx2.pure.string(telegramAscii),                      // telegram
          tx2.pure.string(websiteAscii),                       // website
          tx2.object(contract.cetusBurnManager),               // cetus_burn_manager
          tx2.object(contract.cetusPools),                     // cetus_pools
          tx2.object(contract.cetusGlobalConfig),              // cetus_global_config
          tx2.object(contract.suiMetadata),                    // metadata_sui  (ID: 0x587c29de216efd4219573e08a1f6964d4fa7cb714518c2c8a0f29abfa264327d on mainnet)
          tx2.object(metaObjId),                               // metadata_token
        ],
      })
      ==============================================================*/
      
      setStatus('Approve in wallet…', 'info')
      const result2 = await signAndExecuteTransaction({
        transaction: tx2,
        chain: 'sui:mainnet',
      })

      // Wait for TX2 to finalize, then retry getTransactionBlock until events
      // are populated (indexer lag can return empty events immediately after).
      await suiClient.waitForTransaction({ digest: result2.digest })
      let createTx: any = null
      for (let attempt = 0; attempt < 8; attempt++) {
        createTx = await suiClient.getTransactionBlock({
          digest: result2.digest,
          options: { showEffects: true, showObjectChanges: true, showEvents: true },
        })
        if (createTx?.effects?.status && createTx?.events) break
        if (attempt < 7) await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
      }

      if (createTx?.effects?.status?.status !== 'success') {
        // Include digest so we can debug on Sui Explorer
        throw new Error(`Pool creation failed [${result2.digest}]: ${createTx?.effects?.status?.error || 'unknown error'}`)
      }

      const ev = createTx.events?.find((e: any) => e.type?.includes('CreatedEventV2'))
      const newPoolId = (ev?.parsedJson as any)?.pool_id || ''

      // Note: CoinMetadata is frozen inside create_with_fee / create_and_lock_first_buy_with_fee
      // (v12+ contract). Explorers (SuiVision, SuiScan, Slush) will show the token
      // image immediately after pool creation, before DEX graduation.

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

        // Persist stream URL to KV so the token page can display it
        if (formData.liveStream) {
          fetch('/api/stream-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ poolId: newPoolId, streamUrl: formData.liveStream }),
          }).catch(() => {})
        }
      }

      setLaunched(true); setPoolId(newPoolId)

      // Check if this is an agent creation (from /agents/create redirect).
      // The pre-fill effect above moves the draft from localStorage to
      // sessionStorage so it only survives the current tab/flow.
      const pendingAgent = sessionStorage.getItem('pendingAgentCreation')
      if (pendingAgent) {
        try {
          const agentData = JSON.parse(pendingAgent)
          console.log('Registering agent with backend...', agentData)
          
          // Call backend to create agent record
          const agentResponse = await fetch('/api/agents/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              creatorAddress: address,
              tokenType,
              poolId: newPoolId,
              packageId: tokenType.split('::')[0] || '',
              name: agentData.name,
              symbol: agentData.ticker,
              description: agentData.description,
              avatarUrl: agentData.image,
              twitter: agentData.twitter,
              telegram: agentData.telegram,
              website: agentData.website,
              personality: agentData.personality,
              skills: agentData.skills,
              llmModel: agentData.llmModel,
              revenueAida: agentData.revenueAida,
              revenueCreator: agentData.revenueCreator,
              revenuePlatform: agentData.revenuePlatform,
            }),
          })
          
          if (agentResponse.ok) {
            const { agent } = await agentResponse.json()
            console.log('✅ Agent registered:', agent)
            sessionStorage.removeItem('pendingAgentCreation')
            setStatus('🤖 Agent created successfully! Redirecting to dashboard...', 'success')
            setTimeout(() => router.push(`/my-agents/${agent.id}/dashboard`), 2500)
            return
          } else {
            const errorText = await agentResponse.text()
            console.error('Agent registration failed:', errorText)
            setStatus(`⚠️ Token created but agent registration failed: ${errorText}`, 'error')
          }
        } catch (error) {
          console.error('Agent registration error:', error)
        }
      }
      
      // Regular token (not agent)
      setStatus('Token launched!', 'success')
      setTimeout(() => router.push(newPoolId ? `/bondingcurve/coins/${newPoolId}` : '/bondingcurve'), 2000)

    } catch (e: any) {
      console.error('Launch error:', e)
      setStatus(e?.message || 'Launch failed', 'error')
      setLoading(false)
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
          {showPoolConfig && <p className="text-gray-400">Set up your bonding curve pool parameters</p>}
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
              <p className={"text-sm text-gray-400"}>Choose how many {pairType} to contribute to the initial liquidity</p>
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
                <span className={"absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg"}>{pairType}</span>
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

            {/* Graduation DEX */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">Graduates To</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBondingDex(0)}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition ${
                    bondingDex === 0
                      ? 'border-[#D4AF37]/60 bg-[#D4AF37]/10 ring-1 ring-[#D4AF37]/40'
                      : 'border-gray-700 hover:border-gray-600 bg-white/[0.02]'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    bondingDex === 0 ? 'border-[#D4AF37] bg-[#D4AF37]' : 'border-gray-500'
                  }`}>
                    {bondingDex === 0 && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-medium flex items-center gap-2">
                      Cetus
                      <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">RECOMMENDED</span>
                    </div>
                    <div className="text-xs text-gray-400">Concentrated liquidity, automated pool + LP burn</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setBondingDex(1)}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition ${
                    bondingDex === 1
                      ? 'border-[#D4AF37]/60 bg-[#D4AF37]/10 ring-1 ring-[#D4AF37]/40'
                      : 'border-gray-700 hover:border-gray-600 bg-white/[0.02]'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    bondingDex === 1 ? 'border-[#D4AF37] bg-[#D4AF37]' : 'border-gray-500'
                  }`}>
                    {bondingDex === 1 && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-medium">Turbos</div>
                    <div className="text-xs text-gray-400">Concentrated liquidity, smaller pool but permissionless</div>
                  </div>
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {bondingDex === 0
                  ? 'When the bonding curve fills, a Cetus CLMM pool is created on-chain automatically and the LP position is burned — liquidity is permanent.'
                  : 'Turbos graduation is admin-assisted while on-chain automation is finalized. Creator-owned LP is still burned before trading begins.'}
              </p>
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
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500">{pairType}</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">Minimum: {pairType === 'AIDA' ? `${MIN_AIDA.toLocaleString()} AIDA` : '1000 SUI'}</p>
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

            {/* Pair Asset Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">Pair Asset</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPairType('SUI')}
                  className={"py-3 px-4 rounded-xl border font-semibold text-sm transition-all " + (pairType === 'SUI' ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-gray-700 bg-white/5 text-gray-400 hover:border-gray-600')}
                >
                  SUI
                  <span className="block text-xs opacity-60 mt-0.5">SUI pair</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPairType('AIDA')}
                  className={"py-3 px-4 rounded-xl border font-semibold text-sm transition-all " + (pairType === 'AIDA' ? 'border-green-500 bg-green-500/20 text-green-300' : 'border-gray-700 bg-white/5 text-gray-400 hover:border-gray-600')}
                >
                  AIDA
                  <span className="block text-xs opacity-60 mt-0.5">AIDA pair</span>
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {pairType === 'AIDA'
                  ? 'Bonding curve denominated in AIDA via Bluefin price feed.'
                  : 'Standard SUI-denominated bonding curve.'}
              </p>
            </div>

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
              <label className="block text-sm font-medium text-gray-300 mb-2">Initial Buy ({pairType})</label>
              <div className="relative">
                <input type="number" min="1" step="0.5" value={formData.initialSui}
                  onChange={e => set('initialSui', e.target.value)}
                  className="w-full bg-white/5 border border-gray-700 rounded-xl py-3 px-4 pr-16 text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50" />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500">{pairType}</span>
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
                <div className="text-gray-300 font-medium">{formatFee(creationFeeMist, pairType)}</div>
                <div>creation fee</div>
              </div>
              <div className="bg-white/3 rounded-lg p-2 text-center">
                <div className="text-gray-300 font-medium">{targetRaise} {pairType}</div>
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
              {formatFee(creationFeeMist, pairType)} creation fee · fees: 40% platform · 30% creator · 30% AIDA stakers
            </p>
          </div>
        )}
      </div>
    </main>
  )
}



