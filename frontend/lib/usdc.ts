/**
 * Native USDC on Sui — Circle's official issuance.
 * https://docs.sui.io/guides/developer/stablecoins#usdc-on-sui
 */

// Mainnet native USDC coin type (Circle, permissioned mint)
export const USDC_COIN_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

// USDC has 6 decimals on Sui (same as Ethereum USDC)
export const USDC_DECIMALS = 6

/** Convert a human-readable USDC amount (e.g. 0.01) to base units (10_000). */
export function usdcToBase(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS))
}

/** Convert base units to human-readable USDC (string, 6-dp precision). */
export function baseToUsdc(base: bigint | string | number): string {
  const b = typeof base === 'bigint' ? base : BigInt(base)
  const whole = b / 10n ** BigInt(USDC_DECIMALS)
  const frac = b % 10n ** BigInt(USDC_DECIMALS)
  return `${whole}.${frac.toString().padStart(USDC_DECIMALS, '0')}`
}

// In-memory SUI/USD price cache (5-minute TTL)
let _suiPriceCache: { usd: number; expiresAt: number } | null = null
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000

async function getSuiUsdPrice(): Promise<number> {
  if (_suiPriceCache && Date.now() < _suiPriceCache.expiresAt) {
    return _suiPriceCache.usd
  }
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd',
      { cache: 'no-store' }
    )
    const data = (await res.json()) as { sui?: { usd?: number } }
    const usd = data?.sui?.usd ?? 3.0
    _suiPriceCache = { usd, expiresAt: Date.now() + PRICE_CACHE_TTL_MS }
    return usd
  } catch {
    return _suiPriceCache?.usd ?? 3.0
  }
}

/** Simple SUI→USDC conversion for legacy services priced in SUI. */
export async function suiToUsdcPrice(suiAmount: number): Promise<number> {
  const suiUsd = await getSuiUsdPrice()
  return suiAmount * suiUsd
}
