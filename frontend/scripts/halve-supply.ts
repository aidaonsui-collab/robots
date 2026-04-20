/**
 * halve-supply.ts
 *
 * Unifies new-pool total supply to 800M tokens across BOTH pair types by
 * halving V12 (SUI pair) and ~10.67× shrinking AIDA (AIDA pair). Both
 * configs end up with identical curve parameters so a fresh token looks
 * the same regardless of pair.
 *
 *                                     BEFORE                    AFTER (both)
 *   V12 (SUI-pair)   I                200,000,000               100,000,000
 *                    R (= 4 × I)      800,000,000               400,000,000
 *                    Total minted     2R = 1,600,000,000        2R = 800,000,000
 *
 *   AIDA             I                1,066,666,667             100,000,000  (~10.67× cut)
 *                    R                4,266,666,668             400,000,000
 *                    Total minted     2R = 8,533,333,336        2R = 800,000,000
 *
 *   Ratio R / I preserved at 4:1 on both.
 *   virtual_sui at creation = threshold / 3 on both (unchanged formula).
 *   virtual_token at creation = R² / (R - I) = 533,333,333 on both.
 *
 * Fee split is KEPT at the live on-chain 40/25/10/25 (platform / creator /
 * meme-staker / AIDA-staker). Jack confirmed this is the current state on
 * both configs — my earlier version hardcoded the stale 40/30/~0/30 that
 * predated the update, which would have been a silent regression.
 *
 * Only affects NEW pools. Every existing token keeps its original supply
 * (1.6B for old SUI pairs, 8.53B for existing AIDA pairs).
 *
 * Usage:
 *   V12_ADMIN_CAP=0x… AIDA_ADMIN_CAP=0xccca6c3d… \
 *     npx ts-node scripts/halve-supply.ts
 *
 * Two separate txs are required — one per Configuration. Both must be
 * signed by admin wallet 0x2957f0…67409. Sign each in turn with the
 * matching AdminCap. If one fails, the other can still be applied; the
 * configs are independent.
 *
 * Rollback: call update_config again with the prior values.
 *   V12 priors:  I = 200M,  R = 800M
 *   AIDA priors: I = 1.07B, R = 4.27B
 */

import { Transaction } from '@mysten/sui/transactions'

// ── Contract addresses ──────────────────────────────────────

const V12_PACKAGE_ID    = '0x95bb61b03a5d476c2621b2b3f512e8fd5f0976260ce4e8d0d9a79ca64b658f4e'
const V12_CONFIGURATION = '0x74b01e1bf199031609d06a3b9669fffd0c77a17b57ece97595e86b0af000a5ea'

const AIDA_PACKAGE_ID    = '0x2156ceed0866b899840871add0efdae25799b2b22df1563922b5b01c011975a8'
const AIDA_CONFIGURATION = '0x66bb8347ae793fb2f955465558b8c1ef74ab74289a9a5cc4a558e6cbbc587d91'

// AdminCap object IDs — fill in via env before running. AIDA known; V12 TBD.
const V12_ADMIN_CAP  = process.env.V12_ADMIN_CAP  || '<PASTE V12 ADMIN CAP OBJECT ID>'
const AIDA_ADMIN_CAP = process.env.AIDA_ADMIN_CAP || '0xccca6c3d6c4626337c8acf3dc85e28bbe7e8085ade1692b7d93e3237a0547bfc'

const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

// ── Target values (same on both configs — the whole point of unifying) ──

const PLATFORM_FEE                     = 200n                   // 2% (unchanged)
const INITIAL_VIRTUAL_TOKEN_RESERVES   = 100_000_000_000_000n   // 100M tokens (6 decimals)
const REMAIN_TOKEN_RESERVES            = 400_000_000_000_000n   // 400M tokens — mints 2R = 800M
const TOKEN_DECIMALS                   = 6                      // (unchanged)

// Live fee split on BOTH configs as of Jack's on-chain read — preserve exactly.
// Sum must be ≤ 10,000. Current sum = 4000 + 2500 + 1000 + 2500 = 10,000. ✓
const INIT_PLATFORM_FEE_WITHDRAW       = 4000                   // 40% platform/treasury
const INIT_CREATOR_FEE_WITHDRAW        = 2500                   // 25% token creator
const INIT_STAKE_FEE_WITHDRAW          = 1000                   // 10% meme-token stakers
const INIT_PLATFORM_STAKE_FEE_WITHDRAW = 2500                   // 25% AIDA stakers

// Platform type name — unchanged on both configs. WITHOUT 0x prefix to match
// the type_name::into_string() output the contract compares against.
const AIDA_TYPE_NAME = 'cee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'

