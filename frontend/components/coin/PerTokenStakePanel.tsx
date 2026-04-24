'use client'

import { useState, useEffect, useCallback } from 'react'
import { useCurrentWallet, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { Loader2, Gift, TrendingUp, TrendingDown } from 'lucide-react'
import { MOONBAGS_AIDA_CONTRACT, AIDA_COIN_TYPE, getPairType } from '@/lib/contracts_aida'
import { getMoonbagsContractForPackage } from '@/lib/contracts'

const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

interface Props {
  // Full coin type of the meme token, e.g. "0x9b23...::hero::HERO"
  coinType: string
  symbol: string
  // Package ID of the pool (used to route SUI vs AIDA contracts)
  moonbagsPackageId?: string
}

// Per-token staking widget. Stakers of the meme token (e.g. HERO) share the
// small portion of trading fees that the contract routes to meme stakers
// (currently ~1bp of fees per the init_stake_fee_withdraw config, so rewards
// are typically modest — the bulk goes to AIDA stakers via the global
// /staking page).
//
// Works for both AIDA-paired and SUI-paired pools. The SUI fork's
// moonbags_stake module is structurally identical to the AIDA fork's —
// same entry names, same signatures — just different reward coin (SUI
// vs AIDA). At pool creation both forks call initialize_staking_pool<Token>
// and initialize_creator_pool<Token>, so every pool launched under v11+
// (SUI) or v8 (AIDA) has the per-token pool ready to accept stake().
// Legacy v7 pools predate this and may abort on stake() — that's an
// edge case we don't handle here; the user just sees the move-call error.
export default function PerTokenStakePanel({ coinType, symbol, moonbagsPackageId }: Props) {
  const pairType = getPairType(moonbagsPackageId)
  const isAidaPair = pairType === 'AIDA'

  // Resolve the right moonbags bundle for the move-call target + stakeConfig.
  // For AIDA, we always hit the current v8 package. For SUI, we route to the
  // exact publish the pool was created under — the stakeConfig that owns its
  // per-token staking pool lives on that publish, not on "latest SUI".
  const pkgBundle = isAidaPair
    ? MOONBAGS_AIDA_CONTRACT
    : getMoonbagsContractForPackage(moonbagsPackageId)
  const pkgId     = pkgBundle.packageId
  const configId  = pkgBundle.stakeConfig
  // Reward coin flows through on-chain from distribute_fees — AIDA on the
  // AIDA fork, SUI on the SUI fork. Both are 9-decimal, so the conversion
  // math below is the same.
  const rewardSymbol = isAidaPair ? 'AIDA' : 'SUI'

  const { isConnected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts?.[0]?.address
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction()

  const [walletBalance, setWalletBalance] = useState<bigint>(0n)
  const [stakedBalance, setStakedBalance] = useState<bigint | null>(null)
  const [pendingReward, setPendingReward] = useState<bigint | null>(null)
  // Token decimals come from on-chain CoinMetadata<Token>.decimals, NOT from
  // the Configuration's stored `token_decimals` field (that's a display
  // preference, not authoritative). AIDA-fork bonding-curve tokens are
  // typically 6-decimal; SUI-fork tokens typically 9-decimal. We default
  // to 6 for the first render and overwrite once the metadata fetch lands.
  const [tokenDecimals, setTokenDecimals] = useState<number>(6)
  const [stakeInput, setStakeInput] = useState('')
  const [unstakeInput, setUnstakeInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info')

  // ── Query wallet balance of this token ───────────────────────────────────
  const refreshBalances = useCallback(async () => {
    if (!address) {
      setWalletBalance(0n)
      return
    }
    try {
      const bal = await suiClient.getBalance({ owner: address, coinType })
      setWalletBalance(BigInt(bal.totalBalance))
    } catch {
      setWalletBalance(0n)
    }

    // Attempt to read the user's pending rewards via devInspect.
    // calculate_rewards_earned returns a u64 in reward-coin mist
    // (AIDA mist for AIDA pairs, SUI mist for SUI pairs — both 9-decimal).
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
        // BCS u64: little-endian 8 bytes
        let v = 0n
        for (let i = 0; i < bytes.length && i < 8; i++) v |= BigInt(bytes[i]) << BigInt(i * 8)
        setPendingReward(v)
      }
    } catch {
      // devInspect can fail if the stake pool doesn't exist or user hasn't staked
      setPendingReward(null)
    }

    // Try to read the user's staked balance from the staking pool.
    // The staking pool is a dynamic object field on configId, keyed by the token type string.
    // The user's StakingAccount is a dynamic field on the pool, keyed by the user's address.
    if (address) {
      try {
        // Derive the staking pool key (same logic as in the Move contract)
        const stakingPoolKey = coinType
        // Get the staking pool object ID from the configuration's dynamic fields
        const poolFields = await suiClient.getDynamicFields({ parentId: configId, limit: 50 })
        const poolField = poolFields.data.find(f => f.name.value === stakingPoolKey)
        if (poolField?.objectId) {
          // Get the user's StakingAccount from the pool
          const accountFields = await suiClient.getDynamicFields({ parentId: poolField.objectId, limit: 50 })
          const accountField = accountFields.data.find(f => f.name.value === address)
          if (accountField?.objectId) {
            const accountObj = await suiClient.getObject({ id: accountField.objectId, options: { showContent: true } })
            const fields = accountObj.data?.content?.fields
            if (fields && typeof fields.balance === 'number') {
              setStakedBalance(BigInt(fields.balance))
            } else if (fields && typeof fields.balance === 'string') {
              setStakedBalance(BigInt(fields.balance))
            }
          } else {
            setStakedBalance(0n)
          }
        } else {
          // Staking pool doesn't exist for this token
          setStakedBalance(null)
        }
      } catch {
        setStakedBalance(null)
      }
    }
  }, [address, coinType, suiClient, configId, pkgId])

  useEffect(() => { refreshBalances() }, [refreshBalances])

  // Fetch the token's real on-chain decimals once per coinType. Frozen
  // at token publish, so no need to re-fetch. Default stays at 6 if the
  // fetch fails — worst case the display reads off by 10^3 until the
  // user refreshes, no fund-at-risk.
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

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setStatus(msg: string, type: 'info' | 'success' | 'error' = 'info') {
    setStatusMsg(msg); setStatusType(type)
  }

  // Convert user-entered amounts and on-chain mist using the token's
  // actual decimals (set in CoinMetadata at the token's publish). See
  // useEffect below for the fetch.
  function toMist(amount: string): bigint {
    const v = parseFloat(amount)
    if (!isFinite(v) || v <= 0) return 0n
    return BigInt(Math.floor(v * 10 ** tokenDecimals))
  }
  function fromMist(m: bigint): string {
    return (Number(m) / 10 ** tokenDecimals).toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  // Both AIDA and SUI are 9-decimal, so the same conversion works for either.
  function fromRewardMist(m: bigint): string {
    return (Number(m) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 6 })
  }

  // ── Stake ─────────────────────────────────────────────────────────────────
  async function handleStake() {
    if (!isConnected || !address) { setStatus('Connect your wallet first', 'error'); return }
    const mist = toMist(stakeInput)
    if (mist <= 0n) { setStatus('Enter a valid amount', 'error'); return }
    if (mist > walletBalance) { setStatus(`You only have ${fromMist(walletBalance)} ${symbol}`, 'error'); return }

    setLoading(true)
    setStatus('Preparing stake transaction…', 'info')
    try {
      // Collect + merge user's coins, then split the exact stake amount.
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
        arguments: [
          tx.object(configId),
          stakeCoin,
          tx.object(SUI_CLOCK),
        ],
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

  // ── Unstake ───────────────────────────────────────────────────────────────
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
        arguments: [
          tx.object(configId),
          tx.pure.u64(mist),
          tx.object(SUI_CLOCK),
        ],
      })
      setStatus('Approve in wallet…', 'info')
      const result = await signAndExecuteTransaction({ transaction: tx, chain: 'sui:mainnet' })
      await suiClient.waitForTransaction({ digest: result.digest })
      setStatus(`Unstaked ${fromMist(mist)} ${symbol} ✓`, 'success')
      setUnstakeInput('')
      await refreshBalances()
    } catch (e: any) {
      const msg = e?.message || ''
      const abortMatch = msg.match(/abort code[': ]+(\d+)/i)
      const abortCode = abortMatch ? parseInt(abortMatch[1]) : null
      if (msg.includes('EStakingPoolNotExist') || abortCode === 1 || msg.includes('3,-1')) {
        setStatus('Staking pool not initialized for this token', 'error')
      } else if (msg.includes('EAccountBalanceNotEnough') || abortCode === 4 || msg.includes('4,')) {
        setStatus('Insufficient staked balance', 'error')
      } else if (msg.includes('EUnstakeDeadlineNotAllow') || abortCode === 8 || msg.includes('8,')) {
        setStatus('Unstake temporarily denied (cooldown active)', 'error')
      } else if (msg.includes('EStakingAccountNotExist') || abortCode === 3 || msg.includes('3,')) {
        setStatus('No staking position found for this token', 'error')
      } else if (msg.includes('EInvalidAmount') || abortCode === 6) {
        setStatus('Invalid unstake amount', 'error')
      } else {
        setStatus(msg || 'Unstake failed — check your staked balance', 'error')
      }
    }
    setLoading(false)
  }

  // ── Claim Rewards ────────────────────────────────────────────────────────
  async function handleClaim() {
    if (!isConnected || !address) { setStatus('Connect your wallet first', 'error'); return }
    setLoading(true)
    setStatus('Claiming rewards…', 'info')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${pkgId}::moonbags_stake::claim_staking_pool`,
        typeArguments: [coinType],
        arguments: [
          tx.object(configId),
          tx.object(SUI_CLOCK),
        ],
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

      {/* Pending rewards + wallet + staked balance */}
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
          <div className="text-sm font-bold text-white">{stakedBalance !== null ? `${fromMist(stakedBalance)} ${symbol}` : '—'}</div>
        </div>
      </div>

      {/* Stake */}
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Stake amount</label>
        <div className="flex gap-2">
          <input
            type="number"
            min="0"
            value={stakeInput}
            onChange={e => setStakeInput(e.target.value)}
            placeholder="0"
            className="flex-1 bg-white/5 border border-gray-700 rounded-xl py-2.5 px-3 text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50 text-sm"
          />
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
          <input
            type="number"
            min="0"
            value={unstakeInput}
            onChange={e => setUnstakeInput(e.target.value)}
            placeholder="0"
            className="flex-1 bg-white/5 border border-gray-700 rounded-xl py-2.5 px-3 text-white placeholder:text-gray-600 focus:outline-none focus:border-red-500/50 text-sm"
          />
          <button
            onClick={() => { if (stakedBalance !== null && stakedBalance > 0n) setUnstakeInput(fromMist(stakedBalance)) }}
            disabled={stakedBalance === null || stakedBalance === 0n}
            className="px-3 py-2 rounded-xl bg-white/10 border border-gray-600 text-gray-300 text-xs font-bold hover:bg-white/20 transition-colors disabled:opacity-30"
            title="Max unstake"
          >
            MAX
          </button>
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
        Meme-token stakers share ~0.01% of trade fees — the bulk (~30%) goes to AIDA stakers globally
        (paid in {rewardSymbol} for this pool).
      </p>
    </div>
  )
}
