/**
 * halve-supply.ts
 *
 * Halves the total token supply minted per NEW bonding-curve pool by
 * cutting `initial_virtual_token_reserves` and `remain_token_reserves`
 * in half while preserving the 4:1 ratio.
 *
 * Contract mints 2 × remain_token_reserves at pool creation (see
 * moonbags_aida.move:333-336), so halving `R` halves the total supply.
 *
 *                     BEFORE           AFTER
 *   I                 200,000,000      100,000,000   ← halved
 *   R (= 4 × I)       800,000,000      400,000,000   ← halved
 *   Total minted      2 × R = 1.6B     2 × R = 800M  ← halved
 *   Ratio R / I       4.0              4.0           (unchanged)
 *   virtual_sui       threshold / 3    threshold / 3 (unchanged)
 *   virtual_token     1,066,666,667    533,333,333   (halved)
 *
 * Only affects NEW pools. Existing tokens keep their 1.6B supply.
 *
 * Two txs required — one per Configuration:
 *   1. V12 SUI-paired moonbags  (0x74b01e1b…)
 *   2. AIDA-paired moonbags_aida (0x66bb8347…)
 *
 * Usage:
 *   Set admin-cap IDs in env (see constants below), then:
 *     npx ts-node scripts/halve-supply.ts
 *   The script prints a preview and builds two Transactions. Import the
 *   builder functions from your signing environment to execute them
 *   with the admin wallet.
 *
 * Finding the AdminCap object IDs (admin wallet 0x2957f0…67409):
 *   sui client objects --json \
 *     --owner 0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409 \
 *     | jq '.[] | select(.data.type | test("moonbags::AdminCap$"))'
 *
 *   You should see two AdminCap objects — one owned by package V12
 *   (0x95bb61b…) and one owned by the AIDA package (0x2156ceed…).
 *   The `data.type` string starts with the owning package ID.
 */

import { Transaction } from '@mysten/sui/transactions'

// ── Contract addresses ──────────────────────────────────────
const V12_PACKAGE_ID    = '0x95bb61b03a5d476c2621b2b3f512e8fd5f0976260ce4e8d0d9a79ca64b658f4e'
const V12_CONFIGURATION = '0x74b01e1bf199031609d06a3b9669fffd0c77a17b57ece97595e86b0af000a5ea'

const AIDA_PACKAGE_ID    = '0x2156ceed0866b899840871add0efdae25799b2b22df1563922b5b01c011975a8'
const AIDA_CONFIGURATION = '0x66bb8347ae793fb2f955465558b8c1ef74ab74289a9a5cc4a558e6cbbc587d91'

// AdminCap object IDs — fill in before running. Each package has its own.
const V12_ADMIN_CAP  = process.env.V12_ADMIN_CAP  || '<PASTE V12 ADMIN CAP OBJECT ID>'
const AIDA_ADMIN_CAP = process.env.AIDA_ADMIN_CAP || '<PASTE AIDA ADMIN CAP OBJECT ID>'

const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

// ── New config values (halved, ratio preserved) ─────────────
const PLATFORM_FEE                     = 200n                   // 2% (unchanged)
const INITIAL_VIRTUAL_TOKEN_RESERVES   = 100_000_000_000_000n   // 100M tokens (was 200M)
const REMAIN_TOKEN_RESERVES            = 400_000_000_000_000n   // 400M tokens (was 800M; still 4× initial)
const TOKEN_DECIMALS                   = 6                      // (unchanged)
const INIT_PLATFORM_FEE_WITHDRAW       = 4000                   // 40% (unchanged)
const INIT_CREATOR_FEE_WITHDRAW        = 3000                   // 30% (unchanged)
const INIT_STAKE_FEE_WITHDRAW          = 1                      // ~0% dust (unchanged, must be >0)
const INIT_PLATFORM_STAKE_FEE_WITHDRAW = 2999                   // ~30% AIDA stakers (unchanged)

// Platform type name (unchanged — both configs pay stake fees to AIDA stakers).
// WITHOUT 0x prefix to match type_name::into_string() output.
const AIDA_TYPE_NAME = 'cee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'

// ── Transaction builders ────────────────────────────────────

