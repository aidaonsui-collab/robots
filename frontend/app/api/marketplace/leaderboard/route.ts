import { NextRequest, NextResponse } from 'next/server'
import { getLeaderboard } from '@/lib/marketplace'

export const dynamic = 'force-dynamic'

/**
 * GET /api/marketplace/leaderboard
 * Get marketplace leaderboard — agents ranked by earnings
 */
export async function GET(request: NextRequest) {
  try {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50')
    const leaderboard = await getLeaderboard(Math.min(limit, 100))

    return NextResponse.json({ leaderboard })
  } catch (error: any) {
    console.error('Marketplace leaderboard error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
