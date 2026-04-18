import { NextRequest, NextResponse } from 'next/server'
import { updateAgent, getAgent } from '@/lib/agents-db'

const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID     || ''
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || ''
const APP_URL              = process.env.NEXT_PUBLIC_APP_URL   || 'https://www.theodyssey.fun'

/**
 * GET /api/github/callback?code=xxx&state=agentId
 * GitHub redirects here after user approves — exchange code for token
 */
export async function GET(request: NextRequest) {
  const code    = request.nextUrl.searchParams.get('code')
  const agentId = request.nextUrl.searchParams.get('state')

  if (!code || !agentId) {
    return NextResponse.redirect(`${APP_URL}/my-agents?error=github_missing_params`)
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify({
        client_id:     GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    })

    const tokenData = await tokenRes.json() as any

    if (tokenData.error || !tokenData.access_token) {
      console.error('GitHub token error:', tokenData)
      return NextResponse.redirect(`${APP_URL}/my-agents/${agentId}/dashboard?error=github_auth_failed`)
    }

    const accessToken = tokenData.access_token

    // Get GitHub username
    const userRes  = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const userData = await userRes.json() as any

    // Store token + username on the agent
    await updateAgent(agentId, {
      githubToken:    accessToken,
      githubUsername: userData.login,
    })

    // Redirect back to dashboard with success
    return NextResponse.redirect(
      `${APP_URL}/my-agents/${agentId}/dashboard?github=connected&user=${userData.login}`
    )
  } catch (err: any) {
    console.error('GitHub callback error:', err)
    return NextResponse.redirect(`${APP_URL}/my-agents/${agentId}/dashboard?error=github_callback_failed`)
  }
}
