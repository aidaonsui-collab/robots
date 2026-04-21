import { NextResponse } from 'next/server'
import { addLiquidityToPool } from '@/lib/momentum'
import { SuiClient } from '@mysten/sui/client'

export const dynamic = 'force-dynamic'

const RPC = 'https://fullnode.mainnet.sui.io'
const SUI_DECIMALS = 9
const PLATFORM_FEE_BPS = 200
const FEE_DENOMINATOR = 10000

const PRESALE_ALL_PACKAGES: readonly string[] = [
  '0x4c9f2fe6a524873adea66ff6f31d6caba0df10d10ffd8b28e99d0b8e26eabc76',
  '0xd35d85f2347cb6b3a913839d067f48852b824a1f18e8910aea7bf1ff1f944933',
  '0x10bc92bae029c96b484447fb367fc38d7207580d79049cdf22d7f2c768887283',
  '0xfd93d109c5045a5095d895af332fd377a44114e775e8d48109f00b483cce2b1e',
  '0x7418205d6fb7c9493dcb7fdd12cea7de92737560fef1c741016bd151d7558c0f',
  '0x98c139f5735c34c101121a1542ebf0f76697391571e8bc62e59cdf866afabb2c',
  '0xca1a16f85e69d0c990cd393ecfc23c0ed375a55c5b125a18828157b8692c0225',
] as const

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

function normalizeTokenType(t: string): string {
  if (!t) return t
  const parts = t.split('::')
  if (parts.length >= 3 && !parts[0].startsWith('0x')) parts[0] = `0x${parts[0]}`
  return parts.join('::')
}

export async function POST(req: Request) {
  // Fail-closed auth. See theodyssey2 commit for context (Finding #4).
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[add-liquidity] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 })
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.ADMIN_WALLET_SECRET) {
    return NextResponse.json({ error: 'ADMIN_WALLET_SECRET not configured' }, { status: 503 })
  }
  if (!process.env.MOMENTUM_PACKAGE_ID) {
    return NextResponse.json({ error: 'MOMENTUM_PACKAGE_ID not configured' }, { status: 503 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { poolId, tokenType: bodyTokenType, tokenDecimals = 6, suiAmount: bodysuiAmount, presaleId } = body

  if (!poolId) {
    return NextResponse.json({ error: 'poolId is required' }, { status: 400 })
  }

  const client = new SuiClient({ url: RPC })

  let tokenType: string = bodyTokenType || ''
  let suiAmountMist: bigint | null = bodysuiAmount ? BigInt(bodysuiAmount) : null

  if (presaleId && (!tokenType || suiAmountMist === null)) {
    let migratingEvent: any = null
    for (const pkg of PRESALE_ALL_PACKAGES) {
      try {
        const result = await rpc('suix_queryEvents', [
          { MoveEventType: `${pkg}::presale::PresaleMigratingEvent` },
          null, 50, true,
        ])
        const found = (result?.data || []).find((ev: any) => ev.parsedJson?.presale_id === presaleId)
        if (found) { migratingEvent = found; break }
      } catch { /* try next */ }
    }

    if (!migratingEvent) {
      return NextResponse.json({
        error: `No PresaleMigratingEvent found for presale ${presaleId}`,
      }, { status: 404 })
    }

    const p = migratingEvent.parsedJson
    if (!tokenType) tokenType = normalizeTokenType(p.token_address || '')
    if (suiAmountMist === null) {
      const rawSui = BigInt(p.sui_amount || '0')
      const fee = rawSui * BigInt(PLATFORM_FEE_BPS) / BigInt(FEE_DENOMINATOR)
      suiAmountMist = rawSui - fee
    }
  }

  if (!tokenType) {
    return NextResponse.json({ error: 'tokenType is required' }, { status: 400 })
  }
  if (suiAmountMist === null || suiAmountMist <= 0n) {
    return NextResponse.json({ error: 'suiAmount (MIST) is required' }, { status: 400 })
  }

  const poolRes = await client.getObject({ id: poolId, options: { showContent: true } })
  const poolFields = (poolRes.data as any)?.content?.fields
  if (!poolFields) {
    return NextResponse.json({ error: `Pool ${poolId} not found on-chain` }, { status: 404 })
  }

  const sqrtPriceRaw = BigInt(poolFields.sqrt_price || '0')
  if (sqrtPriceRaw === 0n) {
    return NextResponse.json({ error: `Pool ${poolId} has no price set` }, { status: 400 })
  }
  const sqrtPriceFloat = Number(sqrtPriceRaw) / Math.pow(2, 64)
  const price = Math.pow(10, Number(tokenDecimals) - SUI_DECIMALS) / (sqrtPriceFloat * sqrtPriceFloat)

  const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519')
  const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography')
  let adminAddress: string
  try {
    const { secretKey } = decodeSuiPrivateKey(process.env.ADMIN_WALLET_SECRET!)
    adminAddress = Ed25519Keypair.fromSecretKey(secretKey).getPublicKey().toSuiAddress()
  } catch {
    const bytes = process.env.ADMIN_WALLET_SECRET!.startsWith('0x')
      ? Uint8Array.from(Buffer.from(process.env.ADMIN_WALLET_SECRET!.slice(2), 'hex'))
      : Uint8Array.from(Buffer.from(process.env.ADMIN_WALLET_SECRET!, 'base64'))
    adminAddress = Ed25519Keypair.fromSecretKey(bytes).getPublicKey().toSuiAddress()
  }

  const balance = await client.getBalance({ owner: adminAddress })
  const availableMist = BigInt(balance.totalBalance)
  const GAS_BUFFER = BigInt(300_000_000)
  const needed = suiAmountMist + GAS_BUFFER

  if (availableMist < needed) {
    return NextResponse.json({
      error: `Insufficient admin wallet balance`,
      walletSui: Number(availableMist) / 1e9,
      neededSui: Number(needed) / 1e9,
    }, { status: 400 })
  }

  const result = await addLiquidityToPool({
    poolId,
    tokenType,
    tokenDecimals: Number(tokenDecimals),
    suiAmount: suiAmountMist,
    price,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error, poolId, digest: result.digest }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    poolId: result.poolId,
    positionId: result.positionId,
    digest: result.digest,
    suiAdded: `${Number(suiAmountMist) / 1e9} SUI`,
  })
}
