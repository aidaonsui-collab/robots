#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Momentum DEX testnet probe — round 4
//
// What round 3 told us:
//   - 31 modules live in the testnet package
//   - There is a *dedicated* `create_pool` module (not a function inside `pool`)
//   - There is a *dedicated* `liquidity` module (this is where the public
//     open_position / add_liquidity / remove_liquidity entry points live)
//   - `pool::add_liquidity` and `pool::collect_fee` are friend-visible internals
//     — they exist but you can't call them from a PTB
//   - SDK call `poolModule.createPool(..., useMvr=false)` builds a valid 600B PTB
//
// What we still need before writing day-1 code:
//   A. Full Move signatures for every function in `create_pool`, `liquidity`,
//      and `position` modules — so we know the exact public entry points and
//      what type params + objects + values they want.
//   B. Confirm the SDK exposes call sites for openPosition / addLiquidity /
//      collectFee / closePosition that build into a valid PTB with useMvr=false.
//   C. End-to-end dry-run of the full graduation flow: createPool →
//      openPosition → addLiquidity → collectFee → (closePosition optional),
//      composed into a SINGLE PTB. If that builds we are unblocked.
//
// Still no gas, no wallet, no submission. Pure introspection + tx.build().
// ──────────────────────────────────────────────────────────────────────────────

import { MmtSDK } from '@mmt-finance/clmm-sdk'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'

const client = new SuiClient({ url: getFullnodeUrl('testnet') })
const sdk = MmtSDK.NEW({ network: 'testnet' })

const PKG = sdk.contractConst.packageId
console.log('=== Momentum testnet probe round 4 ===')
console.log('packageId:      ', PKG)
console.log('globalConfigId: ', sdk.contractConst.globalConfigId)
console.log()

const probeTx = new Transaction()
const hasPlugin = typeof probeTx.addSerializationPlugin === 'function'
console.log(`@mysten/sui Transaction.addSerializationPlugin present: ${hasPlugin}`)
if (!hasPlugin) {
  console.log('⚠️  Bump @mysten/sui to >=1.30 — `npm install @mysten/sui@latest`.')
  console.log('   Part A (RPC introspection) will still run; Parts B+C will skip.')
}
console.log()

// ─── PART A: dump every function in create_pool / liquidity / position ───────
console.log('=== A. Full Move signatures for create_pool / liquidity / position ===')

function fmtParam(p, idx) {
  // p can be a primitive string ('U64'), an object ({ Reference: ... } /
  // { Struct: ... } / { TypeParameter: n } / { Vector: ... }), etc.
  // We just JSON-stringify with light prettifying so we see exactly what
  // the chain expects.
  return `      [${idx}] ${JSON.stringify(p)}`
}

async function dumpModuleFns(modName) {
  console.log(`\n--- module: ${modName} ---`)
  let mod
  try {
    mod = await sdk.rpcModule.getNormalizedMoveModule({
      package: PKG,
      module: modName,
    })
  } catch (e) {
    console.log(`  ❌ failed to load module: ${e.message}`)
    return null
  }
  const fns = mod.exposedFunctions || mod.exposed_functions || {}
  const names = Object.keys(fns)
  console.log(`  ${names.length} exposed functions`)
  for (const fnName of names) {
    const fn = fns[fnName]
    const vis    = fn.visibility
    const isEnt  = fn.isEntry ?? fn.is_entry
    const tparam = fn.typeParameters ?? fn.type_parameters ?? []
    const params = fn.parameters ?? []
    const ret    = fn.return ?? []
    console.log(`\n  • ${modName}::${fnName}`)
    console.log(`    visibility:  ${vis}${isEnt ? ' (entry)' : ''}`)
    console.log(`    typeParams:  ${JSON.stringify(tparam)}`)
    console.log(`    params (${params.length}):`)
    params.forEach((p, i) => console.log(fmtParam(p, i)))
    console.log(`    return:      ${JSON.stringify(ret)}`)
  }
  return fns
}

const createPoolFns = await dumpModuleFns('create_pool')
const liquidityFns  = await dumpModuleFns('liquidity')
const positionFns   = await dumpModuleFns('position')

// Filter to the obviously-callable public entry points so we can see them at
// a glance after the noise above.
console.log('\n--- Public + entry summary across the three modules ---')
function summarizePublicEntries(modName, fns) {
  if (!fns) return
  const hits = Object.entries(fns).filter(([_, fn]) => {
    const v = fn.visibility
    const e = fn.isEntry ?? fn.is_entry
    return (v === 'Public' || v === 'public') && e
  })
  if (hits.length === 0) {
    console.log(`  ${modName}: no public+entry functions`)
    return
  }
  for (const [name, fn] of hits) {
    const params = (fn.parameters ?? []).length
    const tparams = (fn.typeParameters ?? fn.type_parameters ?? []).length
    console.log(`  ${modName}::${name}  T<${tparams}>  args=${params}`)
  }
}
summarizePublicEntries('create_pool', createPoolFns)
summarizePublicEntries('liquidity',   liquidityFns)
summarizePublicEntries('position',    positionFns)

