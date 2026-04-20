import { MOONBAGS_AIDA_CONTRACT } from './contracts_aida'
// ============================================================
// TheOdyssey.fun — Contract Addresses (Verified on-chain)
// Last verified: 2026-04-09 — v11 coexist refactor
// ============================================================
//
// Coexist strategy: v11 is a fresh mainnet publish (fixes balance::split
// bug), NOT an upgrade of the legacy chain. So we keep both packages live:
//
//   • LEGACY pools (created pre-v11): buy/sell/withdraw via the legacy
//     package chain (v7 root `0xf1c7...` callable through upgrades).
//   • NEW pools: created and traded on v11 `0xc87a...`.
//
// Per-pool routing uses the pool's object-type prefix
// (`<pkgId>::moonbags::Pool<...>`) to pick the right set of IDs via
// `getMoonbagsContractForPackage()`.
//
// AIDA stakers remain on the legacy stake config — there is no migration
// nudge. Only the NEW bonding-curve paths flip over to v11.

export interface MoonbagsContract {
  packageId:     string
  module:        'moonbags'
  configuration: string
  stakeConfig:   string
  lockConfig:    string
  tokenRegistry: string
}

// ── Legacy Moonbags chain (v7 root, upgraded through v10) ───
// Writes to any package ID in this chain work because Sui resolves them
// through the UpgradeCap chain. We keep the v7 root as the canonical write
// target since every historical pool was created against it.
// Shared Configuration/StakeConfig/LockConfig objects were initialized with
// the v7 publish and persist unchanged across upgrades.
export const MOONBAGS_CONTRACT_LEGACY: MoonbagsContract = {
  packageId:     '0xf1c7fe9b6ad3c243f794d41e87fab502883d5fc27e005d72e94fe64bbf08c69b', // v7 root (upgrade chain)
  module:        'moonbags',
  configuration: '0xfb774b5c4902d7d39e899388f520db0e2b1a6dca72687803b894d7d67eca9326', // moonbags::Configuration
  stakeConfig:   '0x312216a4b80aa2665be3539667ef3749fafb0bde8c8ff529867ca0f0dc13bc18', // moonbags_stake::Configuration
  lockConfig:    '0x7b3f064b45911affde459327ba394f2aa8782539d9b988c4986ee71c5bd34059', // moonbags_token_lock::Configuration
  tokenRegistry: '0x0000000000000000000000000000000000000000000000000000000000000000',
}

// Every known package ID that resolves to the legacy chain. Any of these
// as the "package" segment of a pool type means it's a legacy pool.
export const MOONBAGS_LEGACY_PACKAGE_IDS: readonly string[] = [
  '0xf1c7fe9b6ad3c243f794d41e87fab502883d5fc27e005d72e94fe64bbf08c69b', // v7 root (write target)
  '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd', // origin (events)
  '0xa9aee0477f07c13ecca43d090bb0254af44986806bdfa92db24be4301b7b137f', // v5
  '0x8f70ad5db84e1a99b542f86ccfb1a932ca7ba010a2fa12a1504d839ff4c111c6', // v9
  '0x1ed54e001ad9f7dc5b5d8e951cce71412f4246d897ed9301c7e456a3400fe40a', // v10 (old frontend target)
  '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813', // v11 ← migrated to legacy
] as const

// ── Moonbags Launchpad v12 (freeze CoinMetadata instead of storing as DOF) ──
// Published: 2026-04-16  TX: J9sdFjppB8881Eo7eZXU9s9xrUeG9Y4LU7LiZBS7bWTg
// Admin caps live on deployer `0x2957f0...`.
export const MOONBAGS_CONTRACT_V12: MoonbagsContract = {
  packageId:     '0x95bb61b03a5d476c2621b2b3f512e8fd5f0976260ce4e8d0d9a79ca64b658f4e',
  module:        'moonbags',
  configuration: '0x74b01e1bf199031609d06a3b9669fffd0c77a17b57ece97595e86b0af000a5ea', // moonbags::Configuration
  stakeConfig:   '0x59c35bc4c50631e4d4468d9964ba23c3961e1ff8d7c6df740fcf776c8936e940', // moonbags_stake::Configuration
  lockConfig:    '0xd3c8ab1092e85101adbdb98b5717b9911dfbc90a41dbf896cada9a25c065a5e3', // moonbags_token_lock::Configuration
  tokenRegistry: '0x0000000000000000000000000000000000000000000000000000000000000000',
}

