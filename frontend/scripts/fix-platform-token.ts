/**
 * fix-platform-token.ts
 * 
 * Fixes the distribute bug by calling update_config with the correct
 * token_platform_type_name — WITHOUT the 0x prefix.
 *
 * Root cause: type_name::into_string() in Sui Move returns addresses
 * without "0x", but previous update_config calls passed the string
 * WITH "0x", so the assertion always fails (abort code 5).
 *
 * This keeps ALL other config values identical — only fixes the
 * token_platform_type_name field.
 *
 * Usage:
 *   npx ts-node scripts/fix-platform-token.ts
 *
 * Requirements:
 *   - Must be signed by the admin wallet that owns the AdminCap
 *   - AdminCap: 0x71e180b7bd65f62b7d3dad50f0a73b92f7adf8e999037363ed648c89c7c446a8
 *   - Admin:    0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409
 */

import { Transaction } from '@mysten/sui/transactions'

// ── Contract addresses ──────────────────────────────────────
const PACKAGE_ID      = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'  // package used for update_config
const CONFIGURATION   = '0xfb774b5c4902d7d39e899388f520db0e2b1a6dca72687803b894d7d67eca9326'
const ADMIN_CAP       = '0x71e180b7bd65f62b7d3dad50f0a73b92f7adf8e999037363ed648c89c7c446a8'
const SUI_CLOCK       = '0x0000000000000000000000000000000000000000000000000000000000000006'

// ── Current on-chain config values (keeping them identical) ──
const PLATFORM_FEE                     = 200n                    // 2%
const INITIAL_VIRTUAL_TOKEN_RESERVES   = 533333333500000n
const REMAIN_TOKEN_RESERVES            = 1066666667000000n
const TOKEN_DECIMALS                   = 6
const INIT_PLATFORM_FEE_WITHDRAW       = 3000                   // 30%
const INIT_CREATOR_FEE_WITHDRAW        = 4000                   // 40%
const INIT_STAKE_FEE_WITHDRAW          = 3000                   // 30%
const INIT_PLATFORM_STAKE_FEE_WITHDRAW = 0                      // 0%

// ── THE FIX: AIDA type name WITHOUT 0x prefix ───────────────
// type_name::into_string(type_name::get<AIDA>()) returns this exact string
const AIDA_TYPE_NAME = 'cee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'

export function buildFixPlatformTokenTx(): Transaction {
  const tx = new Transaction()

  tx.moveCall({
    target: `${PACKAGE_ID}::moonbags::update_config`,
    arguments: [
      tx.object(ADMIN_CAP),                                        // AdminCap
      tx.object(CONFIGURATION),                                    // Configuration
      tx.pure.u64(PLATFORM_FEE),                                   // platform_fee
      tx.pure.u64(INITIAL_VIRTUAL_TOKEN_RESERVES),                 // initial_virtual_token_reserves
      tx.pure.u64(REMAIN_TOKEN_RESERVES),                          // remain_token_reserves
      tx.pure.u8(TOKEN_DECIMALS),                                  // token_decimals
      tx.pure.u16(INIT_PLATFORM_FEE_WITHDRAW),                    // init_platform_fee_withdraw
      tx.pure.u16(INIT_CREATOR_FEE_WITHDRAW),                     // init_creator_fee_withdraw
      tx.pure.u16(INIT_STAKE_FEE_WITHDRAW),                       // init_stake_fee_withdraw
      tx.pure.u16(INIT_PLATFORM_STAKE_FEE_WITHDRAW),              // init_platform_stake_fee_withdraw
      tx.pure.string(AIDA_TYPE_NAME),                              // token_platform_type_name (NO 0x!)
      tx.object(SUI_CLOCK),                                        // Clock
    ],
  })

  return tx
}

// If running directly, print the tx bytes for inspection
if (require.main === module) {
  const tx = buildFixPlatformTokenTx()
  console.log('=== Fix Platform Token Transaction ===')
  console.log('')
  console.log('This transaction calls update_config with:')
  console.log(`  token_platform_type_name: "${AIDA_TYPE_NAME}"`)
  console.log('')
  console.log('All other config values remain unchanged.')
  console.log('')
  console.log('Sign and submit this with the admin wallet:')
  console.log('  0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409')
  console.log('')
  console.log('Transaction object built successfully. Import buildFixPlatformTokenTx()')
  console.log('into your signing environment to execute.')
}
