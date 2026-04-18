#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Momentum DEX testnet probe
//
// Goal: answer "is Momentum (MMT) CLMM usable on Sui testnet?" before we scope
// any contract work for bonding-curve graduation. This script does NOT mutate
// chain state, NOT spend gas, and does NOT need a wallet. It only:
//
//   1. Loads @mmt-finance/clmm-sdk and initializes it for testnet
//   2. Auto-detects the testnet package ID + GlobalConfig object ID
//   3. Verifies both exist on Sui testnet via RPC
//   4. Tries common SDK methods to list existing pools / fee tiers
//   5. Prints a PASS/FAIL summary
//
// If any check fails, the script also dumps the raw SDK shape so we can read
// the actual field/method names and adjust.
// ──────────────────────────────────────────────────────────────────────────────

import { MmtSDK } from '@mmt-finance/clmm-sdk'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'

const RESULTS = []
function record(stage, status, detail) {
  RESULTS.push({ stage, status, detail })
  const icon = status === 'PASS' ? 'OK  ' : status === 'FAIL' ? 'FAIL' : 'INFO'
  console.log(`[${icon}] ${stage}: ${detail}`)
}

const client = new SuiClient({ url: getFullnodeUrl('testnet') })

// ─── Step 1: initialize the SDK with testnet ─────────────────────────────────
let sdk
try {
  sdk = MmtSDK.NEW({ network: 'testnet' })
  record('init', 'PASS', `MmtSDK.NEW({ network: 'testnet' }) succeeded`)
} catch (e) {
  record('init', 'FAIL', `threw: ${e.message}`)
  console.log('\n--- module exports ---')
  try {
    const mod = await import('@mmt-finance/clmm-sdk')
    console.log(Object.keys(mod))
  } catch (e2) {
    console.log('module load failed:', e2.message)
  }
  process.exit(1)
}

// ─── Step 2: dump SDK shape so we can find IDs even if our guesses fail ──────
console.log('\n--- SDK top-level keys ---')
console.log(Object.keys(sdk))

console.log('\n--- SDK constructor:', sdk.constructor?.name ?? 'unknown')

// Surface anything that *looks* like config — string fields, IDs, package refs
console.log('\n--- SDK config probe (one level deep) ---')
function probeOneLevel(obj, prefix = '') {
  for (const key of Object.keys(obj)) {
    let val
    try { val = obj[key] } catch { continue }
    if (val == null) continue
    if (typeof val === 'string') {
      console.log(`  ${prefix}${key}: ${val}`)
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      console.log(`  ${prefix}${key}: ${val}`)
    } else if (typeof val === 'object' && !Array.isArray(val) && prefix === '') {
      // recurse one level only
      probeOneLevel(val, `${key}.`)
    }
  }
}
try { probeOneLevel(sdk) } catch (e) { console.log('probe error:', e.message) }

// ─── Step 3: try to extract package ID + GlobalConfig ────────────────────────
function pickAddr(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && /^0x[0-9a-fA-F]+$/.test(c)) return c
  }
  return null
}

const packageId = pickAddr(
  sdk.contractConst?.publishedAt,
  sdk.contractConst?.packageId,
  sdk.contractConst?.package,
  sdk.contract?.packageId,
  sdk.config?.packageId,
  sdk.packageId,
  sdk.PackageId,
)

const globalConfigId = pickAddr(
  sdk.contractConst?.globalConfigId,
  sdk.contractConst?.globalConfig,
  sdk.contractConst?.versioned,
  sdk.config?.globalConfig,
  sdk.config?.globalConfigId,
  sdk.globalConfig,
)

if (packageId)        record('packageId', 'PASS', packageId)
else                  record('packageId', 'FAIL', 'auto-detect failed — see config dump above')

if (globalConfigId)   record('globalConfigId', 'PASS', globalConfigId)
else                  record('globalConfigId', 'FAIL', 'auto-detect failed — see config dump above')

// ─── Step 4: verify those objects actually exist on testnet ──────────────────
async function verifyObject(label, id, opts = {}) {
  if (!id) return
  try {
    const res = await client.getObject({
      id,
      options: { showType: true, ...opts },
    })
    if (res?.data) {
      record(`${label}-onchain`, 'PASS', `exists, type=${res.data.type ?? 'package'}`)
    } else {
      record(`${label}-onchain`, 'FAIL', `not found: ${JSON.stringify(res?.error ?? res)}`)
    }
  } catch (e) {
    record(`${label}-onchain`, 'FAIL', `RPC error: ${e.message}`)
  }
}
await verifyObject('packageId',    packageId)
await verifyObject('globalConfig', globalConfigId, { showContent: true })

// ─── Step 5: try to list existing pools / fee tiers via SDK ──────────────────
console.log('\n--- pool listing probe ---')
const poolMethodCandidates = [
  ['Pool.fetchAllPools',   sdk.Pool?.fetchAllPools?.bind(sdk.Pool)],
  ['Pool.getAllPools',     sdk.Pool?.getAllPools?.bind(sdk.Pool)],
  ['pool.fetchAllPools',   sdk.pool?.fetchAllPools?.bind(sdk.pool)],
  ['pool.getAllPools',     sdk.pool?.getAllPools?.bind(sdk.pool)],
  ['fetchAllPools',        sdk.fetchAllPools?.bind(sdk)],
  ['getAllPools',          sdk.getAllPools?.bind(sdk)],
  ['getPools',             sdk.getPools?.bind(sdk)],
]

let listedPools = false
for (const [name, fn] of poolMethodCandidates) {
  if (typeof fn !== 'function') continue
  try {
    const result = await fn()
    const count = Array.isArray(result) ? result.length : (result?.data?.length ?? '?')
    record(`pools-via-${name}`, 'PASS', `returned ${count}`)
    listedPools = true
    if (Array.isArray(result) && result.length > 0) {
      console.log('  first pool sample:')
      console.log('  ' + JSON.stringify(result[0], null, 2).slice(0, 600).replace(/\n/g, '\n  '))
    }
    break
  } catch (e) {
    record(`pools-via-${name}`, 'FAIL', e.message)
  }
}
if (!listedPools) {
  console.log('  (no pool listing method matched — see SDK method dump below)')
  console.log('\n--- enumerable methods on sdk and sdk.Pool / sdk.pool ---')
  for (const root of ['sdk', 'sdk.Pool', 'sdk.pool', 'sdk.position']) {
    const obj = root === 'sdk' ? sdk : root.split('.').reduce((a, k) => a?.[k], sdk)
    if (!obj) continue
    const methods = []
    let cur = obj
    while (cur && cur !== Object.prototype) {
      for (const k of Object.getOwnPropertyNames(cur)) {
        if (typeof obj[k] === 'function' && k !== 'constructor') methods.push(k)
      }
      cur = Object.getPrototypeOf(cur)
    }
    console.log(`  ${root}:`, [...new Set(methods)].slice(0, 30))
  }
}

// ─── Final verdict ────────────────────────────────────────────────────────────
console.log('\n=== SUMMARY ===')
const passes = RESULTS.filter(r => r.status === 'PASS').length
const fails  = RESULTS.filter(r => r.status === 'FAIL').length
console.log(`${passes} passed, ${fails} failed`)
for (const r of RESULTS) {
  console.log(`  ${r.status === 'PASS' ? '+' : '-'} ${r.stage}`)
}

if (fails === 0) {
  console.log('\nVERDICT: Momentum testnet looks viable. Safe to start the day-1 test plan.')
  process.exit(0)
} else {
  console.log('\nVERDICT: Some checks failed. Read the SDK dump above and report back.')
  process.exit(2)
}
