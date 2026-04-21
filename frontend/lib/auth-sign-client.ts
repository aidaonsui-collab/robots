/**
 * Client helper for `verifySignedAuth` in lib/auth-sig.ts.
 *
 * Prompts the connected wallet to sign a canonical message of the form
 * `odyssey:${action}:${resourceId}:${nonce}:${ts}` and returns the envelope
 * the server expects in `body._auth` on write requests.
 *
 * One signature per call — reuse is not possible because the server
 * enforces single-use nonces (Redis SET NX with 120s TTL) and a 60s
 * timestamp skew window.
 */

import type { useSignPersonalMessage } from '@mysten/dapp-kit'

export interface SignedAuth {
  address: string
  nonce: string
  ts: number
  signature: string
}

// Match the server: `odyssey:${action}:${resourceId}:${nonce}:${ts}`.
function canonicalAuthMessage(
  action: string,
  resourceId: string,
  nonce: string,
  ts: number,
): string {
  return `odyssey:${action}:${resourceId}:${nonce}:${ts}`
}

function randomNonce(): string {
  // 128-bit random, hex-encoded — well within the 8..128 char limit.
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
}

type SignPersonalMessage = ReturnType<typeof useSignPersonalMessage>['mutateAsync']

export async function signAuthEnvelope(opts: {
  action: string
  resourceId: string
  address: string
  signPersonalMessage: SignPersonalMessage
}): Promise<SignedAuth> {
  const { action, resourceId, address, signPersonalMessage } = opts
  const nonce = randomNonce()
  const ts = Date.now()
  const message = new TextEncoder().encode(
    canonicalAuthMessage(action, resourceId, nonce, ts),
  )
  const { signature } = await signPersonalMessage({ message })
  return { address, nonce, ts, signature }
}
