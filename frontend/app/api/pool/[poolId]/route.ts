import { NextRequest, NextResponse } from 'next/server'
import { fetchSuiPriceUsd } from '@/lib/tokens'
import { fetchAidaPriceUsd, getPairType, MOONBAGS_AIDA_CONTRACT } from '@/lib/contracts_aida'

export const dynamic = 'force-dynamic'

const RPC = 'https://fullnode.mainnet.sui.io'
const SUI_DECIMALS = 9
const TOKEN_DECIMALS = 6

// Extract the moonbags package ID from an on-chain pool's object type string.
// Handles both bonding curve ("<pkg>::moonbags::Pool<T>") and any other format
// where the package ID is the first segment before "::".
function extractPackageId(objectType: string): string | null {
  const m = objectType.match(/^(0x[0-9a-fA-F]+)::/)
  return m ? m[1] : null
}

/**
 * GET /api/pool/[poolId]
 *
 * Fetches pool data for either:
 *   - A bonding curve pool (has virtual_sui_reserves / virtual_token_reserves)
 *   - A Momentum CLMM pool (has sqrt_price / reserve_x / reserve_y)
 *
 * Detects pool type automatically from on-chain fields, and derives the pair
 * token (SUI vs AIDA) from the pool's package ID so USD prices reflect the
 * correct quote asset.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ poolId: string }> }
) {
  try {
    const { poolId } = await params

    const [suiPriceUsd, aidaPriceUsd] = await Promise.all([
      fetchSuiPriceUsd(),
      fetchAidaPriceUsd(),
    ])

    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getObject',
        params: [poolId, { showContent: true, showType: true }],
      }),
      cache: 'no-store',
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch pool from RPC' }, { status: 500 })
    }

    const data = await response.json()
    if (!data.result?.data?.content?.fields) {
      return NextResponse.json({ error: 'Pool not found' }, { status: 404 })
    }

    const fields = data.result.data.content.fields
    const objectType: string = data.result.data.type || ''

    const packageId = extractPackageId(objectType)
    const pairType = getPairType(packageId)
    const quotePriceUsd = pairType === 'AIDA' ? aidaPriceUsd : suiPriceUsd

    // ── CLMM pool (Momentum): has sqrt_price ────────────────────────────────────
    if ('sqrt_price' in fields) {
      const reserveX = BigInt(fields.reserve_x ?? '0')
      const reserveY = BigInt(fields.reserve_y ?? '0')
      const sqrtPriceRaw = BigInt(fields.sqrt_price || '0')
      const liquidity = BigInt(fields.liquidity ?? '0')
      const feeRate = Number(fields.fee_rate ?? 3000)

      // Momentum stores sqrtPrice as sqrt(Y/X) * 2^64
      // price (quote/token, X/Y in human units) = 10^(tokDec-quoteDec) / sqrtPriceFloat^2
      let price = 0
      if (sqrtPriceRaw > 0n) {
        const sqrtPriceFloat = Number(sqrtPriceRaw) / Math.pow(2, 64)
        price = Math.pow(10, TOKEN_DECIMALS - SUI_DECIMALS) / (sqrtPriceFloat * sqrtPriceFloat)
      }

      const quoteInPool = Number(reserveX) / 1e9
      const tokensInPool = Number(reserveY) / 1e6

      // Total supply is typically ~1B tokens for Odyssey launches
      const TOTAL_SUPPLY = 1_000_000_000
      const marketCap = price * TOTAL_SUPPLY * quotePriceUsd

      const isActive = liquidity > 0n

      return NextResponse.json({
        poolId,
        poolType: 'clmm',
        pairType,
        price,
        marketCap,
        suiInPool: quoteInPool,   // legacy field name
        quoteInPool,
        tokensInPool,
        reserveX: quoteInPool,
        reserveY: tokensInPool,
        liquidity: liquidity.toString(),
        feeRate,
        isActive,
        isCompleted: true, // CLMM pools are graduated/completed
        objectType,
      })
    }

    // ── Bonding curve pool ───────────────────────────────────────────────────────
    // Field names on the Pool struct (same for SUI and AIDA forks):
    //   virtual_sui_reserves     u64           — bonding curve virtual quote reserves
    //   virtual_token_reserves   u64           — bonding curve virtual token reserves
    //   real_sui_reserves        Balance<Q>    — actual quote collected (nested: .fields.balance)
    //   threshold                u64           — graduation threshold in quote mist
    //   fee_recipient            Coin<Q>       — accumulated trading fees (nested: .fields.balance)
    //   remain_token_reserves    Balance<T>    — tradable token supply (nested: .fields.balance)
    //   is_completed             bool
    const virtualSui     = BigInt(fields.virtual_sui_reserves || '0')
    const virtualToken   = BigInt(fields.virtual_token_reserves || '0')
    const realQuoteMist  = BigInt(fields.real_sui_reserves?.fields?.balance || '0')
    const thresholdMist  = BigInt(fields.threshold || '0')
    const feeMist        = BigInt(fields.fee_recipient?.fields?.balance || '0')
    const remainTokenRaw = BigInt(fields.remain_token_reserves?.fields?.balance || '0')
    const isCompleted    = fields.is_completed || false

    // Spot price: quote-token per token (apply correct decimal scaling)
    const price = virtualToken > 0n
      ? (Number(virtualSui) / 1e9) / (Number(virtualToken) / 1e6)
      : 0

    // Use tradeable supply (R) not total minted (2R) for MC — second R is locked for DEX LP.
    const totalSupply = remainTokenRaw > 0n
      ? Number(remainTokenRaw) / 1e6
      : 1_000_000_000

    const marketCap = price * totalSupply * quotePriceUsd

    const raised    = Number(realQuoteMist) / 1e9
    const target    = Number(thresholdMist) / 1e9
    const fees      = Number(feeMist) / 1e9
    const bondingProgress = target > 0 ? (raised / target) * 100 : 0

    // Contract collects 2% fee, so lifetime volume ≈ fees / 0.02.
    const estimatedVolume = fees / 0.02

    return NextResponse.json({
      poolId,
      poolType: 'bonding',
      pairType,
      price,
      marketCap,
      virtualSuiReserves: Number(virtualSui) / 1e9,   // legacy field name (now exposes virtual reserve, not raised)
      virtualQuoteReserves: Number(virtualSui) / 1e9,
      virtualTokenReserves: Number(virtualToken) / 1e6,
      feesCollected: fees,
      targetRaise: target,
      raised,
      bondingProgress,
      isCompleted,
      volume24h: estimatedVolume,   // lifetime volume estimate — no 24h window yet
      trades24h: 0,
    })
  } catch (error: any) {
    console.error('Pool fetch error:', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch pool' }, { status: 500 })
  }
}
