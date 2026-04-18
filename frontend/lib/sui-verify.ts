/**
 * Verify that a Sui transaction digest actually paid USDC to a given address.
 *
 * Used by the marketplace settle route to enforce proof-of-payment before
 * creating a ServiceRequest. The verification reads balance changes from the
 * tx effects — no Move contract required.
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { USDC_COIN_TYPE } from './usdc'

const SUI_RPC_URL = process.env.NEXT_PUBLIC_SUI_RPC_URL || getFullnodeUrl('mainnet')

let _client: SuiClient | null = null
function getClient(): SuiClient {
  if (!_client) _client = new SuiClient({ url: SUI_RPC_URL })
  return _client
}

export interface PaymentProof {
  ok: boolean
  reason?: string
  amountBase?: bigint     // Amount of USDC (base units) received
  sender?: string
  recipient?: string
  timestampMs?: number
}

/**
 * Verify that `txDigest` contains a USDC transfer of at least `minAmountBase`
 * to `expectedRecipient`. Returns { ok: true, ... } on success.
 */
export async function verifyUsdcPayment(
  txDigest: string,
  expectedRecipient: string,
  minAmountBase: bigint,
): Promise<PaymentProof> {
  try {
    const tx = await getClient().getTransactionBlock({
      digest: txDigest,
      options: {
        showEffects: true,
        showBalanceChanges: true,
        showInput: true,
      },
    })

    // Tx must have succeeded
    if (tx.effects?.status?.status !== 'success') {
      return { ok: false, reason: `tx status: ${tx.effects?.status?.status}` }
    }

    const changes = tx.balanceChanges || []
    // Find USDC credit to expected recipient
    const credit = changes.find(c => {
      if (c.coinType !== USDC_COIN_TYPE) return false
      const owner = typeof c.owner === 'object' && 'AddressOwner' in c.owner
        ? c.owner.AddressOwner
        : null
      if (owner !== expectedRecipient) return false
      return BigInt(c.amount) > 0n
    })

    if (!credit) {
      return { ok: false, reason: 'no USDC credit to recipient' }
    }

    const received = BigInt(credit.amount)
    if (received < minAmountBase) {
      return {
        ok: false,
        reason: `insufficient amount: ${received} < ${minAmountBase}`,
      }
    }

    // Find the debit side for sender (informational only)
    const debit = changes.find(c =>
      c.coinType === USDC_COIN_TYPE && BigInt(c.amount) < 0n
    )
    const sender = debit && typeof debit.owner === 'object' && 'AddressOwner' in debit.owner
      ? debit.owner.AddressOwner
      : undefined

    return {
      ok: true,
      amountBase: received,
      sender,
      recipient: expectedRecipient,
      timestampMs: Number(tx.timestampMs || 0),
    }
  } catch (err: any) {
    return { ok: false, reason: `rpc error: ${err.message || err}` }
  }
}
