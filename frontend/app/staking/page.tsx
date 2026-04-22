'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCurrentWallet, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Coins, Gift, Loader2, Wallet, AlertTriangle, ArrowRight, TrendingUp, ExternalLink, Lock } from 'lucide-react'
import { Transaction } from '@mysten/sui/transactions'
import { MOONBAGS_CONTRACT_V12, MOONBAGS_CONTRACT_LEGACY, SUI_CLOCK, AIDA_CONTRACT } from '@/lib/contracts'
import { MOONBAGS_AIDA_CONTRACT } from '@/lib/contracts_aida'

// Lazy-load SuiLock component
const SuiLockPage = lazy(() => import('../suilock/page'))
// Lazy-load Culture (airdrops) tab — only mounted when the user clicks Culture
const CultureTab = lazy(() => import('@/components/culture/CultureTab'))

const SUI_RPC = 'https://fullnode.mainnet.sui.io'

// ─── Contract constants ───────────────────────────────────────────────────────
// AIDA staking positions live in the V12 stakeConfig (0x59c35bc...). V12 *package*
// unstake aborts with code 4 (new restriction), so use V11 for all stake/unstake/
// claim calls on the shared stakeConfig — it's the last working package version.
const V11_PKG      = '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813'
const PKG          = V11_PKG
const STAKE_CFG    = MOONBAGS_CONTRACT_V12.stakeConfig    // 0x59c35bc... — AIDA pool lives here
const MBAGS_CFG    = MOONBAGS_CONTRACT_V12.configuration

// Legacy v1 AIDA staking (original super-legacy — still migrates to current PKG)
const LEGACY_PKG        = '0x50e60400cc2ea760b5fb8380fa3f1fc0a94dfc592ec78487313d21b50af846da'
const LEGACY_STAKE_CFG  = '0x4ca7022cd11cbe5bd66577b1e28adca0592dd10102b85e12cd8c8a08796a8be9'
const LEGACY_POOL_ID    = '0x2a7611a0660c89532160d193057383796f45c96040f1a9c66746298ad929883a'

const AIDA_TYPE = AIDA_CONTRACT.fullAddress

// AIDA-paired token fees flow in AIDA (not SUI) and accumulate on a
// separate stakeConfig under the moonbags_aida package. AIDA stakers
// claim from here in addition to the main SUI claim above.
const AIDA_PAIR_PKG     = MOONBAGS_AIDA_CONTRACT.packageId
const AIDA_PAIR_STK_CFG = MOONBAGS_AIDA_CONTRACT.stakeConfig

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function rpc(method: string, params: any[]) {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const j = await res.json()
  return j.result
}

// ─── Component ───────────────────────────────────────────────────────────────
type PageTab = 'staking' | 'suilock' | 'culture'

export default function StakingPage() {
  // `useSearchParams` requires a Suspense boundary — wrap the stateful inner
  // component so the first render has a client-side URL snapshot available.
  return (
    <Suspense fallback={<main className="min-h-screen pt-20" />}>
      <StakingPageInner />
    </Suspense>
  )
}

