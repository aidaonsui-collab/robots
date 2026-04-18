// ============================================================
// AIDA-Paired Bonding Curve Contract (robots repo)
// Fork of Odyssey Moonbags — quote token changed from SUI → AIDA
//
// Published: 2026-04-18
// Package: 0x2156ceed0866b899840871add0efdae25799b2b22df1563922b5b01c011975a8
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
  packageId:     '0x2156ceed0866b899840871add0efdae25799b2b22df1563922b5b01c011975a8',
  module:        'moonbags',
  configuration: '0x66bb8347ae793fb2f955465558b8c1ef74ab74289a9a5cc4a558e6cbbc587d91',
  stakeConfig:   '0x64c07e79494e0f51923c0a7a524a9429605d464e3583be3f9b20ce3765a92cd5',
  lockConfig:    '0x22c3121014b0eca1eca28cf2a9ea680d625b80679e1d3771545cbcad9e15faa4',
  tokenRegistry: '0x0000000000000000000000000000000000000000000000000000000000000000',
}

// AIDA coin type string (used as typeArgument)
export const AIDA_COIN_TYPE = '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'

// Bluefin AIDA/SUI CLMM pool for price oracle
export const BLUEFIN_AIDA_POOL = '0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b'

// Bluefin spot contract (for SDK)
export const BLUEFIN_SPOT_CONTRACT = '0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267'
