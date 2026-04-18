import { NextResponse } from 'next/server'
import { createMomentumPool, type GraduationEvent } from '@/lib/momentum'

export const dynamic = 'force-dynamic'

const RPC = 'https://fullnode.mainnet.sui.io'

const PRESALE_ALL_PACKAGES: readonly string[] = [
  '0x10bc92bae029c96b484447fb367fc38d7207580d79049cdf22d7f2c768887283', // v5
  '0xfd93d109c5045a5095d895af332fd377a44114e775e8d48109f00b483cce2b1e', // v4
  '0x7418205d6fb7c9493dcb7fdd12cea7de92737560fef1c741016bd151d7558c0f', // v3
  '0x98c139f5735c34c101121a1542ebf0f76697391571e8bc62e59cdf866afabb2c', // v2
  '0xca1a16f85e69d0c990cd393ecfc23c0ed375a55c5b125a18828157b8692c0225', // v1
] as const

const PLATFORM_FEE_BPS = 200
const FEE_DENOMINATOR = 10000

async function rpc(method: string, params: any[]) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const j = await res.json()
  if (j.error) throw new Error(j.error.message)
  return j.result
}

function normalizeTokenType(tokenType: string): string {
  if (!tokenType) return tokenType
  const parts = tokenType.split('::')
  if (parts.length >= 3 && !parts[0].startsWith('0x')) {
    parts[0] = `0x${parts[0]}`
  }
  return parts.join('::')
}

/**
 * POST /api/presale/[id]/create-pool
 *
 * Retries Momentum pool creation for a presale where withdraw_for_migration
 * already ran (status = MIGRATED) but pool creation failed (e.g. insufficient
 * admin wallet balance at the time).
 *
 * Strategy: First try suix_queryEvents (works from local RPC). If not found
 * (Vercel RPC out of sync), fall back to sui_getTransactionBlock for the
 * known withdraw_for_migration TX digest.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: presaleId } = await params

  if (!process.env.ADMIN_WALLET_SECRET) {
    return NextResponse.json(
      { error: 'ADMIN_WALLET_SECRET not configured' },
      { status: 503 }
    )
  }
  if (!process.env.MOMENTUM_PACKAGE_ID) {
    return NextResponse.json(
      { error: 'MOMENTUM_PACKAGE_ID not configured' },
      { status: 503 }
    )
  }

  // Known withdraw_for_migration TX digests per presale (presale ID -> tx digest)
  const KNOWN_WITHDRAW_TX: Record<string, string> = {
    '0xefc80b1edebcfe7c24c2a3516dda6af7fdb9fd815f169f6a1d722c2026c5f158':
      'GmtTJnFY3JiYrwTdjiDvUJSxc9c5NwXFwSvpiYMzxCnU',
  }

  let migratingEvent: any = null

  // Strategy 1: suix_queryEvents (primary — works for all presales)
  for (const pkg of PRESALE_ALL_PACKAGES) {
    try {
      const result = await rpc('suix_queryEvents', [
        { MoveEventType: `${pkg}::presale::PresaleMigratingEvent` },
        null,
        50,
        true,
      ])
      const events = result?.data || []
      const found = events.find((ev: any) => ev.parsedJson?.presale_id === presaleId)
      if (found) {
        migratingEvent = found
        break
      }
    } catch {
      // Try next package
    }
  }

  // Strategy 2: Look up directly from known withdraw_for_migration TX digest
  if (!migratingEvent && KNOWN_WITHDRAW_TX[presaleId]) {
    try {
      const txBlock = await rpc('sui_getTransactionBlock', [
        KNOWN_WITHDRAW_TX[presaleId],
        { showEvents: true },
      ])
      const events = txBlock?.events || []
      const found = events.find((ev: any) =>
        ev.type?.includes('PresaleMigratingEvent') &&
        ev.parsedJson?.presale_id === presaleId
      )
      if (found) {
        migratingEvent = found
        console.log(`[create-pool] Found event via sui_getTransactionBlock fallback`)
      }
    } catch (e) {
      console.error(`[create-pool] Fallback TX lookup failed: ${e}`)
    }
  }

  if (!migratingEvent) {
    return NextResponse.json(
      { error: 'No PresaleMigratingEvent found — withdraw_for_migration may not have been called yet' },
      { status: 404 }
    )
  }

  const parsed = migratingEvent.parsedJson
  const tokenAddr = normalizeTokenType(parsed.token_address || '')
  const tokenDec = Number(parsed.token_decimals || '6')

  // Event sui_amount is the total raised before the on-chain platform fee.
  // Deduct 2% to get what actually went to the admin wallet for pool seeding.
  const rawSuiAmount = BigInt(parsed.sui_amount || '0')
  const platformFee = rawSuiAmount * BigInt(PLATFORM_FEE_BPS) / BigInt(FEE_DENOMINATOR)
  const suiForPool = rawSuiAmount - platformFee
  const tokenAmount = BigInt(parsed.token_amount || '0')

  if (!tokenAddr || suiForPool <= 0n || tokenAmount <= 0n) {
    return NextResponse.json(
      { error: 'Invalid event data — amounts are zero or token address is missing' },
      { status: 400 }
    )
  }

  console.log(`[create-pool] Retrying pool creation for presale ${presaleId}`)
  console.log(`  token:      ${tokenAddr}`)
  console.log(`  SUI:        ${Number(suiForPool) / 1e9}`)
  console.log(`  tokens:     ${Number(tokenAmount) / 10 ** tokenDec}`)

  const graduation: GraduationEvent = {
    tokenType: tokenAddr,
    suiAmount: suiForPool,
    tokenAmount,
    tokenDecimals: tokenDec,
    timestamp: Date.now(),
  }

  const poolResult = await createMomentumPool(graduation)

  if (!poolResult.success) {
    return NextResponse.json(
      { error: `Pool creation failed: ${poolResult.error}` },
      { status: 500 }
    )
  }

  console.log(`[create-pool] Pool created for presale ${presaleId}: ${poolResult.poolId}`)

  return NextResponse.json({
    success: true,
    presaleId,
    tokenType: tokenAddr,
    poolId: poolResult.poolId,
    poolDigest: poolResult.digest,
    suiForPool: (Number(suiForPool) / 1e9).toFixed(4) + ' SUI',
  })
}
