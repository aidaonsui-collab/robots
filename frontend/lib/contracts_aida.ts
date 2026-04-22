// ============================================================
// AIDA-Paired Bonding Curve Contract (robots repo)
// Fork of Odyssey Moonbags — quote token changed from SUI → AIDA
//
// Published: 2026-04-18
// Package: 0xc83604a9ff4e757fc965c93823c199b312af8e0ed43a742628b3defe7931b46f
// TX: D3PpLdBdvqhFgrKyfQP7b2NiNWPPgBBDy21YRF933v79
// Modules: curves, moonbags, moonbags_stake, moonbags_token_lock, utils
//
// AIDA coin: 0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA
// Bluefin AIDA/SUI pool: 0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b
// ============================================================

export interface MoonbagsContract {
  packageId:     string
  module:        string
  configuration: string
  stakeConfig:   string
  lockConfig:    string
  tokenRegistry: string
}

export const MOONBAGS_AIDA_CONTRACT: MoonbagsContract = {
  packageId:     '0xc83604a9ff4e757fc965c93823c199b312af8e0ed43a742628b3defe7931b46f',
  module:        'moonbags',
  configuration: '0x23a7b2fe9f93085fbd635488f1d72589f9e1e0d332c7271c2e598097e623e10c',
  stakeConfig:   '0xfeec575e6585e48629b9c157d6bf44c1932c7d276e986d2c5808a2d8e2819f3a',
  lockConfig:    '0x21c44c8a53b2bcac5715517349ad58322845a45a5b552fde0a537c3c366e9b35',
  tokenRegistry: '0x0000000000000000000000000000000000000000000000000000000000000000',
}

// AIDA coin type string (used as typeArgument)
export const AIDA_COIN_TYPE = '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'

// AIDA uses 9 decimals (same as SUI)
export const AIDA_DECIMALS = 9

// Bluefin AIDA/SUI CLMM pool for price oracle
export const BLUEFIN_AIDA_POOL = '0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b'

// Bluefin spot contract (for SDK)
export const BLUEFIN_SPOT_CONTRACT = '0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267'

export type PairToken = 'SUI' | 'AIDA'

// Given a moonbags package ID (from a pool's on-chain type), return the pair
// token for that pool. AIDA-paired pools come from MOONBAGS_AIDA_CONTRACT;
// all other (SUI-paired) packages return 'SUI'.
export function getPairType(moonbagsPackageId?: string | null): PairToken {
  return moonbagsPackageId === MOONBAGS_AIDA_CONTRACT.packageId ? 'AIDA' : 'SUI'
}

// Returns the coin type for the pair side of a pool (what users pay with).
export function getPairCoinType(pair: PairToken): string {
  return pair === 'AIDA' ? AIDA_COIN_TYPE : '0x2::sui::SUI'
}

// Fetch AIDA USD price from DexScreener via the Bluefin AIDA/SUI pool.
// Returns 0 on failure so callers can guard with `|| fallback`.
export async function fetchAidaPriceUsd(): Promise<number> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/sui/${BLUEFIN_AIDA_POOL}`)
    const data = await res.json()
    return parseFloat(data?.pair?.priceUsd || '0') || 0
  } catch {
    return 0
  }
}
