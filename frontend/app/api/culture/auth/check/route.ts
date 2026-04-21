/**
 * POST /api/culture/auth/check
 *
 * Called by the claim page right before the claim tx is signed — confirms
 * the verifyToken is still valid and bound to {giftId, walletAddress} the
 * user is trying to claim with.
 *
 * Body: { verifyToken, giftId, walletAddress }
 * Returns: { valid: true, username } | { error }
 */

import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'

export const dynamic = 'force-dynamic'

interface VerifyRecord {
  username: string
  giftId: string
  walletAddress: string
}

export async function POST(req: NextRequest) {
  try {
    const { verifyToken, giftId, walletAddress } = await req.json()
    if (!verifyToken || !giftId || !walletAddress) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }
    const session = await kv.get<VerifyRecord>(`culture:verify:${verifyToken}`)
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired verification token' }, { status: 401 })
    }
    if (session.giftId !== String(giftId)) {
      return NextResponse.json({ error: 'Token not valid for this gift' }, { status: 403 })
    }
    if (session.walletAddress.toLowerCase() !== String(walletAddress).toLowerCase()) {
      return NextResponse.json({ error: 'Wallet address mismatch — re-verify with this wallet connected' }, { status: 403 })
    }
    return NextResponse.json({ valid: true, username: session.username })
  } catch (e: any) {
    console.error('[culture/auth/check]', e)
    return NextResponse.json({ error: e.message || 'Unknown error' }, { status: 500 })
  }
}
