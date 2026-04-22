// ============================================================
// AIDA-Paired Bonding Curve Contract (robots repo)
// Fork of Odyssey Moonbags — quote token changed from SUI → AIDA
//
// Published: 2026-04-22 (v2)
// Package: 0x593a2e87f393dcb14e0f8c88d587c04e9bc98295e13212e8992343377bf7f313
// TX: FiJ2byM6yYexgRcSRUBjSAZZB9faHWfwMtJAdbADQEyq (setter tested OK)
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
  packageId:     '0x593a2e87f393dcb14e0f8c88d587c04e9bc98295e13212e8992343377bf7f313',
  module:        'moonbags',
  configuration: '0x1b08a4a16024a7456e3c42449daec1dc8cbe130e24d6a6c37482e4fd2293b60f',
  stakeConfig:   '0xd2da7956c16dafe9e592b04085d80b19159c39034e222247315a51b9c3770c09',
  lockConfig:    '0x2d6b3083c48aea4dc6db9e64daa5f805b124f578ac43b3beea224a079aedf00a',
  tokenRegistry: '0x0000000000000000000000000000000000000000000000000000000000000000',
}

// ── Moonbags AIDA PREV (2026-04-18 original publish) ──────────
// Pools launched under the first AIDA-fork package still reference these
// shared objects via their bonding_curve_config. Trade/claim calls on
// those pools MUST target this bundle — routing to the current AIDA
// bundle would fail at the shared-object version assertion.
export const MOONBAGS_AIDA_CONTRACT_PREV: MoonbagsContract = {
  packageId:     '0x2156ceed0866b899840871add0efdae25799b2b22df1563922b5b01c011975a8',
  module:        'moonbags',
  configuration: '0x66bb8347ae793fb2f955465558b8c1ef74ab74289a9a5cc4a558e6cbbc587d91',
  stakeConfig:   '0x64c07e79494e0f51923c0a7a524a9429605d464e3583be3f9b20ce3765a92cd5',
  lockConfig:    '0x22c3121014b0eca1eca28cf2a9ea680d625b80679e1d3771545cbcad9e15faa4',
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

// Every AIDA-fork package ID ever shipped to mainnet. The AIDA-pair
// contract has been republished as admin-settable-fee iterations landed,
// so a pool's package segment could match any of these and still be an
// AIDA pair. Add new pkgIds here whenever the admin republishes.
export const AIDA_PAIR_PACKAGE_IDS: readonly string[] = [
  '0x2156ceed0866b899840871add0efdae25799b2b22df1563922b5b01c011975a8', // 2026-04-18 publish
  '0xc83604a9ff4e757fc965c93823c199b312af8e0ed43a742628b3defe7931b46f', // 2026-04-21 republish (stale bytecode, superseded)
  '0x593a2e87f393dcb14e0f8c88d587c04e9bc98295e13212e8992343377bf7f313', // 2026-04-21 republish (current, setter verified)
] as const

// Given a moonbags package ID (from a pool's on-chain type), return the
// pair token for that pool. Any AIDA-fork package id — including the
// older publishes — maps to 'AIDA'; everything else is 'SUI'.
export function getPairType(moonbagsPackageId?: string | null): PairToken {
  if (!moonbagsPackageId) return 'SUI'
  const normalized = moonbagsPackageId.toLowerCase()
  return AIDA_PAIR_PACKAGE_IDS.some(p => p.toLowerCase() === normalized) ? 'AIDA' : 'SUI'
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
