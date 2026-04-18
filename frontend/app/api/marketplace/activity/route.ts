import { NextRequest, NextResponse } from 'next/server'
import { getActivityFeed } from '@/lib/marketplace'

export const dynamic = 'force-dynamic'

/**
 * GET /api/marketplace/activity
 * Get recent marketplace activity feed
 */
export async function GET(request: NextRequest) {
  try {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50')
    const activity = await getActivityFeed(Math.min(limit, 100))

    return NextResponse.json({ activity })
  } catch (error: any) {
    console.error('Marketplace activity error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
