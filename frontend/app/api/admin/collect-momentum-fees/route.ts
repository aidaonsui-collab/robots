import { NextResponse } from 'next/server'
import { collectMomentumFees } from '@/lib/momentum_aida'

// Claim accumulated Momentum DEX protocol fees for the HERO/AIDA pool.
// Position: 0xcfba0103313c26a4818ea3528d4791c3e80164c4c474f486db55b164f1e88eba
// Pool: 0x740de5bb3b03aa8eeb651cc3c6b751ba4f46f4a2d7b8307a8a9eac5d596ff55b
// coinY (HERO): 0x9b23d1a041b7ca45e2f72e68f6221528b82dc6c40357101601f27e1bde8f7a46::hero::HERO

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.ADMIN_WALLET_SECRET) {
    return NextResponse.json({ error: 'ADMIN_WALLET_SECRET not configured' }, { status: 503 })
  }

  const poolId = req.headers.get('x-pool-id') || '0x740de5bb3b03aa8eeb651cc3c6b751ba4f46f4a2d7b8307a8a9eac5d596ff55b'
  const positionId = req.headers.get('x-position-id') || '0xcfba0103313c26a4818ea3528d4791c3e80164c4c474f486db55b164f1e88eba'
  const coinYType = req.headers.get('x-coin-y') || '0x9b23d1a041b7ca45e2f72e68f6221528b82dc6c40357101601f27e1bde8f7a46::hero::HERO'

  const result = await collectMomentumFees(poolId, positionId, coinYType)
  return NextResponse.json(result)
}