// ── Transaction builder ─────────────────────────────────────

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
      tx.object(params.configuration),                             // Configuration (shared)
      tx.pure.u64(PLATFORM_FEE),                                   // platform_fee
      tx.pure.u64(INITIAL_VIRTUAL_TOKEN_RESERVES),                 // initial_virtual_token_reserves ← CHANGED
      tx.pure.u64(REMAIN_TOKEN_RESERVES),                          // remain_token_reserves          ← CHANGED
      tx.pure.u8(TOKEN_DECIMALS),                                  // token_decimals
      tx.pure.u16(INIT_PLATFORM_FEE_WITHDRAW),                     // 40%
      tx.pure.u16(INIT_CREATOR_FEE_WITHDRAW),                      // 25%
      tx.pure.u16(INIT_STAKE_FEE_WITHDRAW),                        // 10%
      tx.pure.u16(INIT_PLATFORM_STAKE_FEE_WITHDRAW),               // 25%
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
  const threshold = 2000

  const virtualTokenBase = (R * R) / (R - I)
  const virtualToken     = virtualTokenBase / 1e6
  const virtualSui       = (threshold * I) / (R - I)
  const totalMinted      = (2 * R) / 1e6
  const fiftyBuy         = (virtualToken * 50) / (virtualSui + 50)

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

  console.log('=== Unify Supply to 800M per pool (V12 + AIDA) ===')
  console.log('')
  console.log('Configurations being updated (separate txs, same target values):')
  console.log(`  V12  (SUI pair):  pkg ${V12_PACKAGE_ID}`)
  console.log(`                    cfg ${V12_CONFIGURATION}`)
  console.log(`                    cap ${V12_ADMIN_CAP}`)
  console.log(`  AIDA (AIDA pair): pkg ${AIDA_PACKAGE_ID}`)
  console.log(`                    cfg ${AIDA_CONFIGURATION}`)
  console.log(`                    cap ${AIDA_ADMIN_CAP}`)
  console.log('')
  console.log('Per-config changes:')
  console.log('                                BEFORE (live)       →  AFTER (script target)')
  console.log(`  V12.I                         200,000,000         →  ${fmt(I / 1e6)}`)
  console.log(`  V12.R                         800,000,000         →  ${fmt(R / 1e6)}`)
  console.log(`  V12 total-mint per pool       1,600,000,000       →  ${fmt(totalMinted)}    (2× cut)`)
  console.log(`  AIDA.I                        1,066,666,667       →  ${fmt(I / 1e6)}`)
  console.log(`  AIDA.R                        4,266,666,668       →  ${fmt(R / 1e6)}`)
  console.log(`  AIDA total-mint per pool      8,533,333,336       →  ${fmt(totalMinted)}    (~10.67× cut)`)
  console.log(`  Ratio R/I (both)              4.0                 →  ${(R / I).toFixed(1)} (preserved)`)
  console.log('')
  console.log('Fee split (preserved exactly on both configs):')
  console.log(`  platform   ${INIT_PLATFORM_FEE_WITHDRAW / 100}% / creator ${INIT_CREATOR_FEE_WITHDRAW / 100}% / meme-staker ${INIT_STAKE_FEE_WITHDRAW / 100}% / AIDA-staker ${INIT_PLATFORM_STAKE_FEE_WITHDRAW / 100}%`)
  console.log('')
  console.log(`Per-pool curve (threshold = ${threshold} SUI/AIDA):`)
  console.log(`  virtual_token at creation:  ${fmt(virtualToken)} tokens`)
  console.log(`  virtual_sui at creation:    ${virtualSui.toFixed(2)}  (= threshold / 3)`)
  console.log(`  50-unit initial buy yields: ${fmt(fiftyBuy)} tokens`)
  console.log('')
  console.log('Validation (fees must sum to ≤ 10,000):')
  const feeSum = INIT_PLATFORM_FEE_WITHDRAW + INIT_CREATOR_FEE_WITHDRAW + INIT_STAKE_FEE_WITHDRAW + INIT_PLATFORM_STAKE_FEE_WITHDRAW
  console.log(`  Sum = ${feeSum} bps ${feeSum <= 10000 ? '✓' : '✗ (would abort with EInvalidInput)'}`)
  console.log('')
  if (V12_ADMIN_CAP.startsWith('<')) {
    console.log('⚠️  V12_ADMIN_CAP not set — re-run with:')
    console.log('    V12_ADMIN_CAP=0x… AIDA_ADMIN_CAP=0xccca6c3d… npx ts-node scripts/halve-supply.ts')
    console.log('')
  }
  console.log('Execution:')
  console.log('  1. Import buildHalveSupplyV12Tx + buildHalveSupplyAidaTx into your signer')
  console.log('  2. Sign & submit each with admin wallet 0x2957f0…67409')
  console.log('  3. Verify both configs on-chain via: sui client object <config_id>')
  console.log('  4. Tell me the two digests and I will push the matching')
  console.log('     frontend-constants patch (lib/contracts.ts CURVE_CONFIG 100M/400M).')
  console.log('')

  buildHalveSupplyV12Tx()
  buildHalveSupplyAidaTx()
  console.log('Both transactions built successfully.')
}
