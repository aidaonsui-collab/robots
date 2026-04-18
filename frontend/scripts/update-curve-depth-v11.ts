/**
 * update-curve-depth-v11.ts
 *
 * Updates the v11 bonding curve Configuration to match Moonbags' actual
 * pool depth AND magnitude.
 *
 * Problem: v11 was published with (I=1.067B, R=4.267B). The 4:1 ratio
 *          gives the right virtual_sui = threshold/3, but virtual_token =
 *          R²/(R-I) = 5.688B, which is 5.33× Moonbags' actual V_t = 1.067B.
 *          Result: a 50 SUI buy on Odyssey mints 396.9M tokens vs Moonbags'
 *          74.4M — our tokens are 5.33× "cheaper" and total supply is
 *          5.33× larger than it should be.
 *
 * Fix:     Shrink both I and R by 5.33× while keeping the 4:1 ratio.
 *
 *            OLD: I = 1,066,666,667,000,000   R = 4,266,666,668,000,000
 *            NEW: I =   200,000,000,000,000   R =   800,000,000,000,000
 *
 *          With new values:
 *            V_t = R²/(R-I) = 800M² / 600M = 1,066,666,667 ✓ (matches Moonbags)
 *            V_s = threshold × I / (R-I) = 2000 × 200M / 600M = 666.67 ✓
 *            50 SUI buy: 1.067B × 50 / 716.67 = 74,418,604 tokens ✓
 *
 * Impact:  Only affects NEW pools. Existing v11 tokens keep their current
 *          curves. Total minted supply for new tokens drops from 8.533B to
 *          1.6B, matching Moonbags' typical supply.
 *
 * Usage:
 *   npx ts-node scripts/update-curve-depth-v11.ts
 *
 * Requirements:
 *   - Must be signed by the admin wallet that owns the v11 AdminCap
 *   - v11 AdminCap: 0x0f91d6573df3561768614d6c18d881635335e38dfb6064445ccebec543014551
 *   - Admin wallet: 0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409
 *
 * Related: scripts/update-curve-depth.ts did the same thing on the legacy
 *          v7 chain back on 2026-04-06, but with the wrong magnitude (same
 *          5.33× too large bug). Only ratio was fixed there. This script
 *          targets v11's fresh Configuration and Admin objects.
 */

import { Transaction } from '@mysten/sui/transactions'

// ── v11 Contract addresses ──────────────────────────────────
// Published 2026-04-09, TX: B7JxuVZagsitahkgMYt2qS42MdbR5ZY2PMV7yxPD8hsw
const PACKAGE_ID    = '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813'
const CONFIGURATION = '0x74b01e1bf199031609d06a3b9669fffd0c77a17b57ece97595e86b0af000a5ea'
const ADMIN_CAP     = '0x0f91d6573df3561768614d6c18d881635335e38dfb6064445ccebec543014551'
const SUI_CLOCK     = '0x0000000000000000000000000000000000000000000000000000000000000006'

// ── New config values (Moonbags parity) ─────────────────────
const PLATFORM_FEE                     = 200n                   // 2% (unchanged)
const INITIAL_VIRTUAL_TOKEN_RESERVES   = 200_000_000_000_000n   // 200M tokens (was 1.067B)
const REMAIN_TOKEN_RESERVES            = 800_000_000_000_000n   // 800M tokens (4× initial, was 4.267B)
const TOKEN_DECIMALS                   = 6                      // (unchanged)
const INIT_PLATFORM_FEE_WITHDRAW       = 4000                   // 40% (unchanged)
const INIT_CREATOR_FEE_WITHDRAW        = 3000                   // 30% (unchanged)
const INIT_STAKE_FEE_WITHDRAW          = 1                      // ~0% dust (must be >0)
const INIT_PLATFORM_STAKE_FEE_WITHDRAW = 2999                   // ~30% AIDA stakers (unchanged)

// Must be set WITHOUT 0x prefix to match type_name::into_string() output
const AIDA_TYPE_NAME = 'cee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'

// ── Build transaction ───────────────────────────────────────

export function buildUpdateCurveDepthV11Tx(): Transaction {
  const tx = new Transaction()

  tx.moveCall({
    target: `${PACKAGE_ID}::moonbags::update_config`,
    arguments: [
      tx.object(ADMIN_CAP),                                        // AdminCap
      tx.object(CONFIGURATION),                                    // Configuration
      tx.pure.u64(PLATFORM_FEE),                                   // platform_fee
      tx.pure.u64(INITIAL_VIRTUAL_TOKEN_RESERVES),                 // initial_virtual_token_reserves ← CHANGED
      tx.pure.u64(REMAIN_TOKEN_RESERVES),                          // remain_token_reserves          ← CHANGED
      tx.pure.u8(TOKEN_DECIMALS),                                  // token_decimals
      tx.pure.u16(INIT_PLATFORM_FEE_WITHDRAW),                     // init_platform_fee_withdraw
      tx.pure.u16(INIT_CREATOR_FEE_WITHDRAW),                      // init_creator_fee_withdraw
      tx.pure.u16(INIT_STAKE_FEE_WITHDRAW),                        // init_stake_fee_withdraw
      tx.pure.u16(INIT_PLATFORM_STAKE_FEE_WITHDRAW),               // init_platform_stake_fee_withdraw
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
  const threshold = 2000 // SUI for preview only

  // V_t = R²/(R-I)
  const virtualTokenBase = (R * R) / (R - I)
  const virtualToken = virtualTokenBase / 1e6 // 6 decimals
  // V_s = threshold * I / (R - I)  — in SUI
  const virtualSui = (threshold * I) / (R - I)
  // 50 SUI buy preview
  const suiIn = 50
  const tokensOut = (virtualToken * suiIn) / (virtualSui + suiIn)

  console.log('=== Update v11 Bonding Curve Depth (Moonbags Parity) ===')
  console.log('')
  console.log('Targeting:')
  console.log(`  Package:  ${PACKAGE_ID}`)
  console.log(`  Config:   ${CONFIGURATION}`)
  console.log(`  AdminCap: ${ADMIN_CAP}`)
  console.log('')
  console.log('Changes:')
  console.log(`  initial_virtual_token_reserves: 1,066,666,667,000,000 → ${INITIAL_VIRTUAL_TOKEN_RESERVES.toLocaleString()}`)
  console.log(`  remain_token_reserves:          4,266,666,668,000,000 → ${REMAIN_TOKEN_RESERVES.toLocaleString()}`)
  console.log(`  Ratio remain/initial: 4.0 → ${(R / I).toFixed(1)} (unchanged)`)
  console.log('')
  console.log(`Preview (threshold = ${threshold} SUI):`)
  console.log(`  virtual_token at creation: ${virtualToken.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens`)
  console.log(`  virtual_sui at creation:   ${virtualSui.toFixed(2)} SUI`)
  console.log(`  50 SUI buy ≈ ${tokensOut.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens`)
  console.log('')
  console.log('Moonbags parity check:')
  console.log('  Expected V_t = 1,066,666,667   Actual V_t = ' + virtualToken.toLocaleString(undefined, { maximumFractionDigits: 0 }))
  console.log('  Expected V_s = 666.67 SUI      Actual V_s = ' + virtualSui.toFixed(2))
  console.log('  Expected 50 SUI buy = 74,418,604 tokens')
  console.log('')
  console.log('Sign and submit with the admin wallet:')
  console.log('  0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409')
  console.log('')

  const tx = buildUpdateCurveDepthV11Tx()
  console.log('Transaction built successfully.')
  console.log('Import buildUpdateCurveDepthV11Tx() into your signing environment to execute.')
}
