import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { getAgent } from '@/lib/agents-db'
import { loadAgentKeypair } from '@/lib/agent-wallet'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

const NONCE_TTL = 300 // 5 minutes
const NONCE_KEY = (agentId: string) => `export:nonce:agent:${agentId}`

/**
 * GET /api/agents/:id/wallet/export
 * Returns a challenge nonce the creator must sign to prove wallet ownership.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const agent = await getAgent(id)
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!agent.agentAddress) return NextResponse.json({ error: 'Agent has no wallet' }, { status: 404 })

  const nonce = randomBytes(16).toString('hex')
  await kv.set(NONCE_KEY(id), nonce, { ex: NONCE_TTL })

  // The exact string the creator must sign
  const message = `Export private key for Odyssey agent "${agent.name}" (${id}). Nonce: ${nonce}`

  return NextResponse.json({ nonce, message })
}

/**
 * POST /api/agents/:id/wallet/export
 * Body: { signature: string, nonce: string }
 *
 * Verifies the creator's wallet signature against the stored nonce,
 * then returns the agent's decrypted Ed25519 private key (bech32 format).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { signature, nonce } = await req.json()

    if (!signature || !nonce) {
      return NextResponse.json({ error: 'signature and nonce are required' }, { status: 400 })
    }

    const agent = await getAgent(id)
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    if (!agent.agentAddress) return NextResponse.json({ error: 'Agent has no wallet' }, { status: 404 })

    // Verify nonce is valid and not expired
    const storedNonce = await kv.get<string>(NONCE_KEY(id))
    if (!storedNonce || storedNonce !== nonce) {
      return NextResponse.json({ error: 'Invalid or expired nonce — request a new challenge' }, { status: 401 })
    }

    // Reconstruct the exact message that was signed
    const message = `Export private key for Odyssey agent "${agent.name}" (${id}). Nonce: ${nonce}`
    const messageBytes = new TextEncoder().encode(message)

    // Verify signature — must be signed by the creator address
    try {
      await verifyPersonalMessageSignature(messageBytes, signature, {
        address: agent.creatorAddress,
      })
    } catch {
      return NextResponse.json({ error: 'Signature verification failed — sign with the creator wallet' }, { status: 401 })
    }

    // Delete nonce immediately — single use only
    await kv.del(NONCE_KEY(id))

    // Decrypt and return the agent's private key
    const keypair = await loadAgentKeypair(id)
    if (!keypair) {
      return NextResponse.json({ error: 'Keypair not found for this agent' }, { status: 404 })
    }

    const privateKey = keypair.getSecretKey() // bech32: "suiprivkey1q..."

    return NextResponse.json({
      privateKey,
      address: agent.agentAddress,
      warning: 'Store this key securely. Anyone with this key controls the agent wallet.',
    })
  } catch (error: any) {
    console.error('[wallet-export] Error:', error)
    return NextResponse.json({ error: error.message || 'Export failed' }, { status: 500 })
  }
}
