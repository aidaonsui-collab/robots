#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Momentum DEX testnet probe — round 4b
//
// Quick targeted dump of the two remaining modules we haven't inspected:
//   - `collect` — likely the public wrapper around pool::collect_fee
//   - `admin`   — has collect_protocol_fee (confirmed public entry)
//   - `trade`   — might have swap functions relevant to understanding the
//                 fee collection flow
//
// We just need to see the public entry points for fee harvesting.
// No gas, no wallet, no submission.
// ──────────────────────────────────────────────────────────────────────────────

import { MmtSDK } from '@mmt-finance/clmm-sdk'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'

const client = new SuiClient({ url: getFullnodeUrl('testnet') })
const sdk = MmtSDK.NEW({ network: 'testnet' })

const PKG = sdk.contractConst.packageId
console.log('=== Momentum testnet probe round 4b — collect / admin / trade ===')
console.log('packageId:', PKG)
console.log()

function fmtParam(p, idx) {
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

// The three modules we haven't inspected yet
await dumpModuleFns('collect')
await dumpModuleFns('admin')
await dumpModuleFns('trade')

// Also dump app module — some SDKs put top-level entry points here
await dumpModuleFns('app')

// Summary: which functions across ALL four are public + entry?
console.log('\n\n--- Public + entry summary ---')
for (const modName of ['collect', 'admin', 'trade', 'app']) {
  let mod
  try {
    mod = await sdk.rpcModule.getNormalizedMoveModule({
      package: PKG,
      module: modName,
    })
  } catch { continue }
  const fns = mod.exposedFunctions || mod.exposed_functions || {}
  const hits = Object.entries(fns).filter(([_, fn]) => {
    const v = fn.visibility
    const e = fn.isEntry ?? fn.is_entry
    return v === 'Public' || e
  })
  for (const [name, fn] of hits) {
    const vis = fn.visibility
    const isEnt = fn.isEntry ?? fn.is_entry
    const params = (fn.parameters ?? []).length
    const tparams = (fn.typeParameters ?? fn.type_parameters ?? []).length
    console.log(`  ${modName}::${name}  vis=${vis}${isEnt ? ' entry' : ''}  T<${tparams}>  args=${params}`)
  }
}

console.log('\n=== END ===')