function StakingPageInner() {
  const { isConnected: connected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts?.[0]?.address
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()

  // Tab state is driven by the `?tab=` query param so each tab has a
  // shareable URL (`/staking`, `/staking?tab=suilock`, `/staking?tab=culture`).
  const searchParams = useSearchParams()
  const tabParam = searchParams?.get('tab')
  const pageTab: PageTab =
    tabParam === 'suilock' ? 'suilock'
    : tabParam === 'culture' ? 'culture'
    : 'staking'

  // UI state
  const [loading, setLoading]           = useState(false)
  const [statusMsg, setStatusMsg]       = useState('')
  const [stakedAmount, setStakedAmount] = useState('')

  // On-chain state
  const [aidaBalance, setAidaBalance]   = useState(0)
  const [v3Staked, setV3Staked]         = useState(0)
  const [v3Rewards, setV3Rewards]       = useState(0)
  const [v3PoolId, setV3PoolId]         = useState<string | null>(null)
  const [aidaPoolExists, setAidaPoolExists] = useState<boolean | null>(null)
  const [unstakeDeadline, setUnstakeDeadline] = useState(0)


  // Raw reward components for live accumulation display
  const [stakerBalance, setStakerBalance] = useState(BigInt(0))
  const [stakerEarned,  setStakerEarned]  = useState(BigInt(0))
  const [stakerRwdIdx,  setStakerRwdIdx]  = useState(BigInt(0))
  const [poolRwdIdx,    setPoolRwdIdx]     = useState(BigInt(0))
  const [liveRewards,   setLiveRewards]   = useState(0)
  const [stakedDollar,  setStakedDollar]  = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Navi integration state
  const [naviDepositAmt, setNaviDepositAmt]   = useState('')
  const [naviLoading, setNaviLoading]         = useState(false)
  const [naviPosition, setNaviPosition]       = useState<{deposited:number,earned:number}|null>(null)
  const [naviApy, setNaviApy]                 = useState(4.82)
  const [selectedNaviPool, setSelectedNaviPool] = useState<'standard'|'boosted'>('standard')
  const [naviMode, setNaviMode]               = useState<'deposit'|'withdraw'>('deposit')
  const [naviTvl, setNaviTvl]                 = useState('')
  const [naviNavxRewards, setNaviNavxRewards] = useState(0)

  // Legacy v1 state
  const [legacyStaked, setLegacyStaked] = useState(0)
  const [migrating, setMigrating]       = useState(false)

  // AIDA-pair reward state (claimable AIDA from AIDA-paired token trading fees).
  // Mirrors the SUI-side tracking but reads from moonbags_aida stakeConfig.
  const [aidaPairPoolId, setAidaPairPoolId]   = useState<string | null>(null)
  const [aidaPairRewards, setAidaPairRewards] = useState(0)     // live, ticking
  const [aidaPairEarned,  setAidaPairEarned]  = useState<bigint>(BigInt(0))
  const [aidaPairStakerBal, setAidaPairStakerBal] = useState<bigint>(BigInt(0))
  const [aidaPairStakerIdx, setAidaPairStakerIdx] = useState<bigint>(BigInt(0))
  const [aidaPairPoolIdx,   setAidaPairPoolIdx]   = useState<bigint>(BigInt(0))
  const [claimingAidaPair,  setClaimingAidaPair]  = useState(false)


  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (connected && address) {
      fetchAllBalances()
      fetchNaviUserData(address)
    } else checkAidaPool() // still check pool existence even when disconnected
  }, [connected, address])


  // ── Poll pool reward_index every 30s ────────────────────────────────────────
  useEffect(() => {
    if (!v3PoolId || v3Staked <= 0) return
    const poll = async () => {
      try {
        const poolObj = await rpc('sui_getObject', [v3PoolId, { showContent: true }])
        const newPoolIdx = BigInt(poolObj?.data?.content?.fields?.reward_index ?? 0)
        setPoolRwdIdx(newPoolIdx)
      } catch { /* silent */ }
    }
    pollRef.current = setInterval(poll, 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [v3PoolId, v3Staked])

  // ── Live ticker — recompute display every second from latest raw values ──────
  useEffect(() => {
    if (v3Staked <= 0) return
    const MULTIPLIER = BigInt('10000000000000000') // 1e16
    tickRef.current = setInterval(() => {
      const pending = poolRwdIdx > stakerRwdIdx
        ? (stakerBalance * (poolRwdIdx - stakerRwdIdx)) / MULTIPLIER
        : BigInt(0)
      setLiveRewards(Number(stakerEarned + pending) / 1e9)
    }, 1_000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [stakerBalance, stakerEarned, stakerRwdIdx, poolRwdIdx, v3Staked])

  // ── Compute staked AIDA dollar value from DexScreener ───────────────────────
  useEffect(() => {
    if (v3Staked <= 0) return
    const pairAddr = '0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b'
    fetch(`https://api.dexscreener.com/latest/dex/pairs/sui/${pairAddr}`)
      .then(r => r.json())
      .then(data => {
        const priceUsd = parseFloat(data?.pair?.priceUsd || data?.pairs?.[0]?.priceUsd || '0')
        if (priceUsd > 0) {
          const dollarValue = v3Staked * priceUsd
          if (dollarValue >= 1_000_000) setStakedDollar(`~$${(dollarValue / 1_000_000).toFixed(2)}M`)
          else if (dollarValue >= 1000) setStakedDollar(`~$${(dollarValue / 1000).toFixed(2)}K`)
          else setStakedDollar(`~$${dollarValue.toFixed(2)}`)
        }
      }).catch(() => {})
  }, [v3Staked])

  // ── Fetch Navi SUI supply APY + TVL ─────────────────────────────────────────
  useEffect(() => {
    fetch('https://api.naviprotocol.io/api/pool')
      .then(r => r.json())
      .then((data: any) => {
        const suiPool = data?.find?.((p: any) =>
          p?.coinType?.toLowerCase?.()?.includes('sui') && !p?.coinType?.includes('::')
        )
        if (suiPool?.supplyRate) setNaviApy(parseFloat((suiPool.supplyRate * 100).toFixed(2)))
        // Extract live TVL (field may be totalSupply, tvl, or totalSupplyUsd)
        const tvlRaw = suiPool?.totalSupplyUsd ?? suiPool?.tvl ?? suiPool?.totalSupply
        if (tvlRaw) {
          const tvl = Number(tvlRaw)
          if (tvl >= 1_000_000) setNaviTvl(`$${(tvl / 1_000_000).toFixed(1)}M`)
          else if (tvl >= 1000) setNaviTvl(`$${(tvl / 1000).toFixed(0)}K`)
          else if (tvl > 0) setNaviTvl(`$${tvl.toFixed(0)}`)
        }
      })
      .catch(() => { /* keep defaults */ })
  }, [])

  // ── Check if AIDA pool exists in v3 config ──────────────────────────────────
  // Returns the pool objectId if found, so callers can use it without stale state
  const checkAidaPool = async (): Promise<string | null> => {
    try {
      const fields = await rpc('suix_getDynamicFields', [STAKE_CFG, null, 50])
      const pools: any[] = fields?.data ?? []
      const aidaPool = pools.find((p: any) =>
        p.objectType?.includes('StakingPool') && p.objectType?.includes('aida::AIDA')
      )
      setAidaPoolExists(!!aidaPool)
      if (aidaPool) {
        setV3PoolId(aidaPool.objectId)
        return aidaPool.objectId
      }
      return null
    } catch (e) {
      console.error('checkAidaPool', e)
      setAidaPoolExists(false)
      return null
    }
  }

  // ── Fetch AIDA-pair rewards ─────────────────────────────────────────────
  // Returns claimable AIDA from the moonbags_aida stakeConfig (fees from
  // AIDA-paired token trades). Quiet no-op if the pool doesn't exist yet
  // — AIDA pairs are newly launched so most wallets won't have a position.
  const fetchAidaPairRewards = useCallback(async () => {
    if (!address) return
    try {
      const fields = await rpc('suix_getDynamicFields', [AIDA_PAIR_STK_CFG, null, 50])
      const pools: any[] = fields?.data ?? []
      const aidaPool = pools.find((p: any) =>
        p.objectType?.includes('StakingPool') && p.objectType?.includes('aida::AIDA')
      )
      if (!aidaPool) {
        setAidaPairPoolId(null)
        setAidaPairRewards(0)
        setAidaPairEarned(BigInt(0))
        setAidaPairStakerBal(BigInt(0))
        setAidaPairStakerIdx(BigInt(0))
        setAidaPairPoolIdx(BigInt(0))
        return
      }
      setAidaPairPoolId(aidaPool.objectId)

      const [stakerField, poolObj] = await Promise.all([
        rpc('suix_getDynamicFieldObject', [aidaPool.objectId, { type: 'address', value: address }]),
        rpc('sui_getObject', [aidaPool.objectId, { showContent: true }]),
      ])
      const poolRwdIdx = BigInt(poolObj?.data?.content?.fields?.reward_index ?? 0)
      setAidaPairPoolIdx(poolRwdIdx)

      const f = stakerField?.data?.content?.fields
      if (!f) {
        setAidaPairRewards(0)
        setAidaPairEarned(BigInt(0))
        setAidaPairStakerBal(BigInt(0))
        setAidaPairStakerIdx(BigInt(0))
        return
      }
      const balance    = BigInt(f.balance ?? 0)
      const earned     = BigInt(f.earned ?? 0)
      const stakerIdx  = BigInt(f.reward_index ?? 0)
      const MULTIPLIER = BigInt('10000000000000000') // 1e16, contract constant
      const pending = poolRwdIdx > stakerIdx
        ? (balance * (poolRwdIdx - stakerIdx)) / MULTIPLIER
        : BigInt(0)
      setAidaPairEarned(earned)
      setAidaPairStakerBal(balance)
      setAidaPairStakerIdx(stakerIdx)
      setAidaPairRewards(Number(earned + pending) / 1e9)
    } catch (e) {
      console.warn('[staking] fetchAidaPairRewards failed', e)
    }
  }, [address])

  // ── Fetch all balances ───────────────────────────────────────────────────────
  const fetchAllBalances = async () => {
    if (!address) return
    setStatusMsg('Loading...')
    try {
      // Wallet AIDA balance + pool ID resolved in parallel (avoids stale state race)
      const [balData, poolId] = await Promise.all([
        rpc('suix_getBalance', [address, AIDA_TYPE]),
        checkAidaPool()
      ])
      setAidaBalance(Number(balData?.totalBalance ?? 0) / 1e9)

      // v3 stake position (use freshly resolved poolId, not stale state)
      if (poolId) {
        const [dynField, poolObj] = await Promise.all([
          rpc('suix_getDynamicFieldObject', [poolId, { type: 'address', value: address }]),
          rpc('sui_getObject', [poolId, { showContent: true }])
        ])
        if (dynField?.data?.content?.fields) {
          const f = dynField.data.content.fields
          const stakerBalance = BigInt(f.balance ?? 0)
          const stakerEarned  = BigInt(f.earned ?? 0)
          const stakerRwdIdx  = BigInt(f.reward_index ?? 0)

          const poolFields    = poolObj?.data?.content?.fields
          const poolRwdIdx    = BigInt(poolFields?.reward_index ?? 0)

          const MULTIPLIER    = BigInt('10000000000000000') // 1e16 — matches contract constant
          const pending       = poolRwdIdx > stakerRwdIdx
            ? (stakerBalance * (poolRwdIdx - stakerRwdIdx)) / MULTIPLIER
            : BigInt(0)

          setV3Staked(Number(stakerBalance) / 1e9)
          setV3Rewards(Number(stakerEarned + pending) / 1e9)
          // Store raw components for live ticker
          setStakerBalance(stakerBalance)
          setStakerEarned(stakerEarned)
          setStakerRwdIdx(stakerRwdIdx)
          setPoolRwdIdx(poolRwdIdx)
          setLiveRewards(Number(stakerEarned + pending) / 1e9)
          setUnstakeDeadline(Number(f.unstake_deadline ?? 0))
        }
      }

      // Legacy v1 position
      const legacyField = await rpc('suix_getDynamicFieldObject', [
        LEGACY_POOL_ID,
        { type: 'address', value: address }
      ])
      if (legacyField?.data?.content?.fields) {
        const f = legacyField.data.content.fields
        setLegacyStaked(Number(f.balance ?? 0) / 1e9)
      }

      // AIDA-pair rewards (claimable AIDA from AIDA-pair token fees)
      await fetchAidaPairRewards()

      setStatusMsg('')
    } catch (e: any) {
      setStatusMsg('Error loading: ' + e.message)
    }
  }

  // ── Initialize AIDA pool in v3 config (once per deployment) ────────────────
  const handleInitPool = async () => {
    if (!connected || !address) return alert('Connect wallet first')
    setLoading(true)
    setStatusMsg('Initializing AIDA staking pool...')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${PKG}::moonbags_stake::initialize_staking_pool`,
        typeArguments: [AIDA_TYPE],
        arguments: [tx.object(STAKE_CFG), tx.object(SUI_CLOCK)],
      })
      await signAndExecute({ transaction: tx })
      setStatusMsg('AIDA pool initialized!')
      await checkAidaPool()
    } catch (e: any) {
      setStatusMsg('Error: ' + e.message)
    }
    setLoading(false)
  }

  // ── Migrate v1 → v3 ─────────────────────────────────────────────────────────
  const handleMigrate = async () => {
    if (!connected || !address || legacyStaked <= 0) return
    setMigrating(true)
    setStatusMsg('Step 1/2: Unstaking from legacy pool...')
    try {
      // Unstake from v1
      const tx1 = new Transaction()
      tx1.moveCall({
        target: `${LEGACY_PKG}::moonbags_stake::unstake`,
        typeArguments: [AIDA_TYPE],
        arguments: [
          tx1.object(LEGACY_STAKE_CFG),
          tx1.pure.u64(BigInt(Math.floor(legacyStaked * 1e9))),
          tx1.object(SUI_CLOCK),
        ],
      })
      await signAndExecute({ transaction: tx1 })

      setStatusMsg('Step 2/2: Re-staking in new pool...')

      // Stake in v3 — need to fetch the returned AIDA coins first
      const coinsRes = await rpc('suix_getCoins', [address, AIDA_TYPE, null, 5])
      const coins = coinsRes?.data ?? []
      if (!coins.length) throw new Error('No AIDA coins found after unstake')

      const stakeAmountMist = BigInt(Math.floor(legacyStaked * 1e9))
      const tx2 = new Transaction()
      const primary = tx2.object(coins[0].coinObjectId)
      if (coins.length > 1) {
        tx2.mergeCoins(primary, coins.slice(1).map((c: any) => tx2.object(c.coinObjectId)))
      }
      const [stakeCoin] = tx2.splitCoins(primary, [stakeAmountMist])
      tx2.moveCall({
        target: `${PKG}::moonbags_stake::stake`,
        typeArguments: [AIDA_TYPE],
        arguments: [tx2.object(STAKE_CFG), stakeCoin, tx2.object(SUI_CLOCK)],
      })
      await signAndExecute({ transaction: tx2 })

      setStatusMsg('Migration complete!')
      setLegacyStaked(0)
      await fetchAllBalances()
    } catch (e: any) {
      setStatusMsg('Migration error: ' + e.message)
    }
    setMigrating(false)
  }

  // ── Distribute fees → staking pools (anyone can call) ──────────────────────
  // ── Stake ───────────────────────────────────────────────────────────────────
  const handleStake = async () => {
    if (!connected || !address) return alert('Connect wallet first')
    if (!stakedAmount || parseFloat(stakedAmount) <= 0) return alert('Enter amount')
    if (parseFloat(stakedAmount) > aidaBalance) return alert('Insufficient balance')
    if (!aidaPoolExists) return alert('AIDA pool not initialized yet')

    setLoading(true)
    setStatusMsg('Staking...')
    try {
      const coinsRes = await rpc('suix_getCoins', [address, AIDA_TYPE, null, 5])
      const coins = coinsRes?.data ?? []
      if (!coins.length) throw new Error('No AIDA coins found')

      const amountMist = BigInt(Math.floor(parseFloat(stakedAmount) * 1e9))
      const tx = new Transaction()
      const primary = tx.object(coins[0].coinObjectId)
      if (coins.length > 1) {
        tx.mergeCoins(primary, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)))
      }
      const [stakeCoin] = tx.splitCoins(primary, [amountMist])
      tx.moveCall({
        target: `${PKG}::moonbags_stake::stake`,
        typeArguments: [AIDA_TYPE],
        arguments: [tx.object(STAKE_CFG), stakeCoin, tx.object(SUI_CLOCK)],
      })
      await signAndExecute({ transaction: tx })
      setStatusMsg('Staked!')
      setStakedAmount('')
      fetchAllBalances()
    } catch (e: any) {
      setStatusMsg('Error: ' + e.message)
    }
    setLoading(false)
  }

  // ── Unstake ─────────────────────────────────────────────────────────────────
  const handleUnstake = async () => {
    if (!connected || !address || v3Staked <= 0) return
    const now = Date.now()
    if (unstakeDeadline > now) {
      const mins = Math.ceil((unstakeDeadline - now) / 60000)
      return alert(`Locked for ~${mins} more minutes`)
    }
    setLoading(true)
    setStatusMsg('Unstaking...')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${PKG}::moonbags_stake::unstake`,
        typeArguments: [AIDA_TYPE],
        arguments: [
          tx.object(STAKE_CFG),
          tx.pure.u64(stakerBalance),
          tx.object(SUI_CLOCK),
        ],
      })
      await signAndExecute({ transaction: tx })
      setStatusMsg('Unstaked!')
      fetchAllBalances()
    } catch (e: any) {
      setStatusMsg('Error: ' + e.message)
    }
    setLoading(false)
  }

  // ── Claim ───────────────────────────────────────────────────────────────────
  const handleClaim = async () => {
    if (!connected || !address) return alert('Connect wallet first')
    if (liveRewards <= 0 && stakerEarned <= 0n) return alert('No rewards yet — stake AIDA and wait for trading fees to accumulate.')
    setLoading(true)
    setStatusMsg('Claiming rewards...')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${PKG}::moonbags_stake::claim_staking_pool`,
        typeArguments: [AIDA_TYPE],
        arguments: [tx.object(STAKE_CFG), tx.object(SUI_CLOCK)],
      })
      const result = await signAndExecute({ transaction: tx })
      setStatusMsg('Claimed!')
      alert(`✅ Claimed ${liveRewards.toFixed(4)} SUI!\nTx: ${result.digest}`)
      setTimeout(() => fetchAllBalances(), 2000) // refresh earned balance
      fetchAllBalances()
    } catch (e: any) {
      setStatusMsg('Error: ' + e.message)
    }
    setLoading(false)
  }

  // ── Claim AIDA-pair rewards ─────────────────────────────────────────────
  // Separate claim against the moonbags_aida stakeConfig. AIDA-paired token
  // trading fees accumulate here in AIDA (not SUI) and require their own
  // claim_staking_pool call on the moonbags_aida package.
  const handleClaimAidaPair = async () => {
    if (!connected || !address) return alert('Connect wallet first')
    if (aidaPairRewards <= 0 && aidaPairEarned <= 0n) {
      return alert('No AIDA-pair rewards yet — these accrue from AIDA-paired token trading fees.')
    }
    setClaimingAidaPair(true)
    setStatusMsg('Claiming AIDA rewards...')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${AIDA_PAIR_PKG}::moonbags_stake::claim_staking_pool`,
        typeArguments: [AIDA_TYPE],
        arguments: [tx.object(AIDA_PAIR_STK_CFG), tx.object(SUI_CLOCK)],
      })
      const result = await signAndExecute({ transaction: tx })
      setStatusMsg('Claimed AIDA!')
      alert(`✅ Claimed ${aidaPairRewards.toFixed(4)} AIDA!\nTx: ${result.digest}`)
      setTimeout(() => { fetchAllBalances(); fetchAidaPairRewards() }, 2000)
    } catch (e: any) {
      setStatusMsg('Error: ' + e.message)
    }
    setClaimingAidaPair(false)
  }

  // Fetch the current NAVI ProtocolPackage ID dynamically — NAVI upgrades their
  // package on-chain periodically; hardcoding the old address causes version check failures.
  const NAVI_FALLBACK_PKG = '0xee0041239b89564ce870a7dec5ddc5d114367ab94a1137e90aa0633cb76518e0'
  async function getNaviPackage(): Promise<string> {
    try {
      const res = await fetch('https://open-api.naviprotocol.io/api/package', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        return data?.packageId || NAVI_FALLBACK_PKG
      }
    } catch {}
    return NAVI_FALLBACK_PKG
  }

  // ── Navi: Fetch real user position from on-chain + NAVX rewards from REST API ─
  const fetchNaviUserData = useCallback(async (addr: string) => {
    if (!addr) return
    // On-chain: query Navi's SUI supply balance dynamic field.
    // Navi does NOT use receipt tokens — positions are tracked as dynamic fields
    // on a per-reserve "supply balance" object, keyed by user address.
    // SUI supply balance parent: 0x589c...96f8
    // SUI reserve (for supply index): 0xab64...fbaf
    const SUI_SUPPLY_PARENT = '0x589c83af4b035a3bc64c40d9011397b539b97ea47edf7be8f33d643606bf96f8'
    const SUI_RESERVE       = '0xab644b5fd11aa11e930d1c7bc903ef609a9feaf9ffe1b23532ad8441854fbfaf'
    try {
      const [supplyRes, reserveRes] = await Promise.all([
        rpc('suix_getDynamicFieldObject', [SUI_SUPPLY_PARENT, { type: 'address', value: addr }]),
        rpc('sui_getObject', [SUI_RESERVE, { showContent: true }]),
      ])
      const supplyFields  = supplyRes?.data?.content?.fields
      const reserveFields = reserveRes?.data?.content?.fields
      // rawBalance is the scaled supply balance; multiply by current supply index / 1e27 to get MIST
      const rawBalance  = BigInt(supplyFields?.value ?? supplyFields?.balance ?? '0')
      const supplyIndex = BigInt(
        reserveFields?.current_supply_index ?? reserveFields?.supply_index ?? '1000000000000000000000000000'
      )
      const depositedMist = rawBalance * supplyIndex / (10n ** 27n)
      if (depositedMist > 0n) {
        setNaviPosition(prev => ({ deposited: Number(depositedMist) / 1e9, earned: prev?.earned ?? 0 }))
      } else {
        setNaviPosition(null)
      }
    } catch (e) {
      console.warn('[navi] supply balance fetch failed:', e)
      setNaviPosition(null)
    }
    // REST API: NAVX claimable rewards (best-effort — silently skip on failure)
    try {
      const res = await fetch(
        `https://open-api.naviprotocol.io/api/user/rewards?address=${addr}`,
        { cache: 'no-store' }
      )
      if (res.ok) {
        const data = await res.json()
        const rewards: any[] = Array.isArray(data) ? data : (data?.data || data?.rewards || [])
        const navx = rewards.find((r: any) =>
          (r?.symbol || r?.coinSymbol || '').toLowerCase() === 'navx'
        )
        if (navx?.amount) setNaviNavxRewards(Number(navx.amount))
      }
    } catch {}
  }, [])

  // ── Navi: Claim & deposit into Navi pool ────────────────────────────────────
  const handleClaimAndDeposit = async () => {
    if (liveRewards <= 0 && stakerEarned <= 0n) return alert('No rewards yet — stake AIDA and wait for trading fees to accumulate.')
    setNaviLoading(true)
    try {
      setStatusMsg('Step 1/2: Claiming rewards...')
      const claimTx = new Transaction()
      claimTx.moveCall({
        target: `${PKG}::moonbags_stake::claim_staking_pool`,
        typeArguments: [AIDA_CONTRACT.fullAddress],
        arguments: [claimTx.object(STAKE_CFG), claimTx.object(SUI_CLOCK)],
      })
      await signAndExecute({ transaction: claimTx })
      setStatusMsg('Step 2/2: Depositing to Navi...')

      const naviPkg = await getNaviPackage()
      const amtMist = BigInt(Math.floor(liveRewards * 0.99 * 1e9))
      const depositTx = new Transaction()
      const [suiCoin] = depositTx.splitCoins(depositTx.gas, [depositTx.pure.u64(amtMist)])
      depositTx.moveCall({
        target: `${naviPkg}::incentive_v3::entry_deposit`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
          depositTx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
          depositTx.object('0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe'),
          depositTx.object('0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5'),
          depositTx.pure.u8(0),
          suiCoin,
          depositTx.pure.u64(amtMist),
          depositTx.object('0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c'),
          depositTx.object('0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80'),
        ],
      })
      await signAndExecute({ transaction: depositTx })
      setNaviPosition(prev => ({ deposited: (prev?.deposited ?? 0) + liveRewards, earned: prev?.earned ?? 0 }))
      if (address) setTimeout(() => fetchNaviUserData(address), 4000)
      setStatusMsg('\u2705 Claimed & deposited to Navi!')
    } catch (e: any) {
      setStatusMsg('Error: ' + (e?.message || 'Failed'))
    }
    setNaviLoading(false)
  }

  // ── Navi: Manual deposit ─────────────────────────────────────────────────────
  const handleNaviDeposit = async () => {
    const amt = parseFloat(naviDepositAmt)
    if (!amt || amt <= 0) return alert('Enter an amount to deposit')
    setNaviLoading(true)
    try {
      setStatusMsg('Depositing to Navi...')

      const naviPkg = await getNaviPackage()
      const amtMist = BigInt(Math.floor(amt * 1e9))
      const tx = new Transaction()
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amtMist)])
      tx.moveCall({
        target: `${naviPkg}::incentive_v3::entry_deposit`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
          tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
          tx.object('0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe'),
          tx.object('0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5'),
          tx.pure.u8(0),
          coin,
          tx.pure.u64(amtMist),
          tx.object('0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c'),
          tx.object('0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80'),
        ],
      })
      await signAndExecute({ transaction: tx })
      setNaviPosition(prev => ({ deposited: (prev?.deposited ?? 0) + amt, earned: prev?.earned ?? 0 }))
      setNaviDepositAmt('')
      if (address) setTimeout(() => fetchNaviUserData(address), 4000)
      setStatusMsg('\u2705 Deposited to Navi!')
    } catch (e: any) {
      setStatusMsg('Error: ' + (e?.message || 'Failed'))
    }
    setNaviLoading(false)
  }


  // ── Navi: Withdraw SUI ───────────────────────────────────────────────────────
  const handleNaviWithdraw = async () => {
    const amt = parseFloat(naviDepositAmt)
    if (!amt || amt <= 0) return alert('Enter an amount to withdraw')
    if (!address) return alert('Connect wallet first')
    setNaviLoading(true)
    try {
      setStatusMsg('Withdrawing from Navi...')
      const naviPkg = await getNaviPackage()
      const amtMist = BigInt(Math.floor(amt * 1e9))
      const tx = new Transaction()
      // Refresh Navi's SUI oracle price from the on-chain Pyth price info object
      // before withdraw_v2 — prevents abort code 1502 (stale oracle price).
      tx.moveCall({
        target: '0x203728f46eb10d19f8f8081db849c86aa8f2a19341b7fd84d7a0e74f053f6242::oracle_pro::update_single_price_v2',
        arguments: [
          tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'), // clock
          tx.object('0x1afe1cb83634f581606cc73c4487ddd8cc39a944b951283af23f7d69d5589478'), // OracleConfig
          tx.object('0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef'), // PriceOracle
          tx.object('0xaa0315f0748c1f24ddb2b45f7939cff40f7a8104af5ccbc4a1d32f870c0b4105'), // SupraOracleHolder
          tx.object('0x801dbc2f0053d34734814b2d6df491ce7807a725fe9a01ad74a07e9c51396c37'), // SUI pythPriceInfoObject
          tx.object('0x1fa7566f40f93cdbafd5a029a231e06664219444debb59beec2fe3f19ca08b7e'),
          tx.pure.address('0x2cab9b151ca1721624b09b421cc57d0bb26a1feb5da1f821492204b098ec35c9'), // SUI feedId
        ],
      })
      // withdraw_v2 returns Balance<SUI> (no `store` ability, can't be transferred directly).
      // Must wrap with coin::from_balance → Coin<SUI>, then transfer.
      const [withdrawnBalance] = tx.moveCall({
        target: `${naviPkg}::incentive_v3::withdraw_v2`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
          tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
          tx.object('0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef'),
          tx.object('0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe'),
          tx.object('0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5'),
          tx.pure.u8(0),
          tx.pure.u64(amtMist),
          tx.object('0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c'),
          tx.object('0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80'),
          tx.object('0x0000000000000000000000000000000000000000000000000000000000000005'),
        ],
      })
      const [suiCoin] = tx.moveCall({
        target: '0x2::coin::from_balance',
        typeArguments: ['0x2::sui::SUI'],
        arguments: [withdrawnBalance],
      })
      tx.transferObjects([suiCoin], address)
      await signAndExecute({ transaction: tx })
      setNaviPosition(prev => ({
        deposited: Math.max(0, (prev?.deposited ?? 0) - amt),
        earned: prev?.earned ?? 0,
      }))
      setNaviDepositAmt('')
      if (address) setTimeout(() => fetchNaviUserData(address), 4000)
      setStatusMsg('\u2705 Withdrawn from Navi!')
    } catch (e: any) {
      setStatusMsg('Error: ' + (e?.message || 'Failed'))
    }
    setNaviLoading(false)
  }


  return (
    <main className="min-h-screen pt-20 pb-12">
      <div className="max-w-4xl mx-auto px-4">

        {/* Page Tabs: Staking | SuiLock | Culture — each has a unique URL */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <Link
            href="/staking"
            scroll={false}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
              pageTab === 'staking'
                ? 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30'
                : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10'
            }`}
          >
            <Coins className="w-4 h-4" />
            AIDA Staking
          </Link>
          <Link
            href="/staking?tab=suilock"
            scroll={false}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
              pageTab === 'suilock'
                ? 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30'
                : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10'
            }`}
          >
            <Lock className="w-4 h-4" />
            SuiLock
          </Link>
          <Link
            href="/staking?tab=culture"
            scroll={false}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
              pageTab === 'culture'
                ? 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30'
                : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10'
            }`}
          >
            <Gift className="w-4 h-4" />
            Culture
          </Link>
        </div>

        {/* Culture Tab — send airdrops by X handle */}
        {pageTab === 'culture' && (
          <Suspense fallback={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-[#D4AF37] animate-spin" />
            </div>
          }>
            <CultureTab />
          </Suspense>
        )}

        {/* SuiLock Tab */}
        {pageTab === 'suilock' && (
          <Suspense fallback={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-[#D4AF37] animate-spin" />
            </div>
          }>
            <div className="[&>div]:min-h-0 [&>div]:pt-0">
              <SuiLockPage />
            </div>
          </Suspense>
        )}

        {/* Staking Tab */}
        {pageTab === 'staking' && (<>

        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-[#D4AF37] mb-3">Unlock Rewards with $AIDA</h1>
          <p className="text-muted-foreground mb-5">Stake $AIDA to earn 30% of all trading fees</p>
          <a
            href="https://deeptrade.io/swap/SUI_AIDA"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4AF37] text-black font-bold text-sm hover:opacity-90 hover:shadow-lg hover:shadow-[#D4AF37]/30 transition-all"
          >
            Buy $AIDA
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {/* Pool not initialized yet */}
        {aidaPoolExists === false && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5 mb-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-yellow-400 mb-1">AIDA Staking Pool Not Initialized</p>
                <p className="text-sm text-muted-foreground mb-3">
                  The AIDA staking pool needs to be created in the current staking contract before rewards can flow. This is a one-time setup — anyone can do it.
                </p>
                <button
                  onClick={handleInitPool}
                  disabled={loading || !connected}
                  className="px-5 py-2 bg-yellow-500/20 border border-yellow-500/30 rounded-xl text-yellow-400 text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Initialize AIDA Pool
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Legacy v1 migration banner */}
        {legacyStaked > 0 && aidaPoolExists && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-5 mb-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-orange-400 mb-1">Legacy v1 Stake Detected</p>
                <p className="text-sm text-muted-foreground mb-1">
                  You have <span className="text-white font-semibold">{legacyStaked.toFixed(2)} AIDA</span> staked in the old v1 contract. Migrate to the current contract to start earning rewards.
                </p>
                <button
                  onClick={handleMigrate}
                  disabled={migrating}
                  className="mt-3 px-5 py-2 bg-orange-500/20 border border-orange-500/30 rounded-xl text-orange-400 text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                >
                  {migrating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {migrating ? 'Migrating...' : `Migrate ${legacyStaked.toFixed(2)} AIDA to current contract`}
                </button>
              </div>
            </div>
          </div>
        )}

        {statusMsg && <div className="text-center mb-4 text-sm text-yellow-400">{statusMsg}</div>}

        {/* Main staking card */}
        <div className="bg-card border border-[#D4AF37]/30 rounded-2xl p-6 mb-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center">
              <Coins className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#D4AF37]">$AIDA Staking</h2>
              <p className="text-muted-foreground text-sm">Earn 30% of platform trading fees in SUI</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-background/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Wallet className="w-4 h-4" />
                <span className="text-sm">Wallet</span>
              </div>
              <p className="text-2xl font-bold">{aidaBalance.toFixed(2)} <span className="text-sm text-muted-foreground">AIDA</span></p>
            </div>
            <div className="bg-background/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Coins className="w-4 h-4" />
                <span className="text-sm">Staked</span>
              </div>
              <p className="text-2xl font-bold text-[#D4AF37]">{v3Staked.toFixed(2)} <span className="text-sm text-muted-foreground">AIDA</span></p>
              {stakedDollar && <p className="text-xs text-gray-400 mt-0.5">{stakedDollar}</p>}
            </div>
            <div className="bg-background/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Gift className="w-4 h-4" />
                <span className="text-sm">Pending Rewards</span>
              </div>
              <p className="text-2xl font-bold text-green-400 tabular-nums">
                {liveRewards.toFixed(6)} <span className="text-sm text-muted-foreground">SUI</span>
              </p>
              {v3Staked > 0 && poolRwdIdx > stakerRwdIdx && (
                <p className="text-xs text-green-500/70 flex items-center gap-1 mt-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  accumulating live
                </p>
              )}
              {stakerEarned > 0n && (
                <p className="text-xs text-green-400 mt-1 font-semibold">
                  ✅ {(Number(stakerEarned) / 1e9).toFixed(6)} SUI claimable now
                </p>
              )}
              {stakerEarned === 0n && liveRewards > 0 && (
                <p className="text-xs text-yellow-500/70 mt-1">
                  ⚡ Go to token page → Info → Distribute to unlock rewards
                </p>
              )}
            </div>
            {/* Dedicated AIDA-pair pending-rewards card, equal-weight sibling
                to the SUI one above. Always rendered so stakers can see
                AIDA-pair fees are a real revenue stream even before AIDA
                pairs launch — just shows 0 until fees start accruing. */}
            <div className="bg-background/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Gift className="w-4 h-4 text-[#D4AF37]" />
                <span className="text-sm">Pending Rewards</span>
              </div>
              <p className="text-2xl font-bold text-[#D4AF37] tabular-nums">
                {aidaPairRewards.toFixed(6)} <span className="text-sm text-muted-foreground">AIDA</span>
              </p>
              {v3Staked > 0 && aidaPairPoolIdx > aidaPairStakerIdx && (
                <p className="text-xs text-[#D4AF37]/70 flex items-center gap-1 mt-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-pulse" />
                  accumulating live
                </p>
              )}
              {aidaPairEarned > 0n && (
                <p className="text-xs text-[#D4AF37] mt-1 font-semibold">
                  ✅ {(Number(aidaPairEarned) / 1e9).toFixed(6)} AIDA claimable now
                </p>
              )}
              {aidaPairEarned === 0n && aidaPairRewards === 0 && (
                <p className="text-[10px] text-gray-500 mt-1">From AIDA-paired token fees</p>
              )}
            </div>
          </div>

          {/* Stake input */}
          <div className="mb-3">
            <label className="text-sm text-muted-foreground mb-2 block">Stake AIDA</label>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="number"
                  placeholder="Amount to stake"
                  value={stakedAmount}
                  onChange={(e) => setStakedAmount(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl py-3 px-4 pr-16"
                />
                <button
                  type="button"
                  onClick={() => setStakedAmount(aidaBalance > 0 ? aidaBalance.toString() : '')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs bg-[#D4AF37]/20 text-[#D4AF37] rounded"
                >
                  MAX
                </button>
              </div>
              <button
                onClick={handleStake}
                disabled={loading || !stakedAmount || !aidaPoolExists}
                className="px-6 py-3 bg-[#D4AF37] rounded-xl font-semibold disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Stake'}
              </button>
            </div>
          </div>

          {/* Unstake / Claim */}
          <div className="flex gap-3 mb-3">
            <button
              onClick={handleUnstake}
              disabled={loading || v3Staked <= 0}
              className="flex-1 py-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 disabled:opacity-50"
            >
              Unstake All
            </button>
            <button
              onClick={handleClaim}
              disabled={loading || (stakerEarned <= 0n && liveRewards <= 0)}
              className="flex-1 py-3 bg-green-500/20 border border-green-500/30 rounded-xl text-green-400 font-semibold disabled:opacity-50"
            >
              Claim {liveRewards.toFixed(6)} SUI
            </button>
          </div>
          {/* AIDA claim — shown whenever a position exists on the AIDA-pair
              config. Hidden entirely if no pool is set up yet to avoid
              confusing users who only care about the SUI side. */}
          {(aidaPairRewards > 0 || aidaPairEarned > 0n || aidaPairStakerBal > 0n) && (
            <button
              onClick={handleClaimAidaPair}
              disabled={claimingAidaPair || (aidaPairEarned <= 0n && aidaPairRewards <= 0)}
              className="w-full mb-3 py-3 bg-[#D4AF37]/15 border border-[#D4AF37]/30 rounded-xl text-[#D4AF37] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#D4AF37]/25 transition-colors"
            >
              {claimingAidaPair ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
              Claim {aidaPairRewards.toFixed(6)} AIDA
              <span className="text-xs opacity-70">(from AIDA pairs)</span>
            </button>
          )}
          <button
            onClick={handleClaimAndDeposit}
            disabled={naviLoading || (stakerEarned <= 0n && liveRewards <= 0)}
            className="w-full py-3 bg-teal-500/15 border border-teal-500/30 rounded-xl text-teal-400 font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-teal-500/20 transition-colors"
          >
            {naviLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
            Claim & Deposit to Navi ({(Number(stakerEarned) / 1e9).toFixed(4)} SUI)
          </button>

          {/* ── Navi Protocol Section ── */}
          <div className="mt-5 bg-gradient-to-br from-teal-500/8 to-blue-500/5 border border-teal-500/20 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white font-black text-sm font-mono">N</div>
                <div>
                  <div className="font-bold text-sm flex items-center gap-1">
                    Navi Protocol
                    <a href="https://naviprotocol.io" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </a>
                  </div>
                  <div className="text-xs text-muted-foreground">Deposit SUI rewards → earn lending yield</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-teal-400 tabular-nums">{naviApy.toFixed(2)}%</div>
                <div className="text-xs text-muted-foreground">Supply APY</div>
              </div>
            </div>

            {/* Flow */}
            <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
              <span className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-center flex-1">💎 Stake AIDA</span>
              <ArrowRight className="w-3 h-3 flex-shrink-0" />
              <span className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-center flex-1">💰 Earn SUI</span>
              <ArrowRight className="w-3 h-3 flex-shrink-0" />
              <span className="bg-teal-500/10 border border-teal-500/20 rounded-lg px-2 py-1.5 text-center flex-1 text-teal-400">🌊 Navi Yield</span>
            </div>

            {/* Pool toggle */}
            <div className="flex gap-2 mb-4">
              {(['deposit', 'withdraw'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setNaviMode(m)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${naviMode === m ? 'bg-teal-500/20 border border-teal-500/40 text-teal-400' : 'bg-white/3 border border-white/10 text-muted-foreground hover:text-foreground'}`}
                >
                  {m === 'deposit' ? 'Deposit SUI' : 'Withdraw'}
                </button>
              ))}
            </div>

            {naviMode === 'deposit' ? (
              <>
                {/* Pool selector */}
                <div className="flex flex-col gap-2 mb-4">
                  {[
                    { id: 'standard', name: 'SUI Lending Pool', apy: naviApy, tvl: naviTvl || '$42.1M', extra: '' },
                    { id: 'boosted',  name: 'SUI Boosted Pool',  apy: naviApy + 1.5, tvl: '$18.4M', extra: '+ NAVX' },
                  ].map(pool => (
                    <button
                      key={pool.id}
                      onClick={() => setSelectedNaviPool(pool.id as 'standard'|'boosted')}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-all ${selectedNaviPool === pool.id ? 'border-teal-500/50 bg-teal-500/10' : 'border-white/8 bg-white/3 hover:bg-white/5'}`}
                    >
                      <div className="flex items-center gap-2 text-left">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-teal-400 flex items-center justify-center text-xs">💧</div>
                        <div>
                          <div className="text-sm font-semibold">{pool.name}</div>
                          <div className="text-xs text-muted-foreground">TVL {pool.tvl} · Navi Finance</div>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <div>
                          <div className="text-sm font-bold text-teal-400">{pool.apy.toFixed(2)}%</div>
                          <div className="text-xs text-muted-foreground">{pool.extra || 'Supply APY'}</div>
                        </div>
                        <div className={`w-4 h-4 rounded-full border text-xs flex items-center justify-center ${selectedNaviPool === pool.id ? 'bg-teal-400 border-teal-400 text-white' : 'border-white/20'}`}>
                          {selectedNaviPool === pool.id ? '✓' : ''}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Amount input */}
                <div className="mb-3">
                  <label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider font-semibold">Amount to deposit</label>
                  <div className="relative">
                    <input
                      type="number"
                      placeholder={liveRewards > 0 ? liveRewards.toFixed(6) : '0.000000'}
                      value={naviDepositAmt}
                      onChange={e => setNaviDepositAmt(e.target.value)}
                      className="w-full bg-white/4 border border-white/10 rounded-xl py-3 px-4 pr-20 text-white focus:outline-none focus:border-teal-500/40 [color-scheme:dark]"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                      <button
                        onClick={() => setNaviDepositAmt(liveRewards.toFixed(6))}
                        className="text-xs text-teal-400 font-bold px-1.5 py-0.5 bg-teal-500/10 rounded hover:bg-teal-500/20 transition-colors"
                      >
                        MAX
                      </button>
                      <span className="text-xs text-muted-foreground">SUI</span>
                    </div>
                  </div>
                </div>

                {/* Preview */}
                {(parseFloat(naviDepositAmt) > 0 || liveRewards > 0) && (
                  <div className="bg-white/3 border border-white/8 rounded-xl p-3 mb-3 text-xs space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">You deposit</span>
                      <span className="font-medium">{(parseFloat(naviDepositAmt) || liveRewards).toFixed(4)} SUI</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">You receive</span>
                      <span className="text-teal-400 font-medium">{(parseFloat(naviDepositAmt) || liveRewards).toFixed(4)} nSUI</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Est. yearly earnings</span>
                      <span className="text-green-400 font-medium">+{((parseFloat(naviDepositAmt) || liveRewards) * (selectedNaviPool === 'boosted' ? (naviApy + 1.5) / 100 : naviApy / 100)).toFixed(5)} SUI / yr</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleNaviDeposit}
                  disabled={naviLoading || !parseFloat(naviDepositAmt)}
                  className="w-full py-3 bg-teal-500/20 border border-teal-500/35 rounded-xl text-teal-400 font-semibold flex items-center justify-center gap-2 disabled:opacity-40 hover:bg-teal-500/28 transition-colors mb-3"
                >
                  {naviLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '🌊'}
                  Deposit to Navi Pool
                </button>

                {/* Navi position */}
                {naviPosition && naviPosition.deposited > 0 && (
                  <div className="bg-teal-500/8 border border-teal-500/20 rounded-xl p-3 mb-3">
                    <div className="text-xs font-bold text-teal-400 mb-2 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> Your Navi Position
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-muted-foreground">Deposited</span><span className="font-medium">{naviPosition.deposited.toFixed(4)} SUI</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">nSUI Balance</span><span className="text-teal-400 font-medium">{naviPosition.deposited.toFixed(4)} nSUI</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Current APY</span><span className="text-teal-400 font-medium">{(selectedNaviPool === 'boosted' ? naviApy + 1.5 : naviApy).toFixed(2)}%</span></div>
                      {naviNavxRewards > 0 && (
                        <div className="flex justify-between border-t border-teal-500/15 pt-1.5 mt-0.5">
                          <span className="text-muted-foreground">NAVX Rewards</span>
                          <span className="text-yellow-400 font-medium">{naviNavxRewards.toFixed(4)} NAVX</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground leading-relaxed bg-white/2 border border-white/6 rounded-lg p-2.5">
                  ⚠️ Navi is a third-party protocol. Depositing carries smart contract risk. Odyssey does not custody your funds.
                </p>
              </>
            ) : (
              <>
                <label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider font-semibold">Amount to withdraw</label>
                <div className="relative mb-3">
                  <input
                    type="number"
                    placeholder="0.000000"
                    value={naviDepositAmt}
                    onChange={e => setNaviDepositAmt(e.target.value)}
                    className="w-full bg-white/4 border border-white/10 rounded-xl py-3 px-4 pr-24 text-white focus:outline-none focus:border-teal-500/40 [color-scheme:dark]"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    {naviPosition?.deposited && (
                      <button
                        onClick={() => setNaviDepositAmt(naviPosition.deposited.toFixed(6))}
                        className="text-xs text-teal-400 font-bold px-1.5 py-0.5 bg-teal-500/10 rounded hover:bg-teal-500/20 transition-colors"
                      >
                        MAX
                      </button>
                    )}
                    <span className="text-xs text-muted-foreground">SUI</span>
                  </div>
                </div>

                {naviPosition?.deposited ? (
                  <div className="bg-white/3 border border-white/8 rounded-xl p-3 mb-3 text-xs space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Your Navi balance</span>
                      <span className="text-teal-400 font-medium">{naviPosition.deposited.toFixed(4)} SUI</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">You withdraw</span>
                      <span className="font-medium">{(parseFloat(naviDepositAmt) || 0).toFixed(4)} SUI</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mb-3 text-center py-2">No active Navi position. Deposit SUI first.</p>
                )}

                <button
                  onClick={handleNaviWithdraw}
                  disabled={naviLoading || !parseFloat(naviDepositAmt) || !naviPosition?.deposited}
                  className="w-full py-3 bg-red-500/15 border border-red-500/30 rounded-xl text-red-400 font-semibold flex items-center justify-center gap-2 disabled:opacity-40 hover:bg-red-500/20 transition-colors"
                >
                  {naviLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '↩'}
                  Withdraw from Navi
                </button>
              </>
            )}
          </div>

        </div>

        <div className="text-center text-xs text-gray-500">
          <p>Wallet: {address ? `${address.slice(0,8)}...${address.slice(-4)}` : 'Not connected'}</p>
          <button onClick={fetchAllBalances} className="text-[#D4AF37] underline mt-2">Refresh</button>
        </div>

        </>)}
      </div>
    </main>
  )
}





