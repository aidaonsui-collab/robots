/**
 * POST /api/culture/auth/start
 *
 * First leg of the X OAuth2 PKCE flow for the Culture (airdrops) feature.
 * Body: { giftId, walletAddress, recipientHandle }
 * Returns: { authUrl, state }
 *
 * Caller redirects the browser to `authUrl`. X then hits our /callback page
 * with ?code&state, which POSTs to /auth/verify to exchange and fetch the
 * X username. Verified username must match the gift's intended recipient.
 *
 * State + PKCE code_verifier are stashed in Upstash KV with a 10-minute TTL.
 */

import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { normaliseXHandle } from '@/lib/culture'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const STATE_TTL_SECONDS = 10 * 60

const CLIENT_ID     = process.env.X_OAUTH_CLIENT_ID || ''
const REDIRECT_URI  = process.env.X_OAUTH_REDIRECT_URI
  || (process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/airdrops/callback` : '')

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

export async function POST(req: NextRequest) {
  try {
    if (!CLIENT_ID || !REDIRECT_URI) {
      return NextResponse.json({ error: 'X OAuth not configured (missing X_OAUTH_CLIENT_ID or X_OAUTH_REDIRECT_URI)' }, { status: 503 })
    }

    const body = await req.json()
    const { giftId, walletAddress, recipientHandle } = body
    if (!giftId || !walletAddress || !recipientHandle) {
      return NextResponse.json({ error: 'giftId, walletAddress, and recipientHandle are required' }, { status: 400 })
    }

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    const state = crypto.randomBytes(16).toString('hex')

    await kv.set(
      `culture:oauth-state:${state}`,
      {
        codeVerifier,
        giftId: String(giftId),
        walletAddress: String(walletAddress),
        recipientHandle: normaliseXHandle(String(recipientHandle)),
      },
      { ex: STATE_TTL_SECONDS }
    )

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'tweet.read users.read',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    return NextResponse.json({
      authUrl: `https://twitter.com/i/oauth2/authorize?${params.toString()}`,
      state,
    })
  } catch (e: any) {
    console.error('[culture/auth/start]', e)
    return NextResponse.json({ error: e.message || 'Unknown error' }, { status: 500 })
  }
}