function buildUpdateConfigTx(params: {
  packageId: string
  configuration: string
  adminCap: string
}): Transaction {
  const tx = new Transaction()

  tx.moveCall({
    target: `${params.packageId}::moonbags::update_config`,
    arguments: [
      tx.object(params.adminCap),                                  // AdminCap
      tx.object(params.configuration),                             // Configuration
      tx.pure.u64(PLATFORM_FEE),                                   // platform_fee
      tx.pure.u64(INITIAL_VIRTUAL_TOKEN_RESERVES),                 // initial_virtual_token_reserves ← HALVED
      tx.pure.u64(REMAIN_TOKEN_RESERVES),                          // remain_token_reserves          ← HALVED
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

export function buildHalveSupplyV12Tx(): Transaction {
  return buildUpdateConfigTx({
    packageId:     V12_PACKAGE_ID,
    configuration: V12_CONFIGURATION,
    adminCap:      V12_ADMIN_CAP,
  })
}

export function buildHalveSupplyAidaTx(): Transaction {
  return buildUpdateConfigTx({
    packageId:     AIDA_PACKAGE_ID,
    configuration: AIDA_CONFIGURATION,
    adminCap:      AIDA_ADMIN_CAP,
  })
}

// ── Preview when run directly ───────────────────────────────

if (require.main === module) {
  const I = Number(INITIAL_VIRTUAL_TOKEN_RESERVES)
  const R = Number(REMAIN_TOKEN_RESERVES)
  const threshold = 2000 // SUI/AIDA, for preview only

  const virtualTokenBase = (R * R) / (R - I)
  const virtualToken = virtualTokenBase / 1e6
  const virtualSui = (threshold * I) / (R - I)
  const totalMinted = (2 * R) / 1e6
  const fiftyBuy = (virtualToken * 50) / (virtualSui + 50)

  console.log('=== Halve Supply — Moonbags V12 + AIDA ===')
  console.log('')
  console.log('Targeting two Configurations:')
  console.log('  V12  (SUI pair):  pkg ' + V12_PACKAGE_ID)
  console.log('                    cfg ' + V12_CONFIGURATION)
  console.log('                    cap ' + V12_ADMIN_CAP)
  console.log('  AIDA (AIDA pair): pkg ' + AIDA_PACKAGE_ID)
  console.log('                    cfg ' + AIDA_CONFIGURATION)
  console.log('                    cap ' + AIDA_ADMIN_CAP)
  console.log('')
  console.log('Changes (applied to BOTH configs):')
  console.log('  initial_virtual_token_reserves: 200,000,000,000,000 → ' + INITIAL_VIRTUAL_TOKEN_RESERVES.toLocaleString())
  console.log('  remain_token_reserves:          800,000,000,000,000 → ' + REMAIN_TOKEN_RESERVES.toLocaleString())
  console.log(`  Ratio R / I: 4.0 → ${(R / I).toFixed(1)} (preserved)`)
  console.log('')
  console.log('Per-pool supply & curve (after halving):')
  console.log(`  Total minted per pool: ${totalMinted.toLocaleString()} tokens  (was 1,600,000,000 — halved)`)
  console.log(`  virtual_token at creation: ${virtualToken.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens  (halved)`)
  console.log(`  virtual_sui at creation (threshold=${threshold}): ${virtualSui.toFixed(2)}  (unchanged)`)
  console.log(`  50-unit buy: ${fiftyBuy.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens  (half of prior ~74.4M)`)
  console.log('')
  console.log('Execution:')
  console.log('  1. Set env: V12_ADMIN_CAP=0x… AIDA_ADMIN_CAP=0x…')
  console.log('  2. Import buildHalveSupplyV12Tx + buildHalveSupplyAidaTx')
  console.log('  3. Sign & submit each with admin wallet 0x2957f0…67409')
  console.log('  4. After BOTH land, push the matching frontend constants patch')
  console.log('     (lib/contracts.ts CURVE_CONFIG + POST_GRAD_SUPPLY fallbacks).')

  buildHalveSupplyV12Tx()
  buildHalveSupplyAidaTx()
  console.log('\nBoth transactions built successfully.')
}
