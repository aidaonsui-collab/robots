'use client'

import { useState, useEffect, useCallback } from 'react'
import { useCurrentWallet, useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { Loader2, Gift, TrendingUp, TrendingDown } from 'lucide-react'
import { MOONBAGS_AIDA_CONTRACT, AIDA_COIN_TYPE, getPairType } from '@/lib/contracts_aida'
import { getMoonbagsContractForPackage } from '@/lib/contracts'

const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

interface Props {
  coinType: string
  symbol: string
  moonbagsPackageId?: string
}

// Per-token staking widget. Works for both AIDA-paired and SUI-paired pools.
// Reads wallet balance + staked balance + pending rewards, lets the user
// stake / unstake / claim. Routes to the moonbags_stake module on the
// package matching the pool's pair type.
export default function PerTokenStakePanel({ coinType, symbol, moonbagsPackageId }: Props) {
  const pairType = getPairType(moonbagsPackageId)
  const isAidaPair = pairType === 'AIDA'

  const pkgBundle = isAidaPair
    ? MOONBAGS_AIDA_CONTRACT
    : getMoonbagsContractForPackage(moonbagsPackageId)
  const pkgId     = pkgBundle.packageId
  const configId  = pkgBundle.stakeConfig
  const rewardSymbol = isAidaPair ? 'AIDA' : 'SUI'

  // Use the SELECTED account (useCurrentAccount), not accounts[0] — matches
  // what the parent page uses so balances don't drift.
  const { isConnected } = useCurrentWallet()
  const currentAccount = useCurrentAccount()
  const address = currentAccount?.address
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction()

  const [walletBalance, setWalletBalance] = useState<bigint>(0n)
  const [stakedBalance, setStakedBalance] = useState<bigint | null>(null)
  const [pendingReward, setPendingReward] = useState<bigint | null>(null)
  const [tokenDecimals, setTokenDecimals] = useState<number>(6)
  const [stakeInput, setStakeInput] = useState('')
  const [unstakeInput, setUnstakeInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info')

  // ── Wallet balance of this token ─────────────────────────────────────────
  const [balanceTick, setBalanceTick] = useState(0)
  const refetchTokenCoins = useCallback(() => setBalanceTick(t => t + 1), [])
  useEffect(() => {
    if (!address || !coinType) {
      setWalletBalance(0n)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await suiClient.getCoins({ owner: address, coinType })
        if (cancelled) return
        const coins = res?.data ?? []
        const total = coins.reduce((s: bigint, c: any) => s + BigInt(c.balance), 0n)
        setWalletBalance(total)
      } catch {
        if (!cancelled) setWalletBalance(0n)
      }
    })()
    return () => { cancelled = true }
  }, [address, coinType, suiClient, balanceTick])

  // ── Pending rewards (devInspect into calculate_rewards_earned) ───────────
  const refreshRewards = useCallback(async () => {
    if (!address) {
      setPendingReward(null)
      return
    }
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${pkgId}::moonbags_stake::calculate_rewards_earned`,
        typeArguments: [coinType],
        arguments: [tx.object(configId)],
      })
      const result = await suiClient.devInspectTransactionBlock({
        sender: address,
        transactionBlock: tx,
      })
      const returnVals = (result?.results?.[0]?.returnValues ?? []) as Array<[number[], string]>
      if (returnVals.length > 0) {
        const bytes = Uint8Array.from(returnVals[0][0])
        let v = 0n
        for (let i = 0; i < bytes.length && i < 8; i++) v |= BigInt(bytes[i]) << BigInt(i * 8)
        setPendingReward(v)
      }
    } catch {
      setPendingReward(null)
    }
  }, [address, coinType, suiClient, configId, pkgId])

  useEffect(() => { refreshRewards() }, [refreshRewards])

  // ── Staked balance ───────────────────────────────────────────────────────
  // Two-hop dynamic-field lookup: first find the per-token staking pool on
  // the stakeConfig, then find the user's StakingAccount on that pool, then
  // read the account's `balance` field. Null = pool not initialized / read
  // failed. 0n = no stake.
  const [stakedTick, setStakedTick] = useState(0)
  const refetchStaked = useCallback(() => setStakedTick(t => t + 1), [])
  useEffect(() => {
    if (!address || !coinType || !configId) {
      setStakedBalance(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        // The Move side keys the staking pool by the FULL type name of
        // `StakingPool<StakingToken>` (per moonbags_stake.move:173,
        // `type_name::into_string(type_name::get<StakingPool<StakingToken>>())`),
        // NOT by the bare coinType. Match on the inner `objectType` (or the
        // raw `name.value` as a fallback) — both contain the coinType's
        // hex address. Tolerant to 0x-prefix encoding differences. Paginate
        // in case the configId hosts >50 staking pools.
        const coinAddrLower = coinType.replace(/^0x/, '').toLowerCase()
        let poolField: any = null
        let cursor: any = null
        for (let page = 0; page < 10 && !poolField && !cancelled; page++) {
          const res = await suiClient.getDynamicFields({ parentId: configId, cursor, limit: 50 })
          if (cancelled) return
          poolField = res.data.find((f: any) => {
            const objType: string = (f?.objectType ?? '').toLowerCase()
            const nameVal: string = String(f?.name?.value ?? '').toLowerCase()
            const matchesCoin = objType.includes(coinAddrLower) || nameVal.includes(coinAddrLower)
            const matchesPool = objType.includes('stakingpool') || nameVal.includes('stakingpool')
            return matchesPool && matchesCoin
          })
          if (poolField || !res.hasNextPage || !res.nextCursor) break
          cursor = res.nextCursor
        }
        if (!poolField?.objectId) {
          setStakedBalance(null)
          return
        }
        // The StakingAccount is keyed by `staker_address` (an address, not
        // a string). RPC returns address keys as hex strings — normalize
        // both sides for the compare so we tolerate 0x-prefix variations.
        const myAddrLower = (address ?? '').replace(/^0x/, '').toLowerCase()
        let accountField: any = null
        let acctCursor: any = null
        for (let page = 0; page < 10 && !accountField && !cancelled; page++) {
          const res = await suiClient.getDynamicFields({ parentId: poolField.objectId, cursor: acctCursor, limit: 50 })
          if (cancelled) return
          accountField = res.data.find((f: any) => {
            const v: string = String(f?.name?.value ?? '').replace(/^0x/, '').toLowerCase()
            return v === myAddrLower
          })
          if (accountField || !res.hasNextPage || !res.nextCursor) break
          acctCursor = res.nextCursor
        }
        if (!accountField?.objectId) {
          setStakedBalance(0n)
          return
        }
        const accountObj = await suiClient.getObject({ id: accountField.objectId, options: { showContent: true } })
        if (cancelled) return
        const fields = (accountObj.data?.content as any)?.fields
        if (fields?.balance !== undefined && fields?.balance !== null) {
          setStakedBalance(BigInt(fields.balance))
        } else {
          setStakedBalance(0n)
        }
      } catch {
        if (!cancelled) setStakedBalance(null)
      }
    })()
    return () => { cancelled = true }
  }, [address, coinType, suiClient, configId, stakedTick])

  const refreshBalances = useCallback(async () => {
    refetchTokenCoins()
    refetchStaked()
    await refreshRewards()
  }, [refreshRewards, refetchTokenCoins, refetchStaked])

  // ── Token decimals from CoinMetadata ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const meta = await suiClient.getCoinMetadata({ coinType })
        if (!cancelled && meta && typeof meta.decimals === 'number') {
          setTokenDecimals(meta.decimals)
        }
      } catch {
        // Leave default
      }
    })()
    return () => { cancelled = true }
  }, [coinType, suiClient])

  // ── Helpers ──────────────────────────────────────────────────────────────
  function setStatus(msg: string, type: 'info' | 'success' | 'error' = 'info') {
    setStatusMsg(msg); setStatusType(type)
  }
  function toMist(amount: string): bigint {
    const v = parseFloat(amount)
    if (!isFinite(v) || v <= 0) return 0n
    return BigInt(Math.floor(v * 10 ** tokenDecimals))
  }
  function fromMist(m: bigint): string {
    return (Number(m) / 10 ** tokenDecimals).toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  function fromRewardMist(m: bigint): string {
    return (Number(m) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 6 })
  }

  // ── Stake ────────────────────────────────────────────────────────────────
  async function handleStake() {
    if (!isConnected || !address) { setStatus('Connect your wallet first', 'error'); return }
    const mist = toMist(stakeInput)
    if (mist <= 0n) { setStatus('Enter a valid amount', 'error'); return }
    if (mist > walletBalance) { setStatus(`You only have ${fromMist(walletBalance)} ${symbol}`, 'error'); return }

    setLoading(true)
    setStatus('Preparing stake transaction…', 'info')
    try {
      const { data: coins } = await suiClient.getCoins({ owner: address, coinType })
      if (!coins.length) { setStatus(`No ${symbol} coins in wallet`, 'error'); setLoading(false); return }

      const tx = new Transaction()
      const base = tx.object(coins[0].coinObjectId)
      for (let i = 1; i < coins.length; i++) {
        tx.moveCall({
          target: '0x2::pay::join',
          typeArguments: [coinType],
          arguments: [base, tx.object(coins[i].coinObjectId)],
        })
      }
      const [stakeCoin] = tx.splitCoins(base, [tx.pure.u64(mist)])

      tx.moveCall({
        target: `${pkgId}::moonbags_stake::stake`,
        typeArguments: [coinType],
        arguments: [tx.object(configId), stakeCoin, tx.object(SUI_CLOCK)],
      })

      setStatus('Approve in wallet…', 'info')
      const result = await signAndExecuteTransaction({ transaction: tx, chain: 'sui:mainnet' })
      await suiClient.waitForTransaction({ digest: result.digest })
      setStatus(`Staked ${fromMist(mist)} ${symbol} ✓`, 'success')
      setStakeInput('')
      await refreshBalances()
    } catch (e: any) {
      setStatus(e?.message || 'Stake failed', 'error')
    }
    setLoading(false)
  }

  // ── Unstake ──────────────────────────────────────────────────────────────
  async function handleUnstake() {
    if (!isConnected || !address) { setStatus('Connect your wallet first', 'error'); return }
    const mist = toMist(unstakeInput)
    if (mist <= 0n) { setStatus('Enter a valid amount', 'error'); return }

    setLoading(true)
    setStatus('Preparing unstake transaction…', 'info')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${pkgId}::moonbags_stake::unstake`,
        typeArguments: [coinType],
        arguments: [tx.object(configId), tx.pure.u64(mist), tx.object(SUI_CLOCK)],
      })
      setStatus('Approve in wallet…', 'info')
      const result = await signAndExecuteTransaction({ transaction: tx, chain: 'sui:mainnet' })
      await suiClient.waitForTransaction({ digest: result.digest })
      setStatus(`Unstaked ${fromMist(mist)} ${symbol} ✓`, 'success')
      setUnstakeInput('')
      await refreshBalances()
    } catch (e: any) {
      // Map known contract abort codes to friendlier messages.
      const msg = e?.message || ''
      const abortMatch = msg.match(/abort code[': ]+(\d+)/i)
      const abortCode = abortMatch ? parseInt(abortMatch[1], 10) : null
      if (msg.includes('EStakingPoolNotExist') || abortCode === 1) {
        setStatus('Staking pool not initialized for this token', 'error')
      } else if (msg.includes('EStakingAccountNotExist') || abortCode === 3) {
        setStatus('No staking position found for this token', 'error')
      } else if (msg.includes('EAccountBalanceNotEnough') || abortCode === 4) {
        setStatus('Insufficient staked balance', 'error')
      } else if (msg.includes('EInvalidAmount') || abortCode === 6) {
        setStatus('Invalid unstake amount', 'error')
      } else if (msg.includes('EUnstakeDeadlineNotAllow') || abortCode === 8) {
        setStatus('Unstake is in cooldown — try again shortly', 'error')
      } else {
        setStatus(msg || 'Unstake failed — check your staked balance', 'error')
      }
    }
    setLoading(false)
  }

  // ── Claim ────────────────────────────────────────────────────────────────
  async function handleClaim() {
    if (!isConnected || !address) { setStatus('Connect your wallet first', 'error'); return }
    setLoading(true)
    setStatus('Claiming rewards…', 'info')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${pkgId}::moonbags_stake::claim_staking_pool`,
        typeArguments: [coinType],
        arguments: [tx.object(configId), tx.object(SUI_CLOCK)],
      })
      setStatus('Approve in wallet…', 'info')
      const result = await signAndExecuteTransaction({ transaction: tx, chain: 'sui:mainnet' })
      await suiClient.waitForTransaction({ digest: result.digest })
      setStatus('Rewards claimed ✓', 'success')
      await refreshBalances()
    } catch (e: any) {
      setStatus(e?.message || 'Claim failed', 'error')
    }
    setLoading(false)
  }

  return (
    <div className="bg-[#0f0f17] border border-gray-800/60 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Stake {symbol}</h2>
        <p className="text-xs text-gray-500">
          Stake your {symbol} to earn a share of this token's trading fees (paid in {rewardSymbol}).
        </p>
      </div>

      {/* Pending rewards + wallet + staked */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white/5 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Pending Rewards</div>
          <div className="text-sm font-bold text-[#D4AF37]">
            {pendingReward !== null ? `${fromRewardMist(pendingReward)} ${rewardSymbol}` : '—'}
          </div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">In Wallet</div>
          <div className="text-sm font-bold text-white">{fromMist(walletBalance)} {symbol}</div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Staked</div>
          <div className="text-sm font-bold text-white">
            {stakedBalance !== null ? `${fromMist(stakedBalance)} ${symbol}` : '—'}
          </div>
        </div>
      </div>

      {/* Stake */}
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Stake amount</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              min="0"
              value={stakeInput}
              onChange={e => setStakeInput(e.target.value)}
              placeholder="0"
              className="w-full bg-white/5 border border-gray-700 rounded-xl py-2.5 pl-3 pr-14 text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                if (walletBalance > 0n) setStakeInput(fromMist(walletBalance).replace(/,/g, ''))
              }}
              disabled={walletBalance === 0n || loading || !isConnected}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md bg-white/10 border border-gray-600 text-[10px] font-bold text-gray-300 hover:bg-white/20 transition-colors disabled:opacity-50"
            >
              MAX
            </button>
          </div>
          <button
            onClick={handleStake}
            disabled={loading || !isConnected}
            className="px-4 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-sm font-bold hover:bg-emerald-500/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
            Stake
          </button>
        </div>
      </div>

      {/* Unstake */}
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Unstake amount</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              min="0"
              value={unstakeInput}
              onChange={e => setUnstakeInput(e.target.value)}
              placeholder="0"
              className="w-full bg-white/5 border border-gray-700 rounded-xl py-2.5 pl-3 pr-14 text-white placeholder:text-gray-600 focus:outline-none focus:border-red-500/50 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                if (stakedBalance !== null && stakedBalance > 0n) {
                  setUnstakeInput(fromMist(stakedBalance).replace(/,/g, ''))
                }
              }}
              disabled={stakedBalance === null || stakedBalance === 0n || loading || !isConnected}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md bg-white/10 border border-gray-600 text-[10px] font-bold text-gray-300 hover:bg-white/20 transition-colors disabled:opacity-50"
            >
              MAX
            </button>
          </div>
          <button
            onClick={handleUnstake}
            disabled={loading || !isConnected}
            className="px-4 py-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-sm font-bold hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingDown className="w-4 h-4" />}
            Unstake
          </button>
        </div>
      </div>

      {/* Claim */}
      <button
        onClick={handleClaim}
        disabled={loading || !isConnected}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-[#D4AF37]/20 to-[#FFD700]/20 border border-[#D4AF37]/40 text-[#D4AF37] font-bold text-sm hover:from-[#D4AF37]/30 hover:to-[#FFD700]/30 transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
        Claim {rewardSymbol} Rewards
      </button>

      {/* Status */}
      {statusMsg && (
        <div className={`p-3 rounded-xl text-xs text-center border ${
          statusType === 'success' ? 'bg-green-900/20 border-green-500/30 text-green-400' :
          statusType === 'error'   ? 'bg-red-900/20 border-red-500/30 text-red-400' :
          'bg-purple-900/20 border-purple-500/30 text-gray-300'
        }`}>
          {statusMsg}
        </div>
      )}

      <p className="text-[10px] text-gray-600 text-center leading-relaxed">
        Fees are distributed once per day by the platform cron.
        Meme-token stakers share ~10% of trade fees; AIDA stakers globally share ~25%
        (paid in {rewardSymbol} for this pool).
      </p>
    </div>
  )
}
