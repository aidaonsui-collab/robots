import { NextResponse } from 'next/server'
import { SuiClient } from '@mysten/sui/client'
import { createMomentumPool, callPresaleWithdrawForMigration, type GraduationEvent } from '@/lib/momentum'

export const dynamic = 'force-dynamic'

const RPC = 'https://fullnode.mainnet.sui.io'

const STATUS_SUCCESS = 2
const STATUS_MIGRATED = 4
const PLATFORM_FEE_BPS = 200
const FEE_DENOMINATOR = 10000

function normalizeTokenType(tokenType: string): string {
  if (!tokenType) return tokenType
  const parts = tokenType.split('::')
  if (parts.length >= 3 && !parts[0].startsWith('0x')) {
    parts[0] = `0x${parts[0]}`
  }
  return parts.join('::')
}

/**
 * POST /api/presale/[id]/graduate
 *
 * Manually triggers graduation for a single presale that is in SUCCESS state.
 * Calls withdraw_for_migration on-chain (signed by admin wallet), then
 * creates a Momentum CLMM pool with the raised SUI and liquidity tokens.
 *
 * Anyone can call this — the actual on-chain TX is signed server-side by
 * ADMIN_WALLET_SECRET. Idempotent: returns an error if already migrated.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: presaleId } = await params

  if (!process.env.ADMIN_WALLET_SECRET) {
    return NextResponse.json(
      { error: 'ADMIN_WALLET_SECRET not configured — graduation disabled' },
      { status: 503 }
    )
  }

  if (!process.env.MOMENTUM_PACKAGE_ID) {
    return NextResponse.json(
      { error: 'MOMENTUM_PACKAGE_ID not configured — graduation disabled' },
      { status: 503 }
    )
  }

  // Fetch live presale object using SDK (handles API format variations)
  let fields: any
  let objType = ''
  try {
    const client = new SuiClient({ url: RPC })
    const objRes = await client.getObject({
      id: presaleId,
      options: { showContent: true },
    })
    if (objRes.error || !objRes.data) {
      const errCode = (objRes.error as any)?.code ?? 'unknown'
      return NextResponse.json({ error: `Presale not found (${errCode})` }, { status: 404 })
    }
    const content = objRes.data.content as any
    if (!content?.fields) {
      return NextResponse.json({ error: 'Presale object has no content fields' }, { status: 404 })
    }
    fields = content.fields
    objType = content.type ?? ''
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to fetch presale: ${e.message}` }, { status: 502 })
  }

  const currentStatus = Number(fields.status || '0')

  if (currentStatus === STATUS_MIGRATED) {
    return NextResponse.json({ error: 'Presale already migrated to DEX' }, { status: 400 })
  }
  if (currentStatus !== STATUS_SUCCESS) {
    return NextResponse.json(
      { error: `Presale must be in SUCCESS state to graduate (current status: ${currentStatus})` },
      { status: 400 }
    )
  }

  // Extract full token type from object type string
  // Format: "0xPKG::presale::Presale<0xTOKEN_PKG::module::TYPE>"
  const typeMatch = objType.match(/<(.+)>$/)
  const tokenType = typeMatch ? typeMatch[1] : ''
  if (!tokenType) {
    return NextResponse.json(
      { error: `Cannot extract token type from object type: ${objType}` },
      { status: 500 }
    )
  }

  const objPackageId = objType.split('::')[0]
  const normalizedTokenType = normalizeTokenType(tokenType)

  const totalRaisedMist = Number(fields.sui_raised?.fields?.balance || fields.sui_raised || '0')
  const liquidityTokenAmount = Number(fields.liquidity_tokens?.fields?.balance || '0')
  const tokenDec = Number(fields.token_decimals || '6')

  if (totalRaisedMist === 0 || liquidityTokenAmount === 0) {
    return NextResponse.json(
      { error: 'Presale has zero SUI raised or zero liquidity tokens — cannot create pool' },
      { status: 400 }
    )
  }

  console.log(`[graduate] Manual graduation triggered for presale ${presaleId}`)
  console.log(`  token:      ${normalizedTokenType}`)
  console.log(`  raised:     ${totalRaisedMist / 1e9} SUI`)
  console.log(`  liq tokens: ${liquidityTokenAmount / 10 ** tokenDec}`)

  // Step 1: Call withdraw_for_migration (sends SUI + tokens to admin wallet)
  const withdrawResult = await callPresaleWithdrawForMigration(
    presaleId,
    objPackageId,
    normalizedTokenType,
  )

  if (!withdrawResult.success) {
    return NextResponse.json(
      { error: `withdraw_for_migration failed: ${withdrawResult.error}` },
      { status: 500 }
    )
  }

  // Step 2: Create Momentum CLMM pool
  const platformFee = Math.floor(totalRaisedMist * PLATFORM_FEE_BPS / FEE_DENOMINATOR)
  const suiForPool = totalRaisedMist - platformFee

  const graduation: GraduationEvent = {
    tokenType: normalizedTokenType,
    suiAmount: BigInt(suiForPool),
    tokenAmount: BigInt(liquidityTokenAmount),
    tokenDecimals: tokenDec,
    timestamp: Date.now(),
  }

  const poolResult = await createMomentumPool(graduation)

  if (!poolResult.success) {
    return NextResponse.json({
      error: `Pool creation failed: ${poolResult.error}`,
      withdrawDigest: withdrawResult.digest,
      note: 'withdraw_for_migration succeeded — funds are in admin wallet. Pool creation can be retried.',
    }, { status: 500 })
  }

  console.log(`[graduate] Presale ${presaleId} graduated successfully!`)

  return NextResponse.json({
    success: true,
    presaleId,
    tokenType: normalizedTokenType,
    withdrawDigest: withdrawResult.digest,
    poolId: poolResult.poolId,
    poolDigest: poolResult.digest,
    suiForPool: (suiForPool / 1e9).toFixed(4) + ' SUI',
    tokensForPool: (liquidityTokenAmount / 10 ** tokenDec).toFixed(0),
  })
}
