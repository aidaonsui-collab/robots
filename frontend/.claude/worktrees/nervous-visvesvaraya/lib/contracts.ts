// ============================================================
// TheOdyssey.fun — Contract Addresses (Verified on-chain)
// Last verified: 2026-03-20
// ============================================================

// ── Moonbags Launchpad (the real contract) ──────────────────
// Package: 0x7d0db22b7282a04841537f27102be8cdeb45725f2d172acd1147c3b332c87266 (v3 upgrade, Mar 25 2026)
// Original chain: 0x50e60400... → 0x3c64691e... → 0xf1c7fe9b... → 0x7d0db22b... (current)
// Configuration type origin: 0x50e60400::moonbags::Configuration
export const MOONBAGS_CONTRACT = {
  packageId:     '0x7d0db22b7282a04841537f27102be8cdeb45725f2d172acd1147c3b332c87266',
  module:        'moonbags',
  configuration: '0xfb774b5c4902d7d39e899388f520db0e2b1a6dca72687803b894d7d67eca9326',  // moonbags::Configuration (created by 0x3c64691e init)
  stakeConfig:   '0x312216a4b80aa2665be3539667ef3749fafb0bde8c8ff529867ca0f0dc13bc18',  // moonbags_stake::Configuration (created by 0x3c64691e init)
  lockConfig:    '0x7b3f064b45911affde459327ba394f2aa8782539d9b988c4986ee71c5bd34059',  // moonbags_token_lock::Configuration (created by 0x3c64691e init)
  // TokenRegistry was removed (no CoinMetadata<SUI>)
  tokenRegistry: '0x0000000000000000000000000000000000000000000000000000000000000000',
}

// ── Cetus DEX objects (verified on mainnet) ─────────────────
// CetusClmm package: 0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb
// LpBurn package:    0x12d73de9a6bc3cb658ec9dc0fe7de2662be1cea5c76c092fcc3606048cdbac27
export const CETUS_CONTRACT = {
  globalConfig: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f',  // cetus_clmm::config::GlobalConfig ✅ (verified objects)
  pools:        '0xf699e7f2276f5c9a75944b37a0c5b5d9ddfd2471bf6242483b03ab2887d198d0',  // cetus_clmm::factory::Pools ✅ (verified objects)
  burnManager:  '0x1d94aa32518d0cb00f9de6ed60d450c9a2090761f326752ffad06b2e9404f845',  // lp_burn::BurnManager ✅ (verified objects)
}

// ── SUI system objects ──────────────────────────────────────
export const SUI_CLOCK        = '0x0000000000000000000000000000000000000000000000000000000000000006'
export const SUI_METADATA_ID  = '0x9258181f5ceac8dbffb7030890243caed69a9599d2886d957a9cb7656af3bdb3'  // CoinMetadata<SUI> (0xf256d3fb is now coin_registry::Currency<SUI> after Protocol Upgrade #103)

// ── AIDA Token ──────────────────────────────────────────────
export const AIDA_CONTRACT = {
  address:  '0x1ad8be4cfc52cda5db8c1d7b8e309637a2c0eb6b2a3816aab0af5be926f94c1e',
  module:      'aida',
  type:        'AIDA',
  fullAddress: '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA',
}

export const STAKING_CONTRACT = {
  address:  '0xf1c7fe9b6ad3c243f794d41e87fab502883d5fc27e005d72e94fe64bbf08c69b',
  module:   'moonbags_stake',
  configId: '0x499307fa392ec0c34bc0ce977931961b74b80d6b77115f784a173af518e78650',
}

// ── Wallets ─────────────────────────────────────────────────
export const TREASURY_WALLET = '0x92a32ac7fd525f8bd37ed359423b8d7d858cad26224854dfbff1914b75ee658b'
export const ADMIN_WALLET    = '0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409'

// ── Backend ─────────────────────────────────────────────────
export const BACKEND_URL = 'https://theodyssey-backend-production.up.railway.app/api/v1'
export const QUOTE_COIN  = '0x2::sui::SUI'

// ── Backwards-compat aliases ────────────────────────────────
export const ODYSSEY_CONTRACT = MOONBAGS_CONTRACT

// ── Bonding curve constants (from on-chain Configuration) ───
// Read from 0x1fd45c94... on 2026-03-20
export const CURVE_CONFIG = {
  initialVirtualTokenReserves: BigInt(8_000_000_000_000),  // 8M tokens (6 decimals)
  remainTokenReserves:         BigInt(2_000_000_000_000),  // 2M tokens virtual
  defaultThresholdMist:        BigInt(3_000_000_000),      // 3 SUI graduation
  minimumThresholdMist:        BigInt(2_000_000_000),      // 2 SUI minimum
  poolCreationFeeMist:         BigInt(10_000_000),         // 0.01 SUI
  platformFeeBps:              100,                        // 1% (100/10000)
  tokenDecimals:               6,
}

export const MIGRATION_TYPE = {
  CETUS:   0,
  TURBOS:  1,
} as const

// ── Mock data for UI fallback ────────────────────────────────
export const MOCK_TOKENS = [
  {
    id: '1', name: 'Doge AI', symbol: 'DAI', address: '0x1',
    age: '2h', creatorShort: '4fbb14', creatorFull: '0x4fbb14',
    suiRewards: 12.5, holders: 156, marketCap: 42000, bondingProgress: 45,
    description: 'AI-powered doge on Sui blockchain', liveStreamUrl: '', isMock: true,
  },
]

export const MOCK_TXNS = [
  { type: 'buy',  address: '0x742d...3a8f', amount: 2.5, token: 'DAI',  time: '2s ago' },
  { type: 'sell', address: '0x1a2b...9c0d', amount: 1.2, token: 'MSUI', time: '15s ago' },
]
