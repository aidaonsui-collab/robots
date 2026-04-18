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

export default function AdminFixPage() {
  const { isConnected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts?.[0]?.address
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  const isAdmin = address?.toLowerCase() === ADMIN_WALLET.toLowerCase()

  const handleFixFeeSplit = async () => {
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
          tx.pure.u64(200n),                      // platform_fee: 2% (unchanged)
          tx.pure.u64(533333333500000n),           // initial_virtual_token_reserves (unchanged)
          tx.pure.u64(1066666667000000n),          // remain_token_reserves (unchanged)
          tx.pure.u8(6),                           // token_decimals (unchanged)
          tx.pure.u16(4000),                       // init_platform_fee_withdraw:       40% → admin wallet
          tx.pure.u16(3000),                       // init_creator_fee_withdraw:        30% → creator pool
          tx.pure.u16(1),                          // init_stake_fee_withdraw:          ~0% dust (avoids zero abort)
          tx.pure.u16(2999),                       // init_platform_stake_fee_withdraw: ~30% → AIDA stakers
          tx.pure.string(AIDA_TYPE_NAME),          // token_platform_type_name (no 0x)
          tx.object(SUI_CLOCK),
        ],
      })

      setStatus('Waiting for wallet signature...')
      const result = await signAndExecute({ transaction: tx })
      setStatus(`✅ Done! Tx: ${result.digest}`)
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message ?? 'unknown'}`)
    }
    setLoading(false)
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="bg-[#0f0f17] border border-gray-800/60 rounded-xl p-8 max-w-lg w-full space-y-6">
        <h1 className="text-2xl font-bold gradient-text">Admin: Fix Fee Split</h1>

        <div className="space-y-3 text-sm">
          <div className="bg-[#0a0a14] rounded-lg p-4 space-y-1">
            <p className="text-gray-500 text-xs">Connected: {isConnected ? '✅' : '❌'}</p>
            <p className="text-gray-500 text-xs">Address: {address?.slice(0, 10)}...{address?.slice(-6)}</p>
            <p className="text-gray-500 text-xs">Is Admin: {isAdmin ? '✅' : '❌'}</p>
          </div>

          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
            <p className="text-purple-400 font-semibold mb-3">New Fee Split</p>
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b border-gray-800/40">
                  <td className="py-2 text-gray-400">40% → Admin wallet</td>
                  <td className="py-2 text-right text-purple-300 font-mono">platform_fee_withdraw = 4000</td>
                </tr>
                <tr className="border-b border-gray-800/40">
                  <td className="py-2 text-gray-400">30% → Creator pool</td>
                  <td className="py-2 text-right text-purple-300 font-mono">creator_fee_withdraw = 3000</td>
                </tr>
                <tr className="border-b border-gray-800/40">
                  <td className="py-2 text-gray-400">~30% → AIDA stakers</td>
                  <td className="py-2 text-right text-purple-300 font-mono">platform_stake_fee = 2999</td>
                </tr>
                <tr>
                  <td className="py-2 text-gray-400">~0.01% → dust (avoids zero abort bug)</td>
                  <td className="py-2 text-right text-gray-500 font-mono">stake_fee_withdraw = 1</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <p className="text-yellow-400 text-xs">
              <strong>Why dust?</strong> The contract calls <code className="text-yellow-300">update_reward_index</code> for 
              meme-token stakers even when share is 0, which aborts with code 6. Setting it to 1 (0.01%) 
              avoids the crash. On 1 SUI of fees this is 0.0001 SUI.
            </p>
          </div>
        </div>

        <button
          onClick={handleFixFeeSplit}
          disabled={!isAdmin || loading}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
            isAdmin && !loading
              ? 'bg-purple-600 hover:bg-purple-500 text-white cursor-pointer'
              : 'bg-gray-800 text-gray-500 cursor-not-allowed'
          }`}
        >
          {loading ? 'Executing...' : 'Update Fee Split Config'}
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