// ─── PART B: SDK build dry-runs for the four primitives ──────────────────────
console.log('\n\n=== B. SDK build dry-runs (useMvr=false everywhere) ===')

if (!hasPlugin) {
  console.log('Skipping — @mysten/sui too old.')
  process.exit(0)
}

// Same fake coin pair as round 3 so we don't accidentally collide with any
// real testnet pool. CLMM build path doesn't validate that the type exists
// on-chain unless something explicit asks it to.
const COIN_X = '0x2::sui::SUI'
const COIN_Y = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef::probe::PROBE'
const DEC_X  = 9
const DEC_Y  = 6

// Confirmed working from round 3.
const FEE_RATE = 3000
const PRICE    = 1.0
const USE_MVR  = false

// We don't have a real pool object id (we're not submitting), so where the SDK
// asks for one we feed it the canonical placeholder used in dry-runs. The PTB
// builder accepts any 32-byte hex; the chain would reject it on submit but
// `tx.build({ onlyTransactionKind: true })` doesn't hit the chain.
const FAKE_POOL_ID = '0x0000000000000000000000000000000000000000000000000000000000000abc'
const FAKE_POSITION_ID = '0x0000000000000000000000000000000000000000000000000000000000000def'

// Tick range bracketing the 1:1 price for a tickSpacing=60 pool. These are
// just placeholders — the SDK should accept them and build a PTB.
const TICK_LOWER = -600
const TICK_UPPER = 600

// Liquidity amounts (raw u64, base units)
const AMOUNT_X = 1_000_000_000n // 1 SUI
const AMOUNT_Y = 1_000_000n     // 1 PROBE

async function tryBuild(label, builder) {
  const txb = new Transaction()
  process.stdout.write(`  ${label}: `)
  try {
    await builder(txb)
    try {
      const bytes = await txb.build({ client, onlyTransactionKind: true })
      console.log(`OK — built ${bytes.length} bytes`)
      return { ok: true, bytes: bytes.length }
    } catch (buildErr) {
      console.log(`call OK, build threw:`)
      console.log(`    ${buildErr.message}`)
      return { ok: false, stage: 'build', error: buildErr.message }
    }
  } catch (e) {
    console.log(`call threw:`)
    console.log(`    ${e.message}`)
    if (e.cause) console.log(`    cause: ${e.cause}`)
    return { ok: false, stage: 'call', error: e.message }
  }
}

console.log('\n>>> 1. createPool')
await tryBuild('createPool fee=3000 price=1.0 useMvr=false', (txb) =>
  sdk.poolModule.createPool(
    txb, FEE_RATE, PRICE, COIN_X, COIN_Y, DEC_X, DEC_Y, USE_MVR,
  ),
)

console.log('\n>>> 2. openPosition (try a few likely SDK shapes)')
const openPositionAttempts = [
  {
    label: 'positionModule.openPosition(txb, poolId, lower, upper, useMvr)',
    call: async (txb) => {
      if (typeof sdk.positionModule?.openPosition !== 'function') {
        throw new Error('positionModule.openPosition is not a function')
      }
      return sdk.positionModule.openPosition(txb, FAKE_POOL_ID, TICK_LOWER, TICK_UPPER, USE_MVR)
    },
  },
  {
    label: 'positionModule.openPosition(txb, pool, lower, upper, X, Y, useMvr)',
    call: async (txb) => {
      if (typeof sdk.positionModule?.openPosition !== 'function') {
        throw new Error('positionModule.openPosition is not a function')
      }
      return sdk.positionModule.openPosition(txb, FAKE_POOL_ID, TICK_LOWER, TICK_UPPER, COIN_X, COIN_Y, USE_MVR)
    },
  },
  {
    label: 'poolModule.openPosition(txb, pool, lower, upper, X, Y, useMvr)',
    call: async (txb) => {
      if (typeof sdk.poolModule?.openPosition !== 'function') {
        throw new Error('poolModule.openPosition is not a function')
      }
      return sdk.poolModule.openPosition(txb, FAKE_POOL_ID, TICK_LOWER, TICK_UPPER, COIN_X, COIN_Y, USE_MVR)
    },
  },
]
for (const a of openPositionAttempts) {
  await tryBuild(a.label, a.call)
}

