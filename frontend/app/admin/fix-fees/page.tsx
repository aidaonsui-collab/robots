'use client'

import { useState } from 'react'
import { useCurrentWallet, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'

const PACKAGE_ID    = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'
const CONFIGURATION = '0xfb774b5c4902d7d39e899388f520db0e2b1a6dca72687803b894d7d67eca9326'  // v7 — all pools use v7
const ADMIN_CAP     = '0x71e180b7bd65f62b7d3dad50f0a73b92f7adf8e999037363ed648c89c7c446a8'
const SUI_CLOCK     = '0x0000000000000000000000000000000000000000000000000000000000000006'
const ADMIN_WALLET  = '0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409'

const AIDA_TYPE_NAME = 'cee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'

export default function AdminFixFeesPage() {
  const { isConnected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts?.[0]?.address
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  const isAdmin = address?.toLowerCase() === ADMIN_WALLET.toLowerCase()

  const handleFix = async () => {
    if (!isAdmin) { setStatus('❌ Not admin wallet'); return }
    setLoading(true)
    setStatus('Building transaction...')

    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${PACKAGE_ID}::moonbags::update_config`,
        arguments: [
          tx.object(ADMIN_CAP),
          tx.object(CONFIGURATION),
          tx.pure.u64(200n),                     // platform_fee 2% (unchanged)
          tx.pure.u64(533333333500000n),          // initial_virtual_token_reserves (unchanged)
          tx.pure.u64(1066666667000000n),          // remain_token_reserves (unchanged)
          tx.pure.u8(6),                           // token_decimals (unchanged)
          tx.pure.u16(4000),                       // init_platform_fee_withdraw  → 40% to admin wallet
          tx.pure.u16(3000),                       // init_creator_fee_withdraw   → 30% to creator
          tx.pure.u16(1),                          // init_stake_fee_withdraw     → 0.01% dust (avoids zero abort)
          tx.pure.u16(2999),                       // init_platform_stake_fee_withdraw → ~30% to AIDA stakers
          tx.pure.string(AIDA_TYPE_NAME),          // token_platform_type_name (unchanged, no 0x)
          tx.object(SUI_CLOCK),
        ],
      })

      setStatus('Waiting for wallet signature...')
      const result = await signAndExecute({ transaction: tx })
      setStatus(`✅ Fees updated! Tx: ${result.digest}`)
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message ?? 'unknown'}`)
    }
    setLoading(false)
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="bg-[#0f0f17] border border-gray-800/60 rounded-xl p-8 max-w-lg w-full space-y-6">
        <h1 className="text-2xl font-bold gradient-text">Fix Fee Split Config</h1>

        <div className="space-y-3 text-sm">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <p className="text-red-400 font-semibold mb-2">Current config (broken)</p>
            <div className="text-gray-400 space-y-1 font-mono text-xs">
              <p>platform_fee_withdraw:       3000 (30% → admin)</p>
              <p>creator_fee_withdraw:        4000 (40% → creator)</p>
              <p>stake_fee_withdraw:          3000 (30% → meme token stakers)</p>
              <p>platform_stake_fee_withdraw: 0    (0% → AIDA stakers) ← CRASHES</p>
            </div>
          </div>

          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <p className="text-green-400 font-semibold mb-2">New config</p>
            <div className="text-gray-400 space-y-1 font-mono text-xs">
              <p>platform_fee_withdraw:       4000 (40% → admin wallet)</p>
              <p>creator_fee_withdraw:        3000 (30% → creator)</p>
              <p>stake_fee_withdraw:             1 (0.01% dust → avoids zero abort)</p>
              <p>platform_stake_fee_withdraw: 2999 (~30% → AIDA stakers)</p>
            </div>
            <p className="text-gray-500 text-xs mt-2">
              The 0.01% dust on stake_fee_withdraw is needed because the contract
              aborts when trying to deposit 0 SUI. On 1 SUI of fees this is 0.0001 SUI.
            </p>
          </div>

          <div className="bg-[#0a0a14] rounded-lg p-4 space-y-1">
            <p className="text-gray-500 text-xs">Connected: {isConnected ? '✅' : '❌'}</p>
            <p className="text-gray-500 text-xs">Address: {address?.slice(0, 10)}...{address?.slice(-6)}</p>
            <p className="text-gray-500 text-xs">Is Admin: {isAdmin ? '✅' : '❌'}</p>
          </div>
        </div>

        <button
          onClick={handleFix}
          disabled={!isAdmin || loading}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
            isAdmin && !loading
              ? 'bg-purple-600 hover:bg-purple-500 text-white cursor-pointer'
              : 'bg-gray-800 text-gray-500 cursor-not-allowed'
          }`}
        >
          {loading ? 'Executing...' : 'Update Fee Split'}
        </button>

        {status && (
          <p className={`text-sm break-all ${status.startsWith('✅') ? 'text-green-400' : status.startsWith('❌') ? 'text-red-400' : 'text-yellow-400'}`}>
            {status}
          </p>
        )}
      </div>
    </main>
  )
}