// Default target for NEW pool creation and new writes. Points at v11.
// Reads/writes against existing pools should use
// `getMoonbagsContractForPackage(poolPkgId)` instead of this constant.
export const MOONBAGS_CONTRACT: MoonbagsContract = MOONBAGS_CONTRACT_V12

// All Moonbags packages we know about (v11 + legacy chain). Used to fan
// out event queries across both code-bases.
export const MOONBAGS_KNOWN_PACKAGES: readonly string[] = [
  MOONBAGS_CONTRACT_V12.packageId,
  ...MOONBAGS_LEGACY_PACKAGE_IDS,
] as const

/**
 * Return the right Moonbags contract bundle for a given pool's package ID.
 * The pool object's type string looks like `0x<pkg>::moonbags::Pool<Coin>`,
 * and the `0x<pkg>` segment tells us whether the pool belongs to the
 * legacy chain or to v11.
 */
export function getMoonbagsContractForPackage(packageId?: string | null): MoonbagsContract {
  if (packageId === MOONBAGS_AIDA_CONTRACT.packageId) return MOONBAGS_AIDA_CONTRACT
  if (!packageId) return MOONBAGS_CONTRACT_V12
  const normalized = packageId.startsWith('0x') ? packageId.toLowerCase() : `0x${packageId.toLowerCase()}`
  // V11 is a fresh publish, not an upgrade of v7/legacy. Its pools use the
  // SAME Configuration / lockConfig / stakeConfig shared objects as V12, so
  // route V11 pool calls to the V12 contract bundle. (V11's packageId still
  // appears in MOONBAGS_LEGACY_PACKAGE_IDS so the event-query fan-out covers
  // it — the shared-config routing is a separate concern from event discovery.)
  const V11_PKG_ID = '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813'
  if (normalized === V11_PKG_ID) return MOONBAGS_CONTRACT_V12
  if (MOONBAGS_LEGACY_PACKAGE_IDS.some(p => p.toLowerCase() === normalized)) {
    return MOONBAGS_CONTRACT_LEGACY
  }
  return MOONBAGS_CONTRACT_V12
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

// ── Platform Token — T1 for withdraw_fee_bonding_curve ───────
// AIDA is the platform token for TheOdyssey (forked from Moonbags which used SHR)
// On-chain config.token_platform_type_name must be set WITHOUT 0x prefix
// to match type_name::into_string() output. See scripts/fix-platform-token.ts
export const PLATFORM_TOKEN_CONTRACT = {
  address:     '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892',
  module:      'aida',
  type:        'AIDA',
  fullAddress: '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA',
}

// ── AIDA Staking (unchanged by v11 deploy — stays on legacy chain) ────
// AIDA stakers are NOT migrated; there is no nudge. This pool keeps
// earning from BOTH legacy and v11 bonding-curve fees via the platform
// stake split.
export const STAKING_CONTRACT = {
  address:  '0xf1c7fe9b6ad3c243f794d41e87fab502883d5fc27e005d72e94fe64bbf08c69b', // v7 root (legacy chain)
  module:   'moonbags_stake',
  configId: '0x312216a4b80aa2665be3539667ef3749fafb0bde8c8ff529867ca0f0dc13bc18', // legacy stake config
}

// ── Wallets ─────────────────────────────────────────────────
export const TREASURY_WALLET = '0x92a32ac7fd525f8bd37ed359423b8d7d858cad26224854dfbff1914b75ee658b'
export const ADMIN_WALLET    = '0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409'

// ── Backend ─────────────────────────────────────────────────
export const BACKEND_URL = 'https://theodyssey-backend1-production.up.railway.app/api/v1'
export const QUOTE_COIN  = '0x2::sui::SUI'

// ── Backwards-compat aliases ────────────────────────────────
// Existing imports of `ODYSSEY_CONTRACT` still resolve. Since this now
// points at v11, any leftover write sites that haven't been migrated to
// per-pool routing will target v11 (new pools only).
export const ODYSSEY_CONTRACT = MOONBAGS_CONTRACT

// ── Bonding curve constants (from on-chain Configuration) ───
// Verified on-chain from v11 Configuration 0x74b01e1b...
// Updated 2026-04-10 via update_config TX to match Moonbags parity:
//   V_t at creation = R²/(R-I) = 800M²/600M = 1,066,666,667 (matches Moonbags)
//   V_s at creation = threshold × I/(R-I) = threshold/3 (matches Moonbags)
// See scripts/update-curve-depth-v11.ts for the on-chain update call.
export const CURVE_CONFIG = {
  initialVirtualTokenReserves: BigInt(200_000_000_000_000),   // 200M tokens (6 decimals)
  remainTokenReserves:         BigInt(800_000_000_000_000),   // 800M tokens (4× initial, Moonbags parity)
  defaultThresholdMist:        BigInt(2_000_000_000_000),     // 2000 SUI graduation (default)
  minimumThresholdMist:        BigInt(1_000_000_000_000),     // 1000 SUI minimum (v11 enforcement)
  poolCreationFeeMist:         BigInt(10_000_000),            // 0.01 SUI
  platformFeeBps:              200,                           // 2% (200/10000)
  tokenDecimals:               6,
}

// ── Fee distribution split (from on-chain Configuration) ────
// Note: init_stake_fee_withdraw is set to 1 (not 0) to avoid a contract bug
// where update_reward_index aborts on zero-value coins. The ~0.01% dust is negligible.
export const FEE_SPLIT = {
  platform:       4000,  // 40% to admin/treasury wallet
  creator:        3000,  // 30% to token creator pool
  stakers:        1,     // ~0% dust to meme token stakers (must be >0)
  platformStake:  2999,  // ~30% to AIDA stakers
} as const

export const MIGRATION_TYPE = {
  MOMENTUM: 0,  // v11: auto-migrated via /api/cron/graduate → Momentum CLMM
  TURBOS:   1,  // legacy only
} as const

// ── Olympus Presale Contract (deployed 2026-04-14 — v8) ─────
// Fixed-price presale launchpad. Successful presales emit
// PresaleMigratingEvent → graduation cron creates Momentum pool.
export const PRESALE_CONTRACT = {
  packageId:     (process.env.NEXT_PUBLIC_PRESALE_PACKAGE_ID || '0x4c9f2fe6a524873adea66ff6f31d6caba0df10d10ffd8b28e99d0b8e26eabc76').trim(),
  module:        'presale',
  configId:      (process.env.NEXT_PUBLIC_PRESALE_CONFIG_ID || '0xa81d4889856be45bb6ca6b6dc47891a3aa259076052cf5182577aba060f88660').trim(),
  adminCapId:    '0x5a0636a2626f99cd7d8844d4f66790b658abaa935885c73b3481bc12138ef39d',
  upgradeCap:    '0xd38fb92d29994c5d854d4cde57dc1a761f9a1b3b3cee240a6e570121142f7e51',
  deployDigest:  'FwKoPVBJAJ4vPyXG5o9Ws8mqWUc19RhucV89yj4K5E7L',
  platformFeeBps: 200,       // 2% on total raised at finalization
  creationFeeMist: 20_000_000_000, // 20 SUI to create presale
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
