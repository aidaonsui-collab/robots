'use client'

import { useState, useEffect, useCallback } from 'react'
import { useCurrentWallet, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { Loader2, Gift, TrendingUp, TrendingDown } from 'lucide-react'
import { MOONBAGS_AIDA_CONTRACT, AIDA_COIN_TYPE, getPairType } from '@/lib/contracts_aida'

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
// This widget only renders meaningfully for AIDA-paired pools; SUI-paired
// (v11/v12) pools use a different legacy staking config and aren't wired
// up here yet.
export default function PerTokenStakePanel({ coinType, symbol, moonbagsPackageId }: Props) {
  const pairType = getPairType(moonbagsPackageId)
  const isAidaPair = pairType === 'AIDA'

  const { isConnected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts?.[0]?.address
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction()

  const [walletBalance, setWalletBalance] = useState<bigint>(0n)
  const [stakedBalance, setStakedBalance] = useState<bigint | null>(null)
  const [pendingRewardAida, setPendingRewardAida] = useState<bigint | null>(null)
  const [stakeInput, setStakeInput] = useState('')
  const [unstakeInput, setUnstakeInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info')

  const configId = MOONBAGS_AIDA_CONTRACT.stakeConfig

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

    // Attempt to read the user's stake balance + pending rewards via devInspect.
    // calculate_rewards_earned returns a u64; BCS-decoded as the u64 pending reward in AIDA mist.
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${MOONBAGS_AIDA_CONTRACT.packageId}::moonbags_stake::calculate_rewards_earned`,
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
        setPendingRewardAida(v)
      }
    } catch {
      // devInspect can fail if the stake pool doesn't exist or user hasn't staked
      setPendingRewardAida(null)
    }
  }, [address, coinType, suiClient, configId])

  useEffect(() => { refreshBalances() }, [refreshBalances])

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setStatus(msg: string, type: 'info' | 'success' | 'error' = 'info') {
    setStatusMsg(msg); setStatusType(type)
  }

  // Assume TOKEN_DECIMALS = 6 for bonding-curve meme tokens (matches create flow).
  const TOKEN_DECIMALS = 6
  function toMist(amount: string): bigint {
    const v = parseFloat(amount)
    if (!isFinite(v) || v <= 0) return 0n
    return BigInt(Math.floor(v * 10 ** TOKEN_DECIMALS))
  }
  function fromMist(m: bigint): string {
    return (Number(m) / 10 ** TOKEN_DECIMALS).toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  function fromAidaMist(m: bigint): string {
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
        target: `${MOONBAGS_AIDA_CONTRACT.packageId}::moonbags_stake::stake`,
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
        target: `${MOONBAGS_AIDA_CONTRACT.packageId}::moonbags_stake::unstake`,
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
      setStatus(e?.message || 'Unstake failed', 'error')
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
        target: `${MOONBAGS_AIDA_CONTRACT.packageId}::moonbags_stake::claim_staking_pool`,
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

  if (!isAidaPair) {
    return (
      <div className="bg-[#0f0f17] border border-gray-800/60 rounded-2xl p-6">
        <p className="text-gray-400 text-sm">Per-token staking is only available for AIDA-paired pools.</p>
      </div>
    )
  }

  return (
    <div className="bg-[#0f0f17] border border-gray-800/60 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Stake {symbol}</h2>
        <p className="text-xs text-gray-500">
          Stake your {symbol} to earn a share of this token's trading fees (paid in AIDA).
        </p>
      </div>

      {/* Pending rewards + staked balance */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/5 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Pending Rewards</div>
          <div className="text-sm font-bold text-[#D4AF37]">
            {pendingRewardAida !== null ? `${fromAidaMist(pendingRewardAida)} AIDA` : '—'}
          </div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">In Wallet</div>
          <div className="text-sm font-bold text-white">{fromMist(walletBalance)} {symbol}</div>
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
        Claim AIDA Rewards
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
        Meme-token stakers share ~0.01% of trade fees — the bulk (~30%) goes to AIDA stakers globally.
      </p>
    </div>
  )
}
