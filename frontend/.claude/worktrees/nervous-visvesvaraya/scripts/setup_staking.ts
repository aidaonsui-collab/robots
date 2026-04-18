// Setup script for staking contract
// Run this to initialize the staking pool configuration

import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { JsonRpcProvider } from '@mysten/sui'

// Configuration
const STAKING_PACKAGE = '0x50e60400cc2ea760b5fb8380fa3f1fc0a94dfc592ec78487313d21b50af846da'
const AIDA_TYPE = '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'
const RPC_URL = 'https://fullnode.mainnet.sui.io'

async function main() {
  // You'll need to replace this with your funded wallet private key
  // NEVER commit this to git!
  const PRIVATE_KEY = process.env.PRIVATE_KEY
  
  if (!PRIVATE_KEY) {
    console.log('Error: Set PRIVATE_KEY environment variable')
    console.log('Example: PRIVATE_KEY="<base64_private_key>" node setup_staking.js')
    process.exit(1)
  }

  const provider = new JsonRpcProvider({ url: 'https://fullnode.mainnet.sui.io:443' })
  const keypair = Ed25519Keypair.fromBase64(PRIVATE_KEY)
  const address = keypair.getPublicKey().toSuiAddress()
  
  console.log('Wallet:', address)
  
  // Check if config already exists
  console.log('Checking for existing configuration...')
  try {
    const configObjects = await provider.getOwnedObjects({
      owner: address,
      filter: {
        StructType: `${STAKING_PACKAGE}::moonbags_stake::Configuration`
      },
      limit: 1
    })
    
    if (configObjects.data.length > 0) {
      console.log('Configuration already exists!')
      console.log('Config ID:', configObjects.data[0].data?.objectId)
      return
    }
  } catch (e) {
    console.log('No config found, creating...')
  }
  
  // Create transaction to initialize staking pool
  const tx = new Transaction()
  tx.moveCall({
    target: `${STAKING_PACKAGE}::moonbags_stake::create_configuration`,
    arguments: []
  })
  
  console.log('Signing and executing transaction...')
  
  try {
    const result = await provider.signAndExecuteTransaction({
      transactionBlock: tx,
      signer: keypair,
      options: {
        showEffects: true,
        showObjectChanges: true
      }
    })
    
    console.log('\n=== Transaction successful! ===')
    console.log('Digest:', result.digest)
    
    // Find the Configuration object in the changes
    if (result.objectChanges) {
      const configChange = result.objectChanges.find(
        (c: any) => c.type === 'created' && c.objectType.includes('Configuration')
      )
      
      if (configChange) {
        console.log('\n=== Configuration Object ===')
        console.log('Address:', configChange.objectId)
        console.log('\nUpdate your frontend with:')
        console.log(`STAKING_CONFIG: '${configChange.objectId}'`)
      }
      
      const adminCapChange = result.objectChanges.find(
        (c: any) => c.type === 'created' && c.objectType.includes('AdminCap')
      )
      
      if (adminCapChange) {
        console.log('\n=== Admin Cap (save this!) ===')
        console.log('Address:', adminCapChange.objectId)
      }
    }
    
    console.log('\nStaking pool is now initialized!')
    
  } catch (e) {
    console.error('Transaction failed:', e)
  }
}

main()
