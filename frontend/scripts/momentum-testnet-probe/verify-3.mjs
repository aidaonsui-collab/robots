#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Momentum DEX testnet probe — round 3
//
// What changed since round 2:
//   1. We now know the createPool signature is POSITIONAL, not object:
//      createPool(txb, fee_rate, price, coinX, coinY, decX, decY, useMvr)
//   2. @mysten/sui bumped to a version that has txb.addSerializationPlugin
//      (required by the SDK's MVR plugin system).
//   3. New fallback: introspect the on-chain Move package directly via
//      sdk.rpcModule.getNormalizedMoveFunction() — works even if the SDK's
//      transaction builder is broken.
//
// Goals (in priority order):
//   A. Confirm pool::create_pool exists in the on-chain testnet package and
//      dump its real Move signature. (RPC-only, can't fail for SDK reasons.)
//   B. Build a createPool tx using the SDK with positional args. Don't submit.
//   C. Same for openPosition, addLiquidity, collectFee — the four primitives
//      we need for the full graduation + fee-collector flow.
// ──────────────────────────────────────────────────────────────────────────────

import { MmtSDK } from '@mmt-finance/clmm-sdk'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'

const client = new SuiClient({ url: getFullnodeUrl('testnet') })
const sdk = MmtSDK.NEW({ network: 'testnet' })

const PKG = sdk.contractConst.packageId
console.log('=== Momentum testnet probe round 3 ===')
console.log('packageId:      ', PKG)
console.log('globalConfigId: ', sdk.contractConst.globalConfigId)
console.log()

// Verify the @mysten/sui version is new enough by checking for the method
// the SDK needs.
const probeTx = new Transaction()
const hasPlugin = typeof probeTx.addSerializationPlugin === 'function'
console.log(`@mysten/sui Transaction.addSerializationPlugin present: ${hasPlugin}`)
if (!hasPlugin) {
  console.log('⚠️  Your installed @mysten/sui is too old. SDK build path will fail.')
  console.log('   Run `npm install @mysten/sui@latest` and re-run this script.')
  console.log('   The Move-introspection step below will still work.')
}
console.log()

// ─── PART A: introspect the on-chain Move package ────────────────────────────
console.log('=== A. On-chain Move signatures (RPC only, SDK-builder-independent) ===')

async function introspectMove(modName, fnName) {
  try {
    const result = await sdk.rpcModule.getNormalizedMoveFunction({
      package: PKG,
      module: modName,
      function: fnName,
    })
    console.log(`\n  ✅ ${modName}::${fnName}`)
    console.log(`     visibility:    ${result.visibility}`)
    console.log(`     isEntry:       ${result.isEntry}`)
    console.log(`     typeParams:    ${JSON.stringify(result.typeParameters)}`)
    console.log(`     parameters:    ${JSON.stringify(result.parameters, null, 2).replace(/\n/g, '\n     ')}`)
    console.log(`     return:        ${JSON.stringify(result.return)}`)
    return result
  } catch (e) {
    console.log(`\n  ❌ ${modName}::${fnName} — ${e.message}`)
    return null
  }
}

// Try the most likely module/function combinations. We don't know the exact
// module name yet, so we list all modules first.
console.log('\nListing all modules in the testnet package...')
let modules = null
try {
  modules = await sdk.rpcModule.getNormalizedMoveModulesByPackage({ package: PKG })
  const modNames = Object.keys(modules)
  console.log(`Found ${modNames.length} modules:`)
  for (const m of modNames) console.log(`  - ${m}`)
} catch (e) {
  console.log(`Failed to list modules: ${e.message}`)
}

// If we have the module list, find functions whose name contains create/open/add/collect
if (modules) {
  console.log('\nFunctions in package matching create_pool / open_position / add_liquidity / collect_fee:')
  for (const [modName, mod] of Object.entries(modules)) {
    const fns = mod.exposedFunctions || mod.exposed_functions || {}
    for (const fnName of Object.keys(fns)) {
      const ln = fnName.toLowerCase()
      if (
        (ln.includes('create') && ln.includes('pool')) ||
        (ln.includes('open')   && ln.includes('position')) ||
        (ln.includes('add')    && ln.includes('liquidity')) ||
        (ln.includes('collect') && ln.includes('fee')) ||
        (ln.includes('remove') && ln.includes('liquidity'))
      ) {
        console.log(`  - ${modName}::${fnName}`)
      }
    }
  }
}

// Now dump the full normalized signature for the canonical 4 we care about
console.log('\n--- Detailed signatures for the four primitives ---')
await introspectMove('pool', 'create_pool')
await introspectMove('position_manager', 'open_position')
await introspectMove('pool', 'add_liquidity')
await introspectMove('pool', 'collect_fee')

// ─── PART B: try the SDK build path with POSITIONAL args ─────────────────────
console.log('\n\n=== B. SDK build path with positional args ===')

if (!hasPlugin) {
  console.log('Skipping — @mysten/sui too old, see warning above.')
} else {
  // createPool(txb, fee_rate, price, coinXType, coinYType, decimalsX, decimalsY, useMvr)
  console.log('\n>>> poolModule.createPool(txb, fee_rate, price, coinX, coinY, decX, decY, useMvr)')

  const tries = [
    {
      label: 'fee=3000 price=1.0 SUI/PROBE 9/6 decimals',
      call: (txb) => sdk.poolModule.createPool(
        txb,
        3000,                    // fee_rate (0.3% in basis points × 10)
        1.0,                     // price (probably token1 per token0)
        '0x2::sui::SUI',
        '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef::probe::PROBE',
        9, 6,
        true,
      ),
    },
    {
      label: 'fee=500  price=1.0 (0.05% tier)',
      call: (txb) => sdk.poolModule.createPool(
        txb,
        500,
        1.0,
        '0x2::sui::SUI',
        '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef::probe::PROBE',
        9, 6,
        true,
      ),
    },
    {
      label: 'fee=3000 price as string "1.0"',
      call: (txb) => sdk.poolModule.createPool(
        txb,
        3000,
        '1.0',
        '0x2::sui::SUI',
        '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef::probe::PROBE',
        9, 6,
        true,
      ),
    },
    {
      label: 'useMvr=false (skip MVR plugin entirely)',
      call: (txb) => sdk.poolModule.createPool(
        txb,
        3000,
        1.0,
        '0x2::sui::SUI',
        '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef::probe::PROBE',
        9, 6,
        false,
      ),
    },
  ]

  let anySuccess = false
  for (const t of tries) {
    const txb = new Transaction()
    process.stdout.write(`  ${t.label}: `)
    try {
      await t.call(txb)
      try {
        const bytes = await txb.build({ client, onlyTransactionKind: true })
        console.log(`OK — built ${bytes.length} bytes`)
        anySuccess = true
      } catch (buildErr) {
        console.log(`call OK, build threw:`)
        console.log(`    ${buildErr.message}`)
      }
    } catch (e) {
      console.log(`call threw:`)
      console.log(`    ${e.message}`)
      if (e.cause) console.log(`    cause: ${e.cause}`)
    }
  }

  console.log()
  if (anySuccess) {
    console.log('✅ At least one createPool variant built successfully.')
  } else {
    console.log('❌ All variants failed. The Move signature dump in part A above')
    console.log('   tells us the exact on-chain function expectations — paste it')
    console.log('   back and I will adjust the SDK call shape in round 4.')
  }
}

console.log('\n=== END ===')
