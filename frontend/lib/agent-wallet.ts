/**
 * Per-agent Sui wallet — each agent gets its own Ed25519 keypair.
 *
 * Private key is encrypted with AES-256-GCM using AGENT_WALLET_MASTER_KEY
 * (hex-encoded 32 bytes) and stored in Redis alongside the agent record.
 * Only the worker / API routes can unseal it.
 *
 * V1 usage: agent receives USDC from requesters, holds balance passively.
 * V2 usage: agent itself signs transactions (hire other agents, pay APIs, etc.)
 * with spending bounded by lib/agent-policy.ts.
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import crypto from 'crypto'
import { kv } from '@vercel/kv'

const MASTER_KEY_HEX = process.env.AGENT_WALLET_MASTER_KEY || ''
const ALGO = 'aes-256-gcm'

function getMasterKey(): Buffer {
  if (!MASTER_KEY_HEX) throw new Error('AGENT_WALLET_MASTER_KEY not set')
  const key = Buffer.from(MASTER_KEY_HEX, 'hex')
  if (key.length !== 32) throw new Error('AGENT_WALLET_MASTER_KEY must be 32 bytes (64 hex chars)')
  return key
}

// ─── Encryption ───────────────────────────────────────────────────────────────

function seal(plaintext: Buffer): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, getMasterKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: iv | tag | ciphertext (all base64)
  return `${toBase64(iv)}.${toBase64(tag)}.${toBase64(ct)}`
}

function unseal(envelope: string): Buffer {
  const [ivB64, tagB64, ctB64] = envelope.split('.')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed envelope')
  const decipher = crypto.createDecipheriv(ALGO, getMasterKey(), fromBase64(ivB64))
  decipher.setAuthTag(Buffer.from(fromBase64(tagB64)))
  return Buffer.concat([decipher.update(Buffer.from(fromBase64(ctB64))), decipher.final()])
}

// ─── Wallet lifecycle ─────────────────────────────────────────────────────────

export interface AgentWallet {
  address: string           // 0x…
  publicKey: string         // base64
  createdAt: string
}

const WALLET_KEY = (agentId: string) => `agent:${agentId}:wallet`
const WALLET_SECRET_KEY = (agentId: string) => `agent:${agentId}:wallet:secret`

/**
 * Generate a new keypair for an agent and persist it.
 * Idempotent: if a wallet already exists, returns it.
 */
export async function ensureAgentWallet(agentId: string): Promise<AgentWallet> {
  const existing = await kv.get<AgentWallet>(WALLET_KEY(agentId))
  if (existing) return existing

  const kp = new Ed25519Keypair()
  const address = kp.toSuiAddress()
  const publicKey = toBase64(kp.getPublicKey().toRawBytes())

  // Export the 32-byte secret seed (not the full 64-byte sui private key format)
  const secretBytes = kp.getSecretKey() // returns suiprivkey… string
  const sealed = seal(Buffer.from(secretBytes, 'utf8'))

  const wallet: AgentWallet = {
    address,
    publicKey,
    createdAt: new Date().toISOString(),
  }

  await kv.set(WALLET_KEY(agentId), wallet)
  await kv.set(WALLET_SECRET_KEY(agentId), sealed)

  // TODO: fund with a tiny amount of SUI for gas (or rely on sponsored tx in v2)
  // TODO: optionally fund with $0.10 USDC from treasury so the wallet has a balance

  return wallet
}

/**
 * Look up an agent's wallet by ID. Does not return the private key.
 */
export async function getAgentWallet(agentId: string): Promise<AgentWallet | null> {
  return await kv.get<AgentWallet>(WALLET_KEY(agentId))
}

/**
 * Load and decrypt the agent's keypair. Only call from trusted server code.
 */
export async function loadAgentKeypair(agentId: string): Promise<Ed25519Keypair | null> {
  const sealed = await kv.get<string>(WALLET_SECRET_KEY(agentId))
  if (!sealed) return null
  const secretStr = unseal(sealed).toString('utf8')
  return Ed25519Keypair.fromSecretKey(secretStr)
}

// ─── On-chain balance queries ─────────────────────────────────────────────────

const RPC = 'https://fullnode.mainnet.sui.io'

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  })
  const j = await res.json()
  return j.result
}

/**
 * Get an agent wallet's SUI balance in SUI (not MIST).
 */
export async function getAgentSuiBalance(address: string): Promise<number> {
  try {
    const result = await rpcCall('suix_getBalance', [address, '0x2::sui::SUI']) as any
    return Number(BigInt(result?.totalBalance ?? '0')) / 1e9
  } catch {
    return 0
  }
}

/**
 * Get an agent wallet's NAVI SUI lending position.
 * Returns deposited amount in SUI and estimated APY, or null if no position.
 */
export async function getAgentNaviPosition(
  address: string
): Promise<{ deposited: number; apy: number } | null> {
  const SUI_SUPPLY_PARENT = '0x589c83af4b035a3bc64c40d9011397b539b97ea47edf7be8f33d643606bf96f8'
  const SUI_RESERVE       = '0xab644b5fd11aa11e930d1c7bc903ef609a9feaf9ffe1b23532ad8441854fbfaf'
  try {
    const [supplyResult, reserveResult] = await Promise.all([
      rpcCall('suix_getDynamicFieldObject', [SUI_SUPPLY_PARENT, { type: 'address', value: address }]),
      rpcCall('sui_getObject', [SUI_RESERVE, { showContent: true }]),
    ]) as any[]
    const supplyFields  = supplyResult?.data?.content?.fields
    const reserveFields = reserveResult?.data?.content?.fields
    if (!supplyFields) return null
    const rawBalance  = BigInt(supplyFields?.value ?? supplyFields?.balance ?? '0')
    const supplyIndex = BigInt(
      reserveFields?.current_supply_index ?? reserveFields?.supply_index
        ?? '1000000000000000000000000000'
    )
    const depositedMist = rawBalance * supplyIndex / (10n ** 27n)
    if (depositedMist === 0n) return null
    const apyRaw = Number(reserveFields?.current_supply_rate ?? 0)
    const apy = apyRaw > 0 ? Math.round(apyRaw / 1e25 * 100) / 100 : 0
    return { deposited: Number(depositedMist) / 1e9, apy }
  } catch {
    return null
  }
}
