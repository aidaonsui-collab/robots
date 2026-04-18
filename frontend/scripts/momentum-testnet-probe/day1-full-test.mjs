#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Momentum DEX testnet — full end-to-end graduation test
//
// Does everything in one script:
//   1. Builds + publishes test-coin (PROBE, 6 decimals, 1B supply)
//   2. Creates a Momentum CLMM pool: SUI / PROBE
//   3. Collects fees on the new pool (will be 0, proves the path)
//
// Prereqs:
//   - Sui CLI installed and active env = testnet
//   - Active wallet funded with testnet SUI (sui client faucet)
//   - npm install already run in this directory
//
// Usage:
//   node day1-full-test.mjs
//
// If the test coin is already deployed, skip re-publishing by passing the
// coin type as an argument:
//   node day1-full-test.mjs 0xabc...::probe::PROBE
// ──────────────────────────────────────────────────────────────────────────────

import { MmtSDK } from '@mmt-finance/clmm-sdk'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Config ──────────────────────────────────────────────────────────────────

const NETWORK = 'testnet'
const FEE_RATE = 3000       // 0.3% fee tier
const INIT_PRICE = 1.0      // 1:1 starting price
const USE_MVR = false
const COIN_X = '0x2::sui::SUI'
const DEC_X = 9
const DEC_Y = 6              // PROBE has 6 decimals

// ─── Wallet from Sui CLI keystore ────────────────────────────────────────────

function loadKeypair() {
  const secret = process.env.WALLET_SECRET
  if (secret) {
    try {
      const { secretKey } = decodeSuiPrivateKey(secret)
      return Ed25519Keypair.fromSecretKey(secretKey)
    } catch {
      const bytes = secret.startsWith('0x')
        ? Uint8Array.from(Buffer.from(secret.slice(2), 'hex'))
        : Uint8Array.from(Buffer.from(secret, 'base64'))
      return Ed25519Keypair.fromSecretKey(bytes)
    }
  }

  const suiDir = join(homedir(), '.sui', 'sui_config')
  const clientYaml = readFileSync(join(suiDir, 'client.yaml'), 'utf8')
  const config = parseYaml(clientYaml)
  const activeAddr = config.active_address
  if (!activeAddr) throw new Error('No active_address in client.yaml')

  const keys = JSON.parse(readFileSync(join(suiDir, 'sui.keystore'), 'utf8'))
  for (const b64Key of keys) {
    const raw = Buffer.from(b64Key, 'base64')
    if (raw[0] !== 0x00) continue // Ed25519 only
    const kp = Ed25519Keypair.fromSecretKey(raw.slice(1))
    if (kp.getPublicKey().toSuiAddress() === activeAddr) return kp
  }
  throw new Error(`No Ed25519 key matches active address ${activeAddr}`)
}

const keypair = loadKeypair()
const address = keypair.getPublicKey().toSuiAddress()
const client = new SuiClient({ url: getFullnodeUrl(NETWORK) })
const sdk = MmtSDK.NEW({ network: NETWORK })

console.log('=== Momentum Full End-to-End Test ===')
console.log(`Wallet:   ${address}`)
console.log(`Package:  ${sdk.contractConst.packageId}`)
console.log()

// ─── Balance check ───────────────────────────────────────────────────────────

const bal = BigInt((await client.getBalance({ owner: address })).totalBalance)
console.log(`SUI balance: ${Number(bal) / 1e9} SUI`)
if (bal < 1_000_000_000n) {
  console.error('Need at least 1 SUI. Run: sui client faucet')
  process.exit(1)
}
console.log()

// ─── Step 1: Deploy test coin (or reuse existing) ────────────────────────────

let coinType = process.argv[2] // optional: pass existing coin type as arg