console.log('\n>>> 3. addLiquidity (try a few likely SDK shapes)')
const addLiquidityAttempts = [
  {
    label: 'poolModule.addLiquidity(txb, pool, position, X, Y, amtX, amtY, useMvr)',
    call: async (txb) => {
      if (typeof sdk.poolModule?.addLiquidity !== 'function') {
        throw new Error('poolModule.addLiquidity is not a function')
      }
      return sdk.poolModule.addLiquidity(
        txb, FAKE_POOL_ID, FAKE_POSITION_ID, COIN_X, COIN_Y, AMOUNT_X, AMOUNT_Y, USE_MVR,
      )
    },
  },
  {
    label: 'poolModule.addLiquiditySingleSided(txb, pool, position, X, Y, amount, side, useMvr)',
    call: async (txb) => {
      if (typeof sdk.poolModule?.addLiquiditySingleSided !== 'function') {
        throw new Error('poolModule.addLiquiditySingleSided is not a function')
      }
      return sdk.poolModule.addLiquiditySingleSided(
        txb, FAKE_POOL_ID, FAKE_POSITION_ID, COIN_X, COIN_Y, AMOUNT_X, true, USE_MVR,
      )
    },
  },
  {
    label: 'positionModule.addLiquidity(txb, pool, position, X, Y, amtX, amtY, useMvr)',
    call: async (txb) => {
      if (typeof sdk.positionModule?.addLiquidity !== 'function') {
        throw new Error('positionModule.addLiquidity is not a function')
      }
      return sdk.positionModule.addLiquidity(
        txb, FAKE_POOL_ID, FAKE_POSITION_ID, COIN_X, COIN_Y, AMOUNT_X, AMOUNT_Y, USE_MVR,
      )
    },
  },
]
for (const a of addLiquidityAttempts) {
  await tryBuild(a.label, a.call)
}

console.log('\n>>> 4. collectFee (try a few likely SDK shapes)')
const collectFeeAttempts = [
  {
    label: 'poolModule.collectFee(txb, pool, position, X, Y, useMvr)',
    call: async (txb) => {
      if (typeof sdk.poolModule?.collectFee !== 'function') {
        throw new Error('poolModule.collectFee is not a function')
      }
      return sdk.poolModule.collectFee(txb, FAKE_POOL_ID, FAKE_POSITION_ID, COIN_X, COIN_Y, USE_MVR)
    },
  },
  {
    label: 'positionModule.collectFee(txb, pool, position, X, Y, useMvr)',
    call: async (txb) => {
      if (typeof sdk.positionModule?.collectFee !== 'function') {
        throw new Error('positionModule.collectFee is not a function')
      }
      return sdk.positionModule.collectFee(txb, FAKE_POOL_ID, FAKE_POSITION_ID, COIN_X, COIN_Y, USE_MVR)
    },
  },
]
for (const a of collectFeeAttempts) {
  await tryBuild(a.label, a.call)
}

// ─── PART C: full graduation flow composed into ONE PTB ──────────────────────
console.log('\n\n=== C. Composed PTB: createPool → openPosition → addLiquidity ===')
console.log('(Single PTB dry-run. If this builds we have everything we need.)')

const composedTx = new Transaction()
let composedOk = false
try {
  // Step 1: create the pool. This returns either a Pool argument or void
  // depending on the SDK version. We don't need to capture it for the dry-run
  // because openPosition/addLiquidity take a pool *id*, not a pool argument.
  await sdk.poolModule.createPool(
    composedTx, FEE_RATE, PRICE, COIN_X, COIN_Y, DEC_X, DEC_Y, USE_MVR,
  )

  // Step 2: open a position on the (about-to-exist) pool. We can't reference
  // the new pool by id from inside the same PTB without a transaction result,
  // so this composed flow is mostly to validate that the SDK can chain calls
  // without exploding internally. On real submission you'd split into two PTBs
  // or capture the pool object via tx.moveCall() result handling.
  if (typeof sdk.positionModule?.openPosition === 'function') {
    try {
      await sdk.positionModule.openPosition(composedTx, FAKE_POOL_ID, TICK_LOWER, TICK_UPPER, USE_MVR)
    } catch (e) {
      console.log(`  positionModule.openPosition skipped: ${e.message}`)
    }
  }

  // Step 3: add liquidity to the position
  if (typeof sdk.poolModule?.addLiquidity === 'function') {
    try {
      await sdk.poolModule.addLiquidity(
        composedTx, FAKE_POOL_ID, FAKE_POSITION_ID, COIN_X, COIN_Y, AMOUNT_X, AMOUNT_Y, USE_MVR,
      )
    } catch (e) {
      console.log(`  poolModule.addLiquidity skipped: ${e.message}`)
    }
  }

  const bytes = await composedTx.build({ client, onlyTransactionKind: true })
  console.log(`\n  ✅ composed PTB built — ${bytes.length} bytes`)
  composedOk = true
} catch (e) {
  console.log(`\n  ❌ composed PTB failed: ${e.message}`)
  if (e.cause) console.log(`     cause: ${e.cause}`)
}

console.log('\n=== SUMMARY ===')
console.log(`createPool dry-run:  ${'(see Part B above)'}`)
console.log(`composed flow:       ${composedOk ? '✅ built' : '❌ failed'}`)
console.log()
console.log('If Part A printed full signatures for create_pool / liquidity /')
console.log('position, paste them back. That + the Part B/C build results are')
console.log('the complete API surface needed to write day-1 code with no guessing.')
console.log()
console.log('=== END ===')
