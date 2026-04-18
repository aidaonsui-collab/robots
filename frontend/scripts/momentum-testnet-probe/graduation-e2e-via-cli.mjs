#!/usr/bin/env node
// End-to-end graduation test using CLI for pool creation (SDK can't handle dynamic field objects)
import { MmtSDK } from '@mmt-finance/clmm-sdk'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { parse as parseYaml } from 'yaml'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'

const BONDING_PACKAGE = process.env.BONDING_PACKAGE || '0x128576270da5a255bce4183ce43fe8c35cd5cd073b1940d4572c617aceef44af'
const BONDING_CONFIG = process.env.BONDING_CONFIG || '0xcaff2b05ceb1aec6f49db78a64c964ed52dadd2308cf2342148c16c709cbaf04'
const BONDING_STAKE_CFG = process.env.BONDING_STAKE_CFG || '0x4a873f557f40c32196279ced56d15e393de533e0cd103a1295545e5030c3a6ac'
const BONDING_LOCK_CFG = process.env.BONDING_LOCK_CFG || '0x9fa9e4f6c6d74c848fa66997d8272e91eb2e6b72ae41bc35e3f3dd58bf69d88c'
const GRADUATION_THRESHOLD = process.env.GRADUATION_THRESHOLD || '10000000000' // 10 SUI
const NETWORK = 'testnet'

function loadFromSuiCli() {
  const suiDir = join(homedir(), '.sui', 'sui_config')
  const clientYaml = readFileSync(join(suiDir, 'client.yaml'), 'utf8')
  const config = parseYaml(clientYaml)
  const activeAddr = config.active_address
  if (!activeAddr) throw new Error('No active_address in client.yaml')
  const keystoreJson = readFileSync(join(suiDir, 'sui.keystore'), 'utf8')
  const keys = JSON.parse(keystoreJson)
  for (const b64Key of keys) {
    try {
      const buf = Buffer.from(b64Key, 'base64')
      const schema = buf[0]
      const keyBytes = buf.slice(1)
      if (schema === 0x00) {
        const keypair = Ed25519Keypair.fromSecretKey(keyBytes)
        if (keypair.toSuiAddress() === activeAddr) return { keypair, address: activeAddr }
      }
    } catch {}
  }
  throw new Error(`No matching key for ${activeAddr}`)
}

function cliCall(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv }
  const out = execSync(`cd /Users/hectorhernandez/Downloads/theodyssey2/contracts/odyssey-launchpad && /tmp/sui-mac/sui client ${args}`, { env, maxBuffer: 10 * 1024 * 1024 })
  return out.toString()
}

const { keypair, address } = loadFromSuiCli()
const client = new SuiClient({ url: getFullnodeUrl(NETWORK) })

console.log('╔══════════════════════════════════════════════════════════════════╗')
console.log('║  TESTNET E2E: Bonding Curve Graduation → Momentum Pool (CLI)  ║')
console.log('╚══════════════════════════════════════════════════════════════════╝')
console.log(`Wallet:   ${address}`)
console.log(`Threshold: ${Number(GRADUATION_THRESHOLD) / 1e9} SUI\n`)

// Step 1: Check SUI balance
const coins = await client.getCoins({ owner: address, coinType: '0x2::sui::SUI' })
const gas = coins.data[0]
console.log(`SUI balance: ${Number(gas.balance) / 1e9} SUI\n`)

// Step 2: Deploy test PROBE coin
console.log('━━━ Step 1: Deploy PROBE test coin ━━━')
const probeDir = '/Users/hectorhernandez/Downloads/theodyssey2/scripts/momentum-testnet-probe/test-coin'
const buildOut = cliCall('move build', { HOME: process.env.HOME })
console.log('Build: OK')
const pubOut = cliCall(`client publish --gas-budget 500000000 --json`, { HOME: process.env.HOME })
const pubTxMatch = pubOut.match(/Digest: (\S+)/)
const pubDigest = pubTxMatch ? pubTxMatch[1] : ''
console.log(`TX: ${pubDigest}`)

// Extract created objects from publish
const pkgMatch = pubOut.match(/PackageID: (0x[a-f0-9]+)/)
const coinType = pkgMatch ? `${pkgMatch[1]}::probe::PROBE` : ''
console.log(`Coin type: ${coinType}`)

// Re-publish to get the coin created (SDK publish doesn't return objectChanges in same format as CLI)
// Use SDK to publish and extract objects
const { Transaction } = await import('@mysten/sui/transactions')
const { exec } = await import('node:child_process')
const sdkPublishTx = new Transaction()
sdkPublishTx.setSender(address)
const { readFileSync: rf } = await import('node:fs')
const { execSync: ex } = await import('node:child_process')

// Use SDK publish since CLI publish doesn't give us the created object IDs easily
const sdkPubResult = await client.signAndExecuteTransaction({
  transaction: sdkPublishTx,
  signer: keypair,
  options: { showEffects: true, showObjectChanges: true }
})
await client.waitForTransaction({ digest: sdkPubResult.digest })
console.log(`SDK publish TX: ${sdkPubResult.digest}`)
console.log(`SDK publish status: ${sdkPubResult.effects?.status?.status}`)

