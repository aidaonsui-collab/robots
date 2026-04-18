#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Momentum DEX testnet probe — round 2: SDK introspection + create_pool
// transaction build dry-run.
//
// Goal: discover the exact method name + arg shape for creating a CLMM pool
// on Momentum testnet, and confirm the SDK can build (NOT submit) such a
// transaction against the live testnet package.
//
// This script does NOT spend gas, does NOT need a wallet, and does NOT submit
// anything. It only builds transactions in memory and serializes them to BCS,
// which forces the SDK to resolve Move signatures from the on-chain package.
// ──────────────────────────────────────────────────────────────────────────────

import { MmtSDK } from '@mmt-finance/clmm-sdk'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'

const client = new SuiClient({ url: getFullnodeUrl('testnet') })
const sdk = MmtSDK.NEW({ network: 'testnet' })

console.log('=== SDK initialized for testnet ===')
console.log('packageId:      ', sdk.contractConst.packageId)
console.log('globalConfigId: ', sdk.contractConst.globalConfigId)
console.log('versionId:      ', sdk.contractConst.versionId)
console.log()

// ─── Deep introspection: walk prototype chain on every module ────────────────
function introspect(label, obj) {
  if (!obj) {
    console.log(`--- ${label}: not present ---\n`)
    return []
  }
  const methods = []
  const seen = new Set()
  let cur = obj
  while (cur && cur !== Object.prototype && cur !== Object) {
    for (const k of Object.getOwnPropertyNames(cur)) {
      if (k === 'constructor' || seen.has(k)) continue
      seen.add(k)
      let val
      try { val = obj[k] } catch { continue }
      if (typeof val === 'function') {
        const firstLine = val.toString().split('\n')[0].slice(0, 240)
        methods.push({ name: k, arity: val.length, sig: firstLine })
      }
    }
    cur = Object.getPrototypeOf(cur)
  }
  console.log(`--- ${label} methods (${methods.length}) ---`)
  for (const m of methods) {
    console.log(`  ${m.name}(${m.arity})`)
    console.log(`    ${m.sig}`)
  }
  console.log()
  return methods
}

const poolMethods       = introspect('sdk.poolModule',       sdk.poolModule)
const positionMethods   = introspect('sdk.positionModule',   sdk.positionModule)
const rpcMethods        = introspect('sdk.rpcModule',        sdk.rpcModule)
const routeMethods      = introspect('sdk.routeModule',      sdk.routeModule)
const aggregatorMethods = introspect('sdk.aggregatorModule', sdk.aggregatorModule)

// ─── Hunt for create_pool entry points ───────────────────────────────────────
console.log('=== Hunting for create_pool entry points ===')
function isCreatePoolish(name) {
  const n = name.toLowerCase()
  return (
    (n.includes('create') && n.includes('pool')) ||
    (n.includes('new')    && n.includes('pool')) ||
    n === 'create' || n === 'createpool' || n === 'newpool'
  )
}

const candidates = []
for (const m of poolMethods) {
  if (isCreatePoolish(m.name)) candidates.push({ where: 'poolModule', ...m })
}
for (const m of positionMethods) {
  if (isCreatePoolish(m.name)) candidates.push({ where: 'positionModule', ...m })
}

if (candidates.length === 0) {
  console.log('  No method matched. Showing every method whose name contains "pool" or "create":')
  const all = [
    ...poolMethods.map(m => ({ where: 'poolModule', ...m })),
    ...positionMethods.map(m => ({ where: 'positionModule', ...m })),
  ]
  for (const m of all) {
    const n = m.name.toLowerCase()
    if (n.includes('pool') || n.includes('create') || n.includes('new')) {
      console.log(`  ${m.where}.${m.name}(${m.arity})`)
    }
  }
} else {
  for (const c of candidates) {
    console.log(`  candidate: ${c.where}.${c.name}(${c.arity})`)
    console.log(`    ${c.sig}`)
  }
}
console.log()

// ─── Attempt a build for each candidate ──────────────────────────────────────
console.log('=== Attempting create_pool tx build (DRY RUN — nothing submitted) ===')