if (!coinType) {
  console.log('=== Step 1: Build + publish test coin ===')

  const coinDir = join(__dirname, 'test-coin')

  // Build
  console.log('  Building Move package...')
  try {
    execSync('sui move build', { cwd: coinDir, stdio: 'pipe' })
    console.log('  Build OK')
  } catch (e) {
    console.error(`  Build failed: ${e.stderr?.toString() || e.message}`)
    process.exit(1)
  }

  // Read compiled modules
  const bytecodeDir = join(coinDir, 'build', 'test_coin', 'bytecode_modules')
  const moduleFiles = readdirSync(bytecodeDir).filter(f => f.endsWith('.mv'))
  const modules = moduleFiles.map(f => readFileSync(join(bytecodeDir, f)))
  console.log(`  Found ${modules.length} compiled module(s): ${moduleFiles.join(', ')}`)

  // Read dependencies from BuildInfo
  // The standard dependency for a simple coin is just the Sui framework packages
  const deps = ['0x1', '0x2'] // Move stdlib + Sui framework

  // Publish
  console.log('  Publishing to testnet...')
  const publishTx = new Transaction()
  publishTx.setSender(address)
  const [upgradeCap] = publishTx.publish({ modules, dependencies: deps })
  publishTx.transferObjects([upgradeCap], publishTx.pure.address(address))

  const pubResult = await client.signAndExecuteTransaction({
    transaction: publishTx,
    signer: keypair,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  })

  console.log(`  TX digest: ${pubResult.digest}`)
  console.log(`  Status:    ${pubResult.effects?.status?.status}`)

  if (pubResult.effects?.status?.status !== 'success') {
    console.error(`  Publish failed: ${JSON.stringify(pubResult.effects?.status)}`)
    process.exit(1)
  }

  // Extract the published package ID
  const pubPkg = pubResult.objectChanges?.find(c => c.type === 'published')
  if (!pubPkg) {
    console.error('  Could not find published package in object changes')
    console.error('  Object changes:', JSON.stringify(pubResult.objectChanges, null, 2))
    process.exit(1)
  }
  const pkgId = pubPkg.packageId
  coinType = `${pkgId}::probe::PROBE`
  console.log(`  Published package: ${pkgId}`)
  console.log(`  Coin type:         ${coinType}`)

  // Find the minted PROBE Coin object
  const probeCoin = pubResult.objectChanges?.find(
    c => c.type === 'created' && c.objectType?.includes('::coin::Coin<') && c.objectType?.includes('::probe::PROBE')
  )
  if (probeCoin) {
    console.log(`  PROBE coin:        ${probeCoin.objectId}`)
  }

  // Find the TreasuryCap
  const treasuryCap = pubResult.objectChanges?.find(
    c => c.type === 'created' && c.objectType?.includes('::coin::TreasuryCap<')
  )
  if (treasuryCap) {
    console.log(`  TreasuryCap:       ${treasuryCap.objectId}`)
  }

  console.log('  ✅ Test coin deployed!')
  console.log()
} else {
  console.log(`=== Step 1: Using existing coin type: ${coinType} ===`)
  console.log()
}

// ─── Step 2: Create Momentum pool (SUI / PROBE) ─────────────────────────────

console.log('=== Step 2: Create CLMM pool (SUI / PROBE) ===')

const createTx = new Transaction()
createTx.setSender(address)

