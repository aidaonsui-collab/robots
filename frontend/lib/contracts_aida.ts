// ============================================================
// AIDA-Paired Bonding Curve Contract (robots repo)
// Fork of Odyssey Moonbags — quote token changed from SUI → AIDA
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

// ── Moonbags AIDA (fork from Odyssey Moonbags v12) ──────────
// TODO: Replace with actual deployed package ID after publishing
// Package will be published from robots/contracts/moonbags_aida/
export const MOONBAGS_AIDA_CONTRACT: MoonbagsContract = {
  packageId:     '0x0000000000000000000000000000000000000000000000000000000000000000', // ← FILL IN AFTER PUBLISH
  module:        'moonbags_aida',
  configuration: '0x0000000000000000000000000000000000000000000000000000000000000000', // ← FILL IN AFTER PUBLISH
  stakeConfig:   '0x0000000000000000000000000000000000000000000000000000000000000000', // ← FILL IN AFTER PUBLISH
  lockConfig:    '0x0000000000000000000000000000000000000000000000000000000000000000', // ← FILL IN AFTER PUBLISH
  tokenRegistry: '0x0000000000000000000000000000000000000000000000000000000000000000',
}

// ── AIDA Coin (existing on-chain) ───────────────────────────
export const AIDA_COIN_TYPE = '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'
export const AIDA_DECIMALS = 9

// ── Bluefin AIDA/SUI Pool (price oracle) ──────────────────
export const BLUEFIN_AIDA_SUI_POOL = {
  poolId:  '0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b',
  type:    'Pool<AIDA, SUI>',
  module:  '0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267',
  // Read from current_sqrt_price: sqrtPrice / 2^64 = price
  // 123178458349673575 → ~32.57 AIDA/SUI
}

// ── Bonding curve constants (same as Odyssey, quote = AIDA) ─
export const CURVE_CONFIG_AIDA = {
  initialVirtualTokenReserves: BigInt(200_000_000_000_000),   // 200M tokens (6 decimals)
  remainTokenReserves:         BigInt(800_000_000_000_000),   // 800M tokens
  defaultThresholdAida:        BigInt(2_000_000_000_000),     // 2000 AIDA graduation
  minimumThresholdAida:        BigInt(1_000_000_000_000),     // 1000 AIDA minimum
  poolCreationFeeMist:         BigInt(10_000_000),            // 0.01 SUI (still in SUI for gas)
  platformFeeBps:              200,                           // 2%
  tokenDecimals:              6,
}

// ── Fee distribution (same as Odyssey) ─────────────────────
export const FEE_SPLIT_AIDA = {
  platform:       4000,  // 40% to admin/treasury
  creator:        3000,  // 30% to token creator
  stakers:        1,    // ~0% dust
  platformStake:  2999, // ~30% to AIDA stakers
} as const