// CLMMs need two distinct coin types. SUI on one side, a placeholder
// nonexistent type on the other. If the SDK validates the type against
// on-chain metadata before building, it will throw with a clear error
// telling us what it expected — that's still useful signal.
const COIN_SUI  = '0x2::sui::SUI'
const COIN_FAKE = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef::probe::PROBE'

// 1:1 sqrt price in Q64.96 format (Uniswap v3 / CLMM standard)
const SQRT_PRICE_1_1 = '79228162514264337593543950336'

// Common arg shapes seen across Sui CLMM SDKs
const argShapes = [
  {
    label: 'A',
    description: 'flat object: coinTypeA/B + tickSpacing + fee + currentSqrtPrice',
    args: {
      coinTypeA: COIN_SUI,
      coinTypeB: COIN_FAKE,
      tickSpacing: 60,
      fee: 3000,
      currentSqrtPrice: SQRT_PRICE_1_1,
    },
  },
  {
    label: 'B',
    description: 'flat object: coin_type_a/b snake_case',
    args: {
      coin_type_a: COIN_SUI,
      coin_type_b: COIN_FAKE,
      tick_spacing: 60,
      fee_rate: 3000,
      init_sqrt_price: SQRT_PRICE_1_1,
    },
  },
  {
    label: 'C',
    description: 'flat object: feeRate + initSqrtPrice variant',
    args: {
      coinTypeA: COIN_SUI,
      coinTypeB: COIN_FAKE,
      tickSpacing: 60,
      feeRate: 3000,
      initSqrtPrice: SQRT_PRICE_1_1,
    },
  },
  {
    label: 'D',
    description: 'just type pair + fee tier (let SDK pick the rest)',
    args: {
      coinTypeA: COIN_SUI,
      coinTypeB: COIN_FAKE,
      fee: 3000,
    },
  },
]

let anySuccess = false
for (const c of candidates) {
  const fn = sdk[c.where]?.[c.name]
  if (typeof fn !== 'function') {
    console.log(`SKIP ${c.where}.${c.name} (not a function on instance)`)
    continue
  }

  console.log(`\n>>> ${c.where}.${c.name}(${c.arity})`)
  for (const shape of argShapes) {
    const tx = new Transaction()
    process.stdout.write(`  shape ${shape.label} (${shape.description}): `)
    try {
      const result = await fn.call(sdk[c.where], { ...shape.args, tx, txb: tx })
      // Some SDKs return the tx, some return the original tx, some return a result object
      const finalTx = result instanceof Transaction ? result : tx

      // Try to serialize. onlyTransactionKind avoids needing a sender/gas object.
      try {
        const bytes = await finalTx.build({ client, onlyTransactionKind: true })
        console.log(`OK — built ${bytes.length} bytes`)
        anySuccess = true
        break
      } catch (buildErr) {
        // Build failure is still informative — the SDK call accepted args but
        // the resulting PTB couldn't serialize
        console.log(`call OK, build threw:`)
        console.log(`    ${buildErr.message}`)
      }
    } catch (e) {
      // Print the FULL error, no truncation. This is what we missed in probe 1.
      console.log(`threw:`)
      console.log(`    ${e.message}`)
      if (e.cause) console.log(`    cause: ${e.cause}`)
    }
  }
}

console.log()
console.log('=== SUMMARY ===')
if (candidates.length === 0) {
  console.log('No create_pool candidate methods found. Read the method dumps above')
  console.log('and tell me which one looks right — I will hardcode it for round 3.')
  process.exit(2)
}
if (anySuccess) {
  console.log('SUCCESS — at least one shape built a valid create_pool transaction.')
  console.log('Momentum testnet integration is viable. Safe to start day-1 plan.')
  process.exit(0)
} else {
  console.log('No shape built cleanly. Read the error messages above — they will')
  console.log('tell us exactly what arg names/types the SDK expects. Paste the')
  console.log('full output back and I will write round 3 with the right shape.')
  process.exit(2)
}