try {
  await sdk.poolModule.createPool(
    createTx, FEE_RATE, INIT_PRICE, COIN_X, coinType, DEC_X, DEC_Y, USE_MVR,
  )

  console.log('  PTB built, submitting...')
  const createResult = await client.signAndExecuteTransaction({
    transaction: createTx,
    signer: keypair,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  })

  console.log(`  TX digest: ${createResult.digest}`)
  console.log(`  Status:    ${createResult.effects?.status?.status}`)

  if (createResult.effects?.status?.status !== 'success') {
    console.error(`  ❌ Pool creation failed: ${JSON.stringify(createResult.effects?.status)}`)

    // Dump all info for debugging
    if (createResult.events?.length) {
      console.log('  Events:')
      for (const ev of createResult.events) {
        console.log(`    ${ev.type}: ${JSON.stringify(ev.parsedJson)}`)
      }
    }
    process.exit(1)
  }

  console.log('  ✅ Pool created!')

  // Extract pool + position objects
  const poolObj = createResult.objectChanges?.find(
    c => c.type === 'created' && c.objectType?.includes('::pool::Pool<')
  )
  const posObj = createResult.objectChanges?.find(
    c => c.type === 'created' && c.objectType?.includes('::position::Position')
  )

  if (poolObj) {
    console.log(`  Pool ID:     ${poolObj.objectId}`)
    console.log(`  Pool type:   ${poolObj.objectType}`)
  }
  if (posObj) {
    console.log(`  Position ID: ${posObj.objectId}`)
  }

  // Dump events
  if (createResult.events?.length) {
    console.log(`  Events (${createResult.events.length}):`)
    for (const ev of createResult.events) {
      console.log(`    ${ev.type}`)
      if (ev.parsedJson) {
        console.log(`    ${JSON.stringify(ev.parsedJson, null, 2).replace(/\n/g, '\n    ')}`)
      }
    }
  }

  // ─── Step 3: Collect fees ──────────────────────────────────────────────
  if (poolObj && posObj) {
    console.log()
    console.log('=== Step 3: Collect fees (will be 0 on fresh pool) ===')

    // Try SDK wrapper first
    let feeCollected = false
    try {
      const collectTx = new Transaction()
      collectTx.setSender(address)
      await sdk.poolModule.collectFee(
        collectTx, poolObj.objectId, posObj.objectId, COIN_X, coinType, USE_MVR,
      )

      console.log('  SDK collectFee PTB built, submitting...')
      const collectResult = await client.signAndExecuteTransaction({
        transaction: collectTx,
        signer: keypair,
        options: { showEffects: true, showEvents: true },
      })

      console.log(`  TX digest: ${collectResult.digest}`)
      console.log(`  Status:    ${collectResult.effects?.status?.status}`)
      feeCollected = collectResult.effects?.status?.status === 'success'
    } catch (e) {
      console.log(`  SDK collectFee failed: ${e.message}`)
    }

    // Fallback: raw moveCall to collect::fee (public entry)
    if (!feeCollected) {
      console.log('  Trying raw moveCall to collect::fee...')
      try {
        const collectTx2 = new Transaction()
        collectTx2.setSender(address)
        collectTx2.moveCall({
          target: `${sdk.contractConst.packageId}::collect::fee`,
          typeArguments: [COIN_X, coinType],
          arguments: [
            collectTx2.object(poolObj.objectId),
            collectTx2.object(posObj.objectId),
            collectTx2.object('0x6'), // Sui system Clock
          ],
        })

        const collectResult2 = await client.signAndExecuteTransaction({
          transaction: collectTx2,
          signer: keypair,
          options: { showEffects: true, showEvents: true },
        })

        console.log(`  TX digest: ${collectResult2.digest}`)
        console.log(`  Status:    ${collectResult2.effects?.status?.status}`)
        feeCollected = collectResult2.effects?.status?.status === 'success'
      } catch (e2) {
        console.log(`  Raw moveCall also failed: ${e2.message}`)
      }
    }

    if (feeCollected) {
      console.log('  ✅ Fee collection succeeded!')
    } else {
      console.log('  ❌ Fee collection failed (both SDK and raw moveCall)')
    }
  }

} catch (e) {
  console.error(`  createPool error: ${e.message}`)
  if (e.cause) console.error(`  cause: ${e.cause}`)
}

// ─── Final summary ───────────────────────────────────────────────────────────
console.log()
console.log('=== RESULTS ===')
console.log(`Coin type: ${coinType}`)
console.log()
console.log('Save the Pool ID and Position ID above — you will need them')
console.log('to test addLiquidity and removeLiquidity in follow-up scripts.')
console.log()
console.log('If all three steps passed, the Momentum CLMM graduation')
console.log('flow is fully validated on testnet. Safe to scope day-1 code.')
console.log()
console.log('=== END ===')
