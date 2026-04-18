'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useCurrentWallet } from '@mysten/dapp-kit'
import { Coins, ArrowUpRight, Gift, Loader2, Wallet } from 'lucide-react'
import { Transaction as TransactionBlock } from '@mysten/sui/transactions'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const AIDA_TYPE = '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'
const STAKING_PACKAGE = '0x50e60400cc2ea760b5fb8380fa3f1fc0a94dfc592ec78487313d21b50af846da'
const STAKING_CONFIG = '0x4ca7022cd11cbe5bd66577b1e28adca0592dd10102b85e12cd8c8a08796a8be9'
const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

export default function StakingPage() {
  const { isConnected: connected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts?.[0]?.address
  const [loading, setLoading] = useState(false)
  const [stakedAmount, setStakedAmount] = useState('')
  const [userAidaBalance, setUserAidaBalance] = useState(0)
  const [userStaked, setUserStaked] = useState(0)
  const [userRewards, setUserRewards] = useState(0)
  const [unstakeDeadline, setUnstakeDeadline] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    if (connected && address) {
      fetchBalance()
    }
  }, [connected, address])

  const fetchBalance = async () => {
    if (!address) return
    setStatusMsg('Fetching wallet...')
    
    try {
      // Get wallet AIDA balance
      const response = await fetch(SUI_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getBalance',
          params: [address, AIDA_TYPE]
        })
      })
      
      const data = await response.json()
      
      if (data.result?.totalBalance) {
        const bal = Number(data.result.totalBalance) / 1e9
        setUserAidaBalance(bal)
        setStatusMsg(`Wallet: ${bal.toFixed(2)} AIDA`)
      }
      
      // Get staked amount - use simpler direct query
      setStatusMsg('Fetching staked...')
      
      // Direct pool ID - we know it's 0x2a7611a0660c89532160d193057383796f45c96040f1a9c66746298ad929883a
      const poolId = '0x2a7611a0660c89532160d193057383796f45c96040f1a9c66746298ad929883a'
      
      const userStakeResp = await fetch(SUI_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getDynamicFieldObject',
          params: [poolId, { type: 'address', value: address }]
        })
      })
      
      const userStakeData = await userStakeResp.json()
      console.log('User stake data:', userStakeData)
      
      if (userStakeData.result?.data?.content?.fields) {
        const fields = userStakeData.result.data.content.fields
        // Balance is in MIST (9 decimals)
        const balance = Number(fields.balance || 0) / 1e9
        const earned = Number(fields.earned || 0) / 1e9
        const deadline = Number(fields.unstake_deadline || 0)
        setUserStaked(balance)
        setUserRewards(earned)
        setUnstakeDeadline(deadline)
        
        // Calculate time remaining
        const now = Date.now()
        if (deadline > now) {
          const minsLeft = Math.ceil((deadline - now) / 60000)
          setStatusMsg(`Staked: ${balance.toFixed(2)} | Unstake in ~${minsLeft} min`)
        } else {
          setStatusMsg(`Staked: ${balance.toFixed(2)} | Rewards: ${earned.toFixed(4)} SUI`)
        }
      } else {
        setStatusMsg('No staked amount')
      }
      
    } catch (e: any) {
      console.error('Fetch error:', e)
      setStatusMsg('Error: ' + e.message)
    }
  }

  const handleStake = async () => {
    if (!connected || !address) {
      alert('Please connect your wallet')
      return
    }
    if (!stakedAmount || parseFloat(stakedAmount) <= 0) {
      alert('Enter amount')
      return
    }
    if (parseFloat(stakedAmount) > userAidaBalance) {
      alert('Insufficient balance')
      return
    }

    setLoading(true)
    setStatusMsg('Getting coin...')
    
    try {
      const coinsResp = await fetch(SUI_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getCoins',
          params: [address, AIDA_TYPE, null, 1]
        })
      })
      
      const coinsData = await coinsResp.json()
      
      if (!coinsData.result?.data || coinsData.result.data.length === 0) {
        alert('No AIDA coins found')
        setLoading(false)
        return
      }
      
      const coin = coinsData.result.data[0]
      const stakeAmountMist = BigInt(parseFloat(stakedAmount) * 1e9)
      
      setStatusMsg('Signing transaction...')
      
      const tx = new TransactionBlock()
      const [stakeCoin] = tx.splitCoins(tx.object(coin.coinObjectId), [tx.pure.u64(stakeAmountMist)])
      
      tx.moveCall({
        target: `${STAKING_PACKAGE}::moonbags_stake::stake`,
        typeArguments: [AIDA_TYPE],
        arguments: [tx.object(STAKING_CONFIG), stakeCoin, tx.object(SUI_CLOCK)]
      })
      
      if ((currentWallet as any).signAndExecuteTransactionBlock) {
        const result = await (currentWallet as any).signAndExecuteTransactionBlock({ transactionBlock: tx })
        console.log('Stake result:', result)
        setStatusMsg('Staked!')
        alert(`✅ Successfully staked ${stakedAmount} AIDA!\n\nTx: ${result.digest}`)
        setStakedAmount('')
        fetchBalance()
      } else {
        alert('Wallet does not support transactions')
      }
      
    } catch (e: any) {
      console.error(e)
      setStatusMsg('Error: ' + e.message)
      alert('Transaction failed: ' + e.message)
    }
    setLoading(false)
  }

  const handleClaim = async () => {
    if (!connected || !address) {
      alert('Connect wallet first')
      return
    }
    if (userRewards <= 0) {
      alert('No rewards to claim')
      return
    }
    
    setLoading(true)
    setStatusMsg('Claiming...')
    
    try {
      const tx = new TransactionBlock()
      tx.moveCall({
        target: `${STAKING_PACKAGE}::moonbags_stake::claim_staking_pool`,
        typeArguments: [AIDA_TYPE],
        arguments: [tx.object(STAKING_CONFIG), tx.object(SUI_CLOCK)]
      })
      
      if ((currentWallet as any).signAndExecuteTransactionBlock) {
        const result = await (currentWallet as any).signAndExecuteTransactionBlock({ transactionBlock: tx })
        setStatusMsg('Claimed!')
        alert(`✅ Successfully claimed ${userRewards.toFixed(4)} SUI!\n\nTx: ${result.digest}`)
        fetchBalance()
      }
    } catch (e: any) {
      alert('Claim failed: ' + e.message)
    }
    setLoading(false)
  }

  const handleUnstake = async () => {
    if (!connected || !address) {
      alert('Connect wallet first')
      return
    }
    if (userStaked <= 0) {
      alert('No staked tokens')
      return
    }
    
    // Check unstake deadline
    const now = Date.now()
    if (unstakeDeadline > now) {
      const minsLeft = Math.ceil((unstakeDeadline - now) / 60000)
      alert(`Cannot unstake yet. Please wait ~${minsLeft} more minutes (1 hour lockup)`)
      return
    }
    
    setLoading(true)
    setStatusMsg('Unstaking...')
    
    try {
      const tx = new TransactionBlock()
      tx.moveCall({
        target: `${STAKING_PACKAGE}::moonbags_stake::unstake`,
        typeArguments: [AIDA_TYPE],
        arguments: [
          tx.object(STAKING_CONFIG),
          tx.pure.u64(BigInt(Math.floor(userStaked * 1e9))),
          tx.object(SUI_CLOCK)
        ]
      })
      
      if ((currentWallet as any).signAndExecuteTransactionBlock) {
        const result = await (currentWallet as any).signAndExecuteTransactionBlock({ transactionBlock: tx })
        setStatusMsg('Unstaked!')
        alert(`✅ Successfully unstaked ${userStaked.toFixed(2)} AIDA!\n\nTx: ${result.digest}`)
        fetchBalance()
      }
    } catch (e: any) {
      alert('Unstake failed: ' + e.message)
    }
    setLoading(false)
  }

  return (
    <main className="min-h-screen pt-20 pb-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold gradient-text mb-4">
            Unlock Rewards with $AIDA
          </h1>
          <p className="text-muted-foreground">
            Stake $AIDA to earn 30% of all trading fees
          </p>
        </div>

        {statusMsg && (
          <div className="text-center mb-4 text-sm text-yellow-400">{statusMsg}</div>
        )}

        <div className="bg-card border border-purple-500/30 rounded-2xl p-6 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-green-500 flex items-center justify-center">
              <Coins className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">$AIDA Staking</h2>
              <p className="text-muted-foreground text-sm">Earn 30% of platform trading fees</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-background/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Wallet className="w-4 h-4" />
                <span className="text-sm">Wallet Balance</span>
              </div>
              <p className="text-2xl font-bold">{userAidaBalance.toFixed(2)} <span className="text-sm text-muted-foreground">AIDA</span></p>
            </div>
            
            <div className="bg-background/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Coins className="w-4 h-4" />
                <span className="text-sm">Staked</span>
              </div>
              <p className="text-2xl font-bold text-purple-400">{userStaked.toFixed(2)} <span className="text-sm text-muted-foreground">AIDA</span></p>
            </div>
            
            <div className="bg-background/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Gift className="w-4 h-4" />
                <span className="text-sm">Pending Rewards</span>
              </div>
              <p className="text-2xl font-bold text-green-400">{userRewards.toFixed(4)} <span className="text-sm text-muted-foreground">SUI</span></p>
            </div>
            
            <div className="bg-background/50 rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <span className="text-sm">Your Share</span>
              </div>
              <p className="text-2xl font-bold text-purple-400">30%</p>
            </div>
          </div>

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
                  onClick={() => setStakedAmount(userAidaBalance > 0 ? userAidaBalance.toString() : '')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs bg-purple-500/20 text-purple-400 rounded"
                >
                  MAX
                </button>
              </div>
              <button
                onClick={handleStake}
                disabled={loading || !stakedAmount || parseFloat(stakedAmount) <= 0}
                className="px-6 py-3 bg-purple-500 rounded-xl font-semibold disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Stake'}
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <button 
              onClick={handleUnstake}
              disabled={loading || userStaked <= 0}
              className="flex-1 py-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 disabled:opacity-50"
            >
              Unstake All
            </button>
            <button 
              onClick={handleClaim}
              disabled={loading || userRewards <= 0}
              className="flex-1 py-3 bg-green-500/20 border border-green-500/30 rounded-xl text-green-400 disabled:opacity-50"
            >
              Claim {userRewards.toFixed(4)} SUI
            </button>
          </div>
        </div>

        <div className="text-center text-xs text-gray-500">
          <p>Wallet: {address ? `${address.slice(0,8)}...${address.slice(-4)}` : 'Not connected'}</p>
          <button onClick={fetchBalance} className="text-purple-400 underline mt-2">
            Refresh
          </button>
        </div>
      </div>
    </main>
  )
}
