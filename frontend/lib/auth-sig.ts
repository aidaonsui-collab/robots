/**
 * Sui-signature authentication for write endpoints.
 *
 * Flow (single request, no extra roundtrip):
 *   Client generates a fresh nonce + current ts, signs the canonical
 *   message `odyssey:${action}:${agentId}:${nonce}:${ts}` with their wallet,
 *   and sends { _auth: { address, nonce, ts, signature } } in the body.
 *
 *   Server verifies:
 *     1. address matches the expected address (usually agent.creatorAddress).
 *     2. ts is within 60 s of server clock (replay-windowing).
 *     3. nonce has not been seen (Redis SET NX with 120 s TTL).
 *     4. signature is a valid Sui personal-message signature from address.
 */

import { kv } from '@vercel/kv'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'

const MAX_SKEW_MS = 60 * 1000
const NONCE_TTL_S = 120

export interface SignedAuth {
  address: string
  nonce: string
  ts: number
  signature: string
}

export interface AuthResult {
  ok: boolean
  reason?: string
}

export function canonicalAuthMessage(
  action: string,
  resourceId: string,
  nonce: string,
  ts: number,
): string {
  return `odyssey:${action}:${resourceId}:${nonce}:${ts}`
}

function isSignedAuth(x: unknown): x is SignedAuth {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.address === 'string' &&
    typeof o.nonce === 'string' &&
    typeof o.ts === 'number' &&
    typeof o.signature === 'string'
  )
}

export async function verifySignedAuth(opts: {
  resourceId: string
  action: string
  expectedAddress: string
  auth: unknown
}): Promise<AuthResult> {
  const { resourceId, action, expectedAddress, auth } = opts

  if (!isSignedAuth(auth)) {
    return { ok: false, reason: 'missing or malformed _auth envelope' }
  }

  if (!expectedAddress) {
    return { ok: false, reason: 'resource has no expected signer address' }
  }

  if (auth.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    return { ok: false, reason: 'signer does not match expected address' }
  }

  if (auth.nonce.length < 8 || auth.nonce.length > 128) {
    return { ok: false, reason: 'nonce must be 8..128 chars' }
  }

  if (!Number.isFinite(auth.ts) || Math.abs(Date.now() - auth.ts) > MAX_SKEW_MS) {
    return { ok: false, reason: 'timestamp outside allowed skew' }
  }

  const nonceKey = `authnonce:${resourceId}:${auth.nonce}`
  const fresh = await kv.set(nonceKey, '1', { nx: true, ex: NONCE_TTL_S })
  if (fresh === null) {
    return { ok: false, reason: 'nonce already used' }
  }

  try {
    const msg = new TextEncoder().encode(
      canonicalAuthMessage(action, resourceId, auth.nonce, auth.ts),
    )
    await verifyPersonalMessageSignature(msg, auth.signature, {
      address: expectedAddress,
    })
  } catch (e: any) {
    return { ok: false, reason: `signature verification failed${e?.message ? `: ${e.message}` : ''}` }
  }

  return { ok: true }
}
