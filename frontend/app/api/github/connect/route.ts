import { NextRequest, NextResponse } from 'next/server'

const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID     || ''
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || ''
const APP_URL              = process.env.NEXT_PUBLIC_APP_URL   || 'https://www.theodyssey.fun'

/**
 * GET /api/github/connect?agentId=xxx
 * Redirects user to GitHub OAuth with state=agentId
 */
export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get('agentId')
  if (!agentId) {
    return NextResponse.json({ error: 'agentId required' }, { status: 400 })
  }

  if (!GITHUB_CLIENT_ID) {
    return NextResponse.json({ error: 'GITHUB_CLIENT_ID not configured' }, { status: 500 })
  }

  const params = new URLSearchParams({
    client_id:    GITHUB_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/github/callback`,
    scope:        'repo',           // full repo access to create/push repos
    state:        agentId,
  })

  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`)
}
