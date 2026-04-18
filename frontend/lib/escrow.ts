/**
 * TypeScript helpers for the odyssey_escrow Move module (v2).
 *
 * V2 flow:
 *   1. Requester calls deposit() with USDC → creates on-chain Escrow object
 *   2. Server stores escrow objectId on the ServiceRequest record
 *   3. Worker fulfills → server calls release() using AdminCap
 *   4. If fulfill fails → server calls adminRefund() using AdminCap
 *   5. If server goes dark → requester waits out deadline, calls refund()
 */

import { Transaction } from '@mysten/sui/transactions'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { USDC_COIN_TYPE } from './usdc'

// TODO: populate after first v2 publish
export const ESCROW_PACKAGE_ID = process.env.NEXT_PUBLIC_ESCROW_PACKAGE_ID || ''
export const ESCROW_ADMIN_CAP_ID = process.env.ESCROW_ADMIN_CAP_ID || ''

const SUI_RPC_URL = process.env.NEXT_PUBLIC_SUI_RPC_URL || getFullnodeUrl('mainnet')

let _client: SuiClient | null = null
function getClient(): SuiClient {
  if (!_client) _client = new SuiClient({ url: SUI_RPC_URL })
  return _client
}

// ─── Deposit (client-side, requester signs) ───────────────────────────────────

export interface DepositParams {
  /** Coin<USDC> object ID to use as payment. UI should merge coins first. */
  paymentCoinId: string
  /** Total USDC base units to deposit. Must equal the coin's value. */
  amountBase: bigint
  /** Off-chain request ID (utf8 bytes). */
  requestId: string
  /** Provider agent's Sui address. */
  providerAddress: string
  /** Epoch ms after which refund is permitted. Default: now + 1h. */
  deadlineMs: number
}

/**
 * Build a deposit transaction for the UI to sign via dapp-kit.
 * Returns a Transaction ready for `signAndExecute`.
 */
export function buildDepositTx(params: DepositParams): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ESCROW_PACKAGE_ID}::escrow::deposit`,
    typeArguments: [USDC_COIN_TYPE],
    arguments: [
      tx.object(params.paymentCoinId),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(params.requestId))),
      tx.pure.address(params.providerAddress),
      tx.pure.u64(params.deadlineMs),
      tx.object('0x6'), // SUI_CLOCK
    ],
  })
  return tx
}

// ─── Release (server-side, arbiter signs with AdminCap) ───────────────────────

export interface ReleaseParams {
  escrowObjectId: string
  escrowTypeTag?: string // defaults to USDC
}

/**
 * Build + sign + submit a release transaction.
 * Called by the fulfill route after Walrus upload succeeds.
 */
export async function releaseEscrow(
  params: ReleaseParams,
  arbiter: Ed25519Keypair,
): Promise<{ digest: string; status: string }> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ESCROW_PACKAGE_ID}::escrow::release`,
    typeArguments: [params.escrowTypeTag || USDC_COIN_TYPE],
    arguments: [
      tx.object(ESCROW_ADMIN_CAP_ID),
      tx.object(params.escrowObjectId),
    ],
  })

  const result = await getClient().signAndExecuteTransaction({
    signer: arbiter,
    transaction: tx,
    options: { showEffects: true },
  })

  return {
    digest: result.digest,
    status: result.effects?.status?.status || 'unknown',
  }
}

/**
 * Admin refund — used when a request fails before delivery.
 * Same signature as release but calls admin_refund.
 */
export async function adminRefundEscrow(
  params: ReleaseParams,
  arbiter: Ed25519Keypair,
): Promise<{ digest: string; status: string }> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ESCROW_PACKAGE_ID}::escrow::admin_refund`,
    typeArguments: [params.escrowTypeTag || USDC_COIN_TYPE],
    arguments: [
      tx.object(ESCROW_ADMIN_CAP_ID),
      tx.object(params.escrowObjectId),
    ],
  })

  const result = await getClient().signAndExecuteTransaction({
    signer: arbiter,
    transaction: tx,
    options: { showEffects: true },
  })

  return {
    digest: result.digest,
    status: result.effects?.status?.status || 'unknown',
  }
}

// ─── Event parsing ────────────────────────────────────────────────────────────

export interface EscrowDepositedEvent {
  escrowId: string
  requestId: string
  requester: string
  provider: string
  amount: string
  deadlineMs: string
}

/**
 * Parse the EscrowDeposited event from a deposit tx digest to get the
 * on-chain escrow object ID. Called by settle route after the client
 * submits the deposit.
 */
export async function parseEscrowFromDigest(
  digest: string,
): Promise<EscrowDepositedEvent | null> {
  const tx = await getClient().getTransactionBlock({
    digest,
    options: { showEvents: true },
  })
  const events = tx.events || []
  const depositEvent = events.find(e =>
    e.type.endsWith('::escrow::EscrowDeposited')
  )
  if (!depositEvent) return null
  const parsed = depositEvent.parsedJson as any
  return {
    escrowId: parsed.escrow_id,
    requestId: new TextDecoder().decode(new Uint8Array(parsed.request_id)),
    requester: parsed.requester,
    provider: parsed.provider,
    amount: parsed.amount,
    deadlineMs: parsed.deadline_ms,
  }
}
