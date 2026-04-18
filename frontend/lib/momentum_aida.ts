// Momentum CLMM integration — AIDA-paired pool creation
// Adapted from lib/momentum.ts — uses AIDA as coinX instead of SUI

import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const AIDA_TYPE = '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'
const AIDA_DECIMALS = 9
const CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

const MOMENTUM_PACKAGE = process.env.MOMENTUM_PACKAGE_ID || '0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1'
const MMT_VERSION = '0x2375a0b1ec12010aaea3b2545acfa2ad34cfbba03ce4b59f4c39e1e25eed1b2a'
const DEFAULT_FEE_RATE = 3000

function getAdminKeypair(): Ed25519Keypair {
  const secret = process.env.ADMIN_WALLET_SECRET
  if (!secret) throw new Error('ADMIN_WALLET_SECRET env var is required')
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

export interface GraduationEvent {
  tokenType: string
  aidaAmount: bigint
  tokenAmount: bigint
  tokenDecimals: number
  timestamp: number
}

export interface PoolCreationResult {
  success: boolean
  digest?: string
  poolId?: string
  positionId?: string
  error?: string
}

export async function createMomentumPool(event: GraduationEvent): Promise<PoolCreationResult> {
  if (!MOMENTUM_PACKAGE) return { success: false, error: 'MOMENTUM_PACKAGE_ID not configured' }

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  const aidaFloat = Number(event.aidaAmount) / 10 ** AIDA_DECIMALS
  const tokenFloat = Number(event.tokenAmount) / 10 ** event.tokenDecimals
  const price = aidaFloat / tokenFloat

  console.log(`[graduation] Creating AIDA/TOKEN Momentum pool:`)
  console.log(`  token: ${event.tokenType}`)
  console.log(`  AIDA: ${aidaFloat}`)
  console.log(`  tokens: ${tokenFloat}`)
  console.log(`  price: ${price} AIDA per token`)

  try {
    const GAS_BUFFER_MIST = BigInt(300_000_000)
    const [suiBal, aidaBal] = await Promise.all([
      client.getBalance({ owner: adminAddress }),
      client.getBalance({ owner: adminAddress, coinType: AIDA_TYPE }),
    ])
    if (BigInt(suiBal.totalBalance) < GAS_BUFFER_MIST) {
      return { success: false, error: 'Admin needs at least 0.3 SUI for gas' }
    }
    if (BigInt(aidaBal.totalBalance) < event.aidaAmount) {
      return {
        success: false,
        error: `Admin has ${Number(aidaBal.totalBalance) / 1e9} AIDA but needs ${aidaFloat} AIDA`,
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MmtSDK } = require('@mmt-finance/clmm-sdk') as { MmtSDK: any }
    const sdk = MmtSDK.NEW({ network: 'mainnet' })

    const tx1 = new Transaction()
    tx1.setSender(adminAddress)

    sdk.poolModule.createPool(
      tx1,
      DEFAULT_FEE_RATE,
      price,
      AIDA_TYPE,
      event.tokenType,
      AIDA_DECIMALS,
      event.tokenDecimals,
      false,
    )

    const result1 = await client.signAndExecuteTransaction({
      transaction: tx1,
      signer: keypair,
      options: { showEffects: true, showObjectChanges: true },
    })

    if (result1.effects?.status?.status !== 'success') {
      return {
        success: false,
        digest: result1.digest,
        error: `Pool init TX failed: ${JSON.stringify(result1.effects?.status)}`,
      }
    }

    const poolCreated = result1.objectChanges?.find(
      (c: any) => c.type === 'created' && c.objectType?.includes('::pool::Pool<')
    ) as any
    const poolId = poolCreated?.objectId
    if (!poolId) return { success: false, digest: result1.digest, error: 'Could not extract pool ID' }

    console.log(`[graduation] Pool initialized: ${poolId} (${result1.digest})`)
    console.log(`[graduation] Adding liquidity...`)

    await new Promise(r => setTimeout(r, 4000))

    return addLiquidityToPool({
      poolId,
      tokenType: event.tokenType,
      tokenDecimals: event.tokenDecimals,
      aidaAmount: event.aidaAmount,
      price,
      initDigest: result1.digest,
    })
  } catch (e: any) {
    console.error(`[graduation] Pool creation failed: ${e.message}`)
    return { success: false, error: e.message }
  }
}

export async function addLiquidityToPool(opts: {
  poolId: string
  tokenType: string
  tokenDecimals: number
  aidaAmount: bigint
  price: number
  initDigest?: string
}): Promise<PoolCreationResult> {
  const { poolId, tokenType, tokenDecimals, aidaAmount, price } = opts
  if (!MOMENTUM_PACKAGE) return { success: false, error: 'MOMENTUM_PACKAGE_ID not configured' }

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TickMath } = require('@mmt-finance/clmm-sdk') as { TickMath: any }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Decimal = require('decimal.js')

    const MMT_PKG = MOMENTUM_PACKAGE

    const parts = tokenType.split('::')
    if (parts.length >= 3) {
      const addr = parts[0].startsWith('0x') ? parts[0] : `0x${parts[0]}`
      parts[0] = addr.slice(0, 2) + addr.slice(2).padStart(64, '0')
    }
    const normTokenType = parts.join('::')

    const sqrtLower = TickMath.priceToSqrtPriceX64(
      new Decimal(price * 100), AIDA_DECIMALS, tokenDecimals
    ).toString()
    const sqrtUpper = TickMath.priceToSqrtPriceX64(
      new Decimal(price * 0.01), AIDA_DECIMALS, tokenDecimals
    ).toString()

    const aidaCoins = await client.getCoins({ owner: adminAddress, coinType: AIDA_TYPE })
    if (!aidaCoins.data.length) {
      return { success: false, poolId, error: 'Admin has no AIDA coins' }
    }

    const tokenCoins = await client.getCoins({ owner: adminAddress, coinType: tokenType })
    if (!tokenCoins.data.length) {
      return { success: false, poolId, error: `Admin has no ${tokenType} coins` }
    }

    const aidaBal = await client.getBalance({ owner: adminAddress, coinType: AIDA_TYPE })
    const availableAida = BigInt(aidaBal.totalBalance)
    const aidaToAdd = availableAida > aidaAmount ? aidaAmount : availableAida

    console.log(`[graduation] Adding ${Number(aidaToAdd) / 1e9} AIDA to pool ${poolId}`)

    const tx2 = new Transaction()
    tx2.setSender(adminAddress)

    const [lowerTick1] = tx2.moveCall({
      target: `${MMT_PKG}::tick_math::get_tick_at_sqrt_price`,
      arguments: [tx2.pure.u128(BigInt(sqrtLower))],
    })
    const [upperTick1] = tx2.moveCall({
      target: `${MMT_PKG}::tick_math::get_tick_at_sqrt_price`,
      arguments: [tx2.pure.u128(BigInt(sqrtUpper))],
    })
    const [spacingI32] = tx2.moveCall({
      target: `${MMT_PKG}::i32::from_u32`,
      arguments: [tx2.pure.u32(60)],
    })
    const [lMod] = tx2.moveCall({ target: `${MMT_PKG}::i32::mod`, arguments: [lowerTick1, spacingI32] })
    const [uMod] = tx2.moveCall({ target: `${MMT_PKG}::i32::mod`, arguments: [upperTick1, spacingI32] })
    const [alignedLower] = tx2.moveCall({ target: `${MMT_PKG}::i32::sub`, arguments: [lowerTick1, lMod] })
    const [alignedUpper] = tx2.moveCall({ target: `${MMT_PKG}::i32::sub`, arguments: [upperTick1, uMod] })

    const [positionObj] = tx2.moveCall({
      target: `${MMT_PKG}::liquidity::open_position`,
      typeArguments: [AIDA_TYPE, normTokenType],
      arguments: [
        tx2.object(poolId),
        alignedLower,
        alignedUpper,
        tx2.object(MMT_VERSION),
      ],
    })

    const primaryAida = tx2.object(aidaCoins.data[0].coinObjectId)
    if (aidaCoins.data.length > 1) {
      tx2.mergeCoins(primaryAida, aidaCoins.data.slice(1).map((c: any) => tx2.object(c.coinObjectId)))
    }
    const [aidaCoin] = tx2.splitCoins(primaryAida, [tx2.pure.u64(aidaToAdd)])

    const primaryToken = tx2.object(tokenCoins.data[0].coinObjectId)
    if (tokenCoins.data.length > 1) {
      tx2.mergeCoins(primaryToken, tokenCoins.data.slice(1).map((c: any) => tx2.object(c.coinObjectId)))
    }

    const [coinA, coinB] = tx2.moveCall({
      target: `${MMT_PKG}::liquidity::add_liquidity`,
      typeArguments: [AIDA_TYPE, normTokenType],
      arguments: [
        tx2.object(poolId),
        positionObj,
        aidaCoin,
        primaryToken,
        tx2.pure.u64(0),
        tx2.pure.u64(0),
        tx2.object(CLOCK),
        tx2.object(MMT_VERSION),
      ],
    })

    tx2.transferObjects([coinA, coinB, positionObj], tx2.pure.address(adminAddress))

    const result2 = await client.signAndExecuteTransaction({
      transaction: tx2,
      signer: keypair,
      options: { showEffects: true, showObjectChanges: true },
    })

    if (result2.effects?.status?.status !== 'success') {
      return {
        success: false,
        digest: result2.digest,
        poolId,
        error: `Add liquidity TX failed: ${JSON.stringify(result2.effects?.status)}`,
      }
    }

    const posObj = result2.objectChanges?.find(
      (c: any) => c.type === 'created' && c.objectType?.includes('::position::Position')
    ) as any

    console.log(`[graduation] Liquidity added! Pool: ${poolId}, Position: ${posObj?.objectId}`)
    return { success: true, digest: result2.digest, poolId, positionId: posObj?.objectId }
  } catch (e: any) {
    console.error(`[graduation] addLiquidityToPool failed: ${e.message}`)
    return { success: false, poolId, error: e.message }
  }
}

export async function collectMomentumFees(
  poolId: string,
  positionId: string,
  coinYType: string,
): Promise<{ success: boolean; digest?: string; error?: string }> {
  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  try {
    const tx = new Transaction()
    tx.setSender(keypair.getPublicKey().toSuiAddress())
    tx.moveCall({
      target: `${MOMENTUM_PACKAGE}::collect::fee`,
      typeArguments: [AIDA_TYPE, coinYType],
      arguments: [tx.object(poolId), tx.object(positionId), tx.object(CLOCK)],
    })
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true },
    })
    if (result.effects?.status?.status !== 'success') {
      return { success: false, digest: result.digest, error: `TX failed: ${JSON.stringify(result.effects?.status)}` }
    }
    return { success: true, digest: result.digest }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
