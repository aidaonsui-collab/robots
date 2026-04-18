#!/usr/bin/env node
// Quick check: does Momentum SDK work against mainnet?
// Prints the package ID, GlobalConfig, and tries a dry-run createPool.

import { MmtSDK } from '@mmt-finance/clmm-sdk'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'

console.log('=== Momentum Mainnet Check ===\n')

let sdk
try {
  sdk = MmtSDK.NEW({ network: 'mainnet' })
} catch (e) {
  console.error('SDK init failed:', e.message)
  console.log('\nIf "mainnet" is not supported, the SDK may only have testnet.')
  process.exit(1)
}

console.log('Package ID:     ', sdk.contractConst.packageId)
console.log('GlobalConfig:   ', sdk.contractConst.globalConfigId)
console.log('Version:        ', sdk.contractConst.versionId ?? 'n/a')
console.log()

// Verify package exists on mainnet
const client = new SuiClient({ url: getFullnodeUrl('mainnet') })
try {
  const obj = await client.getObject({ id: sdk.contractConst.packageId, options: { showType: true } })
  if (obj?.data) {
    console.log('Package exists on mainnet: YES')
    console.log('  type:', obj.data.type ?? 'package')
  } else {
    console.log('Package exists on mainnet: NO')
    console.log('  response:', JSON.stringify(obj?.error))
  }
} catch (e) {
  console.log('RPC error checking package:', e.message)
}

// Verify GlobalConfig exists
try {
  const obj = await client.getObject({ id: sdk.contractConst.globalConfigId, options: { showType: true, showContent: true } })
  if (obj?.data) {
    console.log('GlobalConfig exists on mainnet: YES')
    console.log('  type:', obj.data.type)
  } else {
    console.log('GlobalConfig exists on mainnet: NO')
  }
} catch (e) {
  console.log('RPC error checking GlobalConfig:', e.message)
}

// List modules (same as testnet probe)
console.log('\nListing modules in mainnet package...')
try {
  const modules = await client.getNormalizedMoveModulesByPackage({ package: sdk.contractConst.packageId })
  const modNames = Object.keys(modules)
  console.log(`Found ${modNames.length} modules`)

  // Check for the key modules we need
  const needed = ['create_pool', 'liquidity', 'position', 'pool', 'collect']
  for (const m of needed) {
    console.log(`  ${m}: ${modNames.includes(m) ? 'YES' : 'MISSING'}`)
  }
} catch (e) {
  console.log('Module listing failed:', e.message)
}

// Dry-run createPool
console.log('\nDry-run createPool (SUI/fake pair)...')
const tx = new Transaction()
try {
  await sdk.poolModule.createPool(
    tx,
    3000,  // 0.3% fee
    1.0,   // price
    '0x2::sui::SUI',
    '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef::probe::PROBE',
    9, 6,
    false, // useMvr
  )
  const bytes = await tx.build({ client, onlyTransactionKind: true })
  console.log(`createPool dry-run: OK (${bytes.length} bytes)`)
} catch (e) {
  console.log(`createPool dry-run: ${e.message}`)
}

console.log('\n=== Values to set in Vercel env vars ===')
console.log(`MOMENTUM_PACKAGE_ID=${sdk.contractConst.packageId}`)
console.log(`MOMENTUM_GLOBAL_CONFIG=${sdk.contractConst.globalConfigId}`)
console.log('\n=== END ===')
