/**
 * update-curve-depth.ts
 *
 * Updates the bonding curve Configuration to match Moonbags' pool depth.
 *
 * Problem: Odyssey pools start with virtual_sui = threshold (2000 SUI),
 *          making them 3x deeper than Moonbags pools which start at
 *          virtual_sui = threshold/3 (~666 SUI). This means the same
 *          SUI buy moves price 3x less on Odyssey than on Moonbags.
 *
 * Fix:     Change remain_token_reserves from 2× to 4× initial, which
 *          changes the pool creation formula:
 *
 *          BEFORE (Odyssey):  virtual_sui = threshold × I/(R-I) = threshold × 1/1 = threshold
 *          AFTER  (Moonbags): virtual_sui = threshold × I/(R-I) = threshold × 1/3 = threshold/3
 *
 *          Where I = initial_virtual_token_reserves, R = remain_token_reserves.
 *
 * Impact:  Only affects NEW pools. Existing tokens keep their current curves.
 *
 * Usage:
 *   npx ts-node scripts/update-curve-depth.ts
 *
 * Requirements:
 *   - Must be signed by the admin wallet that owns the AdminCap
 *   - AdminCap: 0x71e180b7bd65f62b7d3dad50f0a73b92f7adf8e999037363ed648c89c7c446a8
 *   - Admin:    0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409
 */

import { Transaction } from '@mysten/sui/transactions'

// ── Contract addresses ──────────────────────────────────────
const PACKAGE_ID    = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'
const CONFIGURATION = '0xfb774b5c4902d7d39e899388f520db0e2b1a6dca72687803b894d7d67eca9326'
const ADMIN_CAP     = '0x71e180b7bd65f62b7d3dad50f0a73b92f7adf8e999037363ed648c89c7c446a8'
const SUI_CLOCK     = '0x0000000000000000000000000000000000000000000000000000000000000006'

// ── Config values ───────────────────────────────────────────
// CHANGED: remain_token_reserves doubled from 1,066,666,667,000,000 to 2,133,333,334,000,000
//          This makes remain = 4 × initial (was 2 × initial)
//          New pool depth: virtual_sui = threshold/3 (matches Moonbags)
//
// APPLIED: TX 4PwQydqMowgYWCMFVYfFdTnZcWLR7kDRpSwQCkLh4B17 (2026-04-06)
// initial = 1,066,666,667,000,000  |  remain = 4,266,666,668,000,000  (4:1 ratio)
// virtual_sui = threshold/3 ≈ 667 SUI (matches Moonbags)

const PLATFORM_FEE                     = 200n                       // 2% (unchanged)
const INITIAL_VIRTUAL_TOKEN_RESERVES   = 1_066_666_667_000_000n     // ~1.067B tokens
const REMAIN_TOKEN_RESERVES            = 4_266_666_668_000_000n     // 4× initial (matches Moonbags)
const TOKEN_DECIMALS                   = 6                          // (unchanged)
const INIT_PLATFORM_FEE_WITHDRAW       = 4000                       // 40% to platform
const INIT_CREATOR_FEE_WITHDRAW        = 3000                       // 30% to creator
const INIT_STAKE_FEE_WITHDRAW          = 1                          // ~0% dust (must be >0)
const INIT_PLATFORM_STAKE_FEE_WITHDRAW = 2999                       // ~30% to AIDA stakers

const AIDA_TYPE_NAME = 'cee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'

// ── Build transaction ───────────────────────────────────────

export function buildUpdateCurveDepthTx(): Transaction {
  const tx = new Transaction()

  tx.moveCall({
    target: `${PACKAGE_ID}::moonbags::update_config`,
    arguments: [
      tx.object(ADMIN_CAP),                                        // AdminCap
      tx.object(CONFIGURATION),                                    // Configuration
      tx.pure.u64(PLATFORM_FEE),                                   // platform_fee
      tx.pure.u64(INITIAL_VIRTUAL_TOKEN_RESERVES),                 // initial_virtual_token_reserves
      tx.pure.u64(REMAIN_TOKEN_RESERVES),                          // remain_token_reserves  ← CHANGED
      tx.pure.u8(TOKEN_DECIMALS),                                  // token_decimals
      tx.pure.u16(INIT_PLATFORM_FEE_WITHDRAW),                    // init_platform_fee_withdraw
      tx.pure.u16(INIT_CREATOR_FEE_WITHDRAW),                     // init_creator_fee_withdraw
      tx.pure.u16(INIT_STAKE_FEE_WITHDRAW),                       // init_stake_fee_withdraw
      tx.pure.u16(INIT_PLATFORM_STAKE_FEE_WITHDRAW),              // init_platform_stake_fee_withdraw
      tx.pure.string(AIDA_TYPE_NAME),                              // token_platform_type_name
      tx.object(SUI_CLOCK),                                        // Clock
    ],
  })

  return tx
}

// ── Print summary when run directly ─────────────────────────

if (require.main === module) {
  const I = Number(INITIAL_VIRTUAL_TOKEN_RESERVES)
  const R = Number(REMAIN_TOKEN_RESERVES)
  const ratio = R / I
  const depthMultiplier = I / (R - I)

  console.log('=== Update Bonding Curve Depth ===')
  console.log('')
  console.log('Changes:')
  console.log(`  remain_token_reserves: → ${REMAIN_TOKEN_RESERVES.toLocaleString()}`)
  console.log(`  Ratio (remain/initial): 2.0 → ${ratio.toFixed(1)}`)
  console.log('')
  console.log('Effect on new pools (threshold = 2000 SUI):')
  console.log(`  OLD: virtual_sui = 2000 SUI   (pool depth = threshold)`)
  console.log(`  NEW: virtual_sui = ${(2000 * depthMultiplier).toFixed(1)} SUI  (pool depth = threshold/${(1/depthMultiplier).toFixed(0)})`)
  console.log('')
  console.log('Price sensitivity: ~3x more responsive (matches Moonbags)')
  console.log('Existing pools: NOT affected (only new token launches)')
  console.log('')
  console.log('Sign and submit with admin wallet:')
  console.log('  0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409')
  console.log('')

  const tx = buildUpdateCurveDepthTx()
  console.log('Transaction built successfully.')
  console.log('Import buildUpdateCurveDepthTx() into your signing environment to execute.')
}
