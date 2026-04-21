/**
 * POST /api/culture/auth/verify
 *
 * Second leg of the X OAuth2 PKCE flow. Exchanges the code for an access
 * token, fetches the logged-in X username, and issues a short-lived
 * verifyToken the client can present back to /auth/check at claim time.
 */

import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const VERIFY_TTL_SECONDS = 15 * 60

function deriveRedirectUri(): string {
  const explicit = (process.env.X_OAUTH_REDIRECT_URI || '').trim()
  if (explicit) return explicit
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  return base ? `${base}/airdrops/callback` : ''
}

const CLIENT_ID = process.env.X_OAUTH_CLIENT_ID || ''
const REDIRECT_URI = deriveRedirectUri()

interface PendingState {
  codeVerifier: string
  giftId: string
  walletAddress: string
  recipientHandle: string
}

export async function POST(req: NextRequest) {
  try {
    if (!CLIENT_ID || !REDIRECT_URI) {
      return NextResponse.json({ error: 'X OAuth not configured' }, { status: 503 })
    }

    const { code, state } = await req.json()
    if (!code || !state) {
      return NextResponse.json({ error: 'code and state are required' }, { status: 400 })
    }

    const key = `culture:oauth-state:${state}`
    const pending = await kv.get<PendingState>(key)
    if (!pending) {
      return NextResponse.json({ error: 'Invalid or expired state' }, { status: 400 })
    }
    await kv.del(key)

    const tokenParams = new URLSearchParams({
      code: String(code),
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.codeVerifier,
    })
    const tokenResp = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams,
    })
    const tokenData = await tokenResp.json().catch(() => ({}))
    if (!tokenData.access_token) {
      console.error('[culture/auth/verify] token exchange failed:', tokenData, 'redirect_uri was', REDIRECT_URI)
      return NextResponse.json({
        error: 'Failed to get access token: ' + (tokenData.error_description || tokenData.error || 'unknown'),
      }, { status: 400 })
    }

    const userResp = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const userData = await userResp.json().catch(() => ({}))
    const username = userData?.data?.username?.toLowerCase()
    if (!username) {
      return NextResponse.json({ error: 'Could not retrieve X username' }, { status: 400 })
    }

    if (username !== pending.recipientHandle) {
      return NextResponse.json({
        error: `Logged in as @${username} but this gift is for @${pending.recipientHandle}. Log in with the correct X account.`,
      }, { status: 403 })
    }

    const verifyToken = crypto.randomBytes(32).toString('hex')
    await kv.set(
      `culture:verify:${verifyToken}`,
      {
        username,
        giftId: pending.giftId,
        walletAddress: pending.walletAddress,
      },
      { ex: VERIFY_TTL_SECONDS }
    )

    return NextResponse.json({
      verified: true,
      username,
      verifyToken,
      giftId: pending.giftId,
      walletAddress: pending.walletAddress,
      expiresIn: VERIFY_TTL_SECONDS,
    })
  } catch (e: any) {
    console.error('[culture/auth/verify]', e)
    return NextResponse.json({ error: e.message || 'Unknown error' }, { status: 500 })
  }
}
