// ──────────────────────────────────────────────────────────────────────────────
// Momentum CLMM integration — pool creation service
//
// Creates a CLMM pool on Momentum DEX when a bonding curve token graduates.
// Uses the admin wallet to sign transactions (same wallet that receives
// graduated funds via transfer_pool).
//
// Validated on testnet — see scripts/momentum-testnet-probe/ for the full
// probing history (rounds 1-4b).
// ──────────────────────────────────────────────────────────────────────────────

import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const SUI_TYPE = '0x2::sui::SUI'
const SUI_DECIMALS = 9
const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

// Momentum mainnet constants — confirmed via mainnet-check.mjs
const MOMENTUM_PACKAGE = process.env.MOMENTUM_PACKAGE_ID || '0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1'
const MOMENTUM_GLOBAL_CONFIG = process.env.MOMENTUM_GLOBAL_CONFIG || '0x9889f38f107f5807d34c547828f4a1b4d814450005a4517a58a1ad476458abfc'

// Fee tier: 3000 = 0.3% (standard for most pairs, confirmed working on testnet)
const DEFAULT_FEE_RATE = 3000

/**
 * Load the admin keypair from ADMIN_WALLET_SECRET env var.
 * Supports Sui bech32 (suiprivkey1...), hex, and base64 formats.
 */
function getAdminKeypair(): Ed25519Keypair {
  const secret = process.env.ADMIN_WALLET_SECRET
  if (!secret) {
    throw new Error('ADMIN_WALLET_SECRET env var is required for graduation')
  }

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

/**
 * Represents a graduated token ready for DEX pool creation.
 */
export interface GraduationEvent {
  tokenType: string    // Full Move type: 0xpkg::module::TYPE
  suiAmount: bigint    // SUI amount in MIST (1 SUI = 1e9 MIST)
  tokenAmount: bigint  // Token amount in base units
  tokenDecimals: number
  timestamp: number
}

/**
 * Result of pool creation on Momentum.
 */
export interface PoolCreationResult {
  success: boolean
  digest?: string
  poolId?: string
  positionId?: string
  error?: string
}

/**
 * Create a Momentum CLMM pool for a graduated token and fund it with liquidity.
 *
 * Two-transaction flow:
 *   TX1 — createPool: initializes the pool with the correct price (no liquidity yet).
 *   TX2 — openPosition + addLiquidity: opens a wide-range position and deposits
 *          all the SUI and tokens the admin wallet holds for this token type.
 *
 * Pre-flight balance check prevents TX1 from running when the admin wallet
 * doesn't have enough SUI to fund TX2 — avoids orphaned empty pool objects.
 *
 * Tick spacing 60 is standard for fee_rate=3000 (0.3%) on all CLMM protocols.
 */
export async function createMomentumPool(
  event: GraduationEvent,
): Promise<PoolCreationResult> {
  if (!MOMENTUM_PACKAGE) {
    return { success: false, error: 'MOMENTUM_PACKAGE_ID not configured' }
  }

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  // Initial price: SUI per token (adjusted for decimals)
  const suiFloat = Number(event.suiAmount) / 10 ** SUI_DECIMALS
  const tokenFloat = Number(event.tokenAmount) / 10 ** event.tokenDecimals
  const price = suiFloat / tokenFloat

  console.log(`[graduation] Creating Momentum pool:`)
  console.log(`  token:    ${event.tokenType}`)
  console.log(`  SUI:      ${suiFloat} SUI`)
  console.log(`  tokens:   ${tokenFloat}`)
  console.log(`  price:    ${price} SUI per token`)
  console.log(`  fee tier: ${DEFAULT_FEE_RATE} (0.3%)`)

  try {
    // Pre-flight balance check — need suiAmount + 0.3 SUI for gas on both TXs.
    // If insufficient, abort BEFORE TX1 to avoid creating an empty pool shell.
    const GAS_BUFFER_MIST = BigInt(300_000_000) // 0.3 SUI for TX1 + TX2 gas
    const suiBalance = await client.getBalance({ owner: adminAddress })
    const availableMist = BigInt(suiBalance.totalBalance)
    const minimumRequired = event.suiAmount + GAS_BUFFER_MIST
    if (availableMist < minimumRequired) {
      return {
        success: false,
        error: `Admin wallet has ${Number(availableMist) / 1e9} SUI but needs ${Number(minimumRequired) / 1e9} SUI (pool amount + 0.3 gas) — top up before retrying`,
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MmtSDK, TickMath } = require('@mmt-finance/clmm-sdk') as { MmtSDK: any; TickMath: any }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Decimal = require('decimal.js')

    const sdk = MmtSDK.NEW({ network: 'mainnet' })

    // ── TX 1: Create + initialize pool ──────────────────────────────────────
    const tx1 = new Transaction()
    tx1.setSender(adminAddress)

    sdk.poolModule.createPool(
      tx1,
      DEFAULT_FEE_RATE,
      price,
      SUI_TYPE,
      event.tokenType,
      SUI_DECIMALS,
      event.tokenDecimals,
      false, // useMvr
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
    if (!poolId) {
      return { success: false, digest: result1.digest, error: 'Could not extract pool ID from init TX' }
    }

    console.log(`[graduation] Pool initialized: ${poolId} (${result1.digest})`)
    console.log(`[graduation] Adding liquidity...`)

    // Wait for RPC indexer to register the new pool object before TX 2
    await new Promise(r => setTimeout(r, 4000))

    // ── TX 2: Open position + add liquidity ──────────────────────────────────
    return addLiquidityToPool({
      poolId,
      tokenType: event.tokenType,
      tokenDecimals: event.tokenDecimals,
      suiAmount: event.suiAmount,
      price,
      initDigest: result1.digest,
    })
  } catch (e: any) {
    console.error(`[graduation] Pool creation failed: ${e.message}`)
    return { success: false, error: e.message }
  }
}

/**
 * Find the admin wallet's liquidity position in a specific Momentum pool.
 * Returns null if no position is found.
 */
export async function findAdminPositionInPool(
  poolId: string,
): Promise<{ positionId: string; liquidity: bigint } | null> {
  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  // Position struct type uses the SDK's package ID
  const POSITION_TYPE = `${MOMENTUM_PACKAGE}::position::Position`

  let cursor: string | null | undefined = undefined
  while (true) {
    const objects = await client.getOwnedObjects({
      owner: adminAddress,
      filter: { StructType: POSITION_TYPE },
      options: { showType: true, showContent: true },
      cursor,
    })

    for (const obj of objects.data) {
      if (!obj.data) continue
      const fields = (obj.data as any)?.content?.fields
      if (fields?.pool_id === poolId) {
        return {
          positionId: obj.data.objectId,
          liquidity: BigInt(fields.liquidity || '0'),
        }
      }
    }

    if (!objects.hasNextPage) break
    cursor = objects.nextCursor ?? undefined
  }

  return null
}

/**
 * Close a half-funded (or empty) position in a Momentum pool to recover tokens.
 *
 * Collects fees → removes all liquidity → burns the position NFT.
 * After this the admin wallet has the tokens back and `addLiquidityToPool`
 * can be called again normally.
 */
export async function closePositionAndRecover(
  poolId: string,
  tokenType: string,
): Promise<{ success: boolean; digest?: string; positionId?: string; error?: string }> {
  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  const posInfo = await findAdminPositionInPool(poolId)
  if (!posInfo) {
    return { success: false, error: `No position found for pool ${poolId} owned by admin` }
  }

  const { positionId, liquidity } = posInfo
  console.log(`[fix-pool] Closing position ${positionId} (liquidity=${liquidity}) in pool ${poolId}`)

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MmtSDK } = require('@mmt-finance/clmm-sdk') as { MmtSDK: any }
    const sdk = MmtSDK.NEW({ network: 'mainnet' })

    const pool = {
      objectId: poolId,
      tokenXType: SUI_TYPE,
      tokenYType: tokenType,
      tickSpacing: 60,
    }

    const tx = new Transaction()
    tx.setSender(adminAddress)

    // 1. Collect any accumulated fees first
    sdk.poolModule.collectFee(tx, pool, positionId, adminAddress, false)

    // 2. Remove all liquidity (returns SUI + tokens to admin)
    if (liquidity > 0n) {
      sdk.poolModule.removeLiquidity(tx, pool, positionId, liquidity, 0n, 0n, adminAddress, false)
    }

    // 3. Burn the position NFT
    sdk.positionModule.closePosition(tx, positionId, false)

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showObjectChanges: true },
    })

    if (result.effects?.status?.status !== 'success') {
      return {
        success: false,
        digest: result.digest,
        positionId,
        error: `Close position TX failed: ${JSON.stringify(result.effects?.status)}`,
      }
    }

    console.log(`[fix-pool] Position closed successfully: ${result.digest}`)
    return { success: true, digest: result.digest, positionId }
  } catch (e: any) {
    console.error(`[fix-pool] closePositionAndRecover failed: ${e.message}`)
    return { success: false, positionId, error: e.message }
  }
}

/**
 * Add liquidity to an existing Momentum CLMM pool.
 *
 * Use this to fund an empty pool that was already created (e.g. when
 * createMomentumPool partially succeeded — TX1 ran but TX2 failed).
 *
 * POST /api/admin/add-liquidity calls this directly with a known pool ID.
 */
export async function addLiquidityToPool(opts: {
  poolId: string
  tokenType: string
  tokenDecimals: number
  suiAmount: bigint
  price: number
  initDigest?: string
}): Promise<PoolCreationResult> {
  const { poolId, tokenType, tokenDecimals, suiAmount, price } = opts

  if (!MOMENTUM_PACKAGE) {
    return { success: false, error: 'MOMENTUM_PACKAGE_ID not configured' }
  }

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  try {
    // Only use TickMath as a pure static utility — do NOT call MmtSDK.NEW() here.
    // MmtSDK.NEW() registers an MVR resolver on the Transaction that intercepts
    // all move calls during build() and tries to resolve token type addresses as
    // MVR names, causing "Unbound named address" for custom token packages.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TickMath } = require('@mmt-finance/clmm-sdk') as { TickMath: any }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Decimal = require('decimal.js')

    // Momentum mainnet constants (same as sdk.contractConst — hardcoded to avoid SDK init)
    const MMT_PKG = '0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1'
    const MMT_VERSION = '0x2375a0b1ec12010aaea3b2545acfa2ad34cfbba03ce4b59f4c39e1e25eed1b2a'
    const CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

    // Normalize token type: pad address part to full 32-byte (64 hex char) Sui address.
    // Short addresses without leading zeros are misinterpreted as Move named addresses.
    const parts = tokenType.split('::')
    if (parts.length >= 3) {
      const addr = parts[0].startsWith('0x') ? parts[0] : `0x${parts[0]}`
      parts[0] = `0x${addr.slice(2).padStart(64, '0')}`
    }
    const normTokenType = parts.join('::')

    // Wide price range: 1% to 100x of initial price (in SUI/token = X/Y terms).
    // priceToSqrtPriceX64 converts X/Y price → sqrt(Y/X) Q64.
    // Inverse relationship: higher X/Y price → lower Y/X sqrtPrice.
    //   price * 100  (high SUI/token) → low Y/X sqrtPrice  = sqrtLower
    //   price * 0.01 (low SUI/token)  → high Y/X sqrtPrice = sqrtUpper
    const sqrtLower = TickMath.priceToSqrtPriceX64(
      new Decimal(price * 100), SUI_DECIMALS, tokenDecimals
    ).toString()
    const sqrtUpper = TickMath.priceToSqrtPriceX64(
      new Decimal(price * 0.01), SUI_DECIMALS, tokenDecimals
    ).toString()

    // Fetch admin token coins
    const tokenCoins = await client.getCoins({ owner: adminAddress, coinType: tokenType })
    if (!tokenCoins.data.length) {
      return {
        success: false,
        poolId,
        error: `Admin has no ${tokenType} coins — liquidity cannot be added`,
      }
    }

    // Reserve 0.1 SUI for TX gas; use all remaining up to suiAmount for the pool
    const GAS_RESERVE_MIST = BigInt(100_000_000)
    const balance = await client.getBalance({ owner: adminAddress })
    const availableMist = BigInt(balance.totalBalance)
    const suiToAdd = availableMist > GAS_RESERVE_MIST
      ? (availableMist - GAS_RESERVE_MIST < suiAmount
          ? availableMist - GAS_RESERVE_MIST
          : suiAmount)
      : suiAmount

    console.log(`[graduation] Admin SUI: ${Number(availableMist) / 1e9} — adding ${Number(suiToAdd) / 1e9} SUI to pool ${poolId}`)

    // Build PTB with raw Move calls — no MmtSDK instance, no MVR plugin involved.
    // Replicates sdk.positionModule.openPosition + sdk.poolModule.addLiquidity exactly.
    const tx2 = new Transaction()
    tx2.setSender(adminAddress)

    // Convert sqrt prices to aligned tick indices (mirrors openPosition's internal steps)
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
      arguments: [tx2.pure.u32(60)], // tick spacing 60 = standard for 0.3% fee tier
    })
    const [lMod] = tx2.moveCall({
      target: `${MMT_PKG}::i32::mod`,
      arguments: [lowerTick1, spacingI32],
    })
    const [uMod] = tx2.moveCall({
      target: `${MMT_PKG}::i32::mod`,
      arguments: [upperTick1, spacingI32],
    })
    const [alignedLower] = tx2.moveCall({
      target: `${MMT_PKG}::i32::sub`,
      arguments: [lowerTick1, lMod],
    })
    const [alignedUpper] = tx2.moveCall({
      target: `${MMT_PKG}::i32::sub`,
      arguments: [upperTick1, uMod],
    })

    // Open position — stays in PTB (no immediate transfer)
    const [positionObj] = tx2.moveCall({
      target: `${MMT_PKG}::liquidity::open_position`,
      typeArguments: [SUI_TYPE, normTokenType],
      arguments: [
        tx2.object(poolId),
        alignedLower,
        alignedUpper,
        tx2.object(MMT_VERSION),
      ],
    })

    // SUI: split from gas coin
    const [suiCoin] = tx2.splitCoins(tx2.gas, [tx2.pure.u64(suiToAdd)])

    // Token: merge all UTXOs into one
    const primaryCoin = tx2.object(tokenCoins.data[0].coinObjectId)
    if (tokenCoins.data.length > 1) {
      tx2.mergeCoins(primaryCoin, tokenCoins.data.slice(1).map((c: any) => tx2.object(c.coinObjectId)))
    }

    // Add liquidity — returns leftover coins; position NFT stays in PTB
    const [coinA, coinB] = tx2.moveCall({
      target: `${MMT_PKG}::liquidity::add_liquidity`,
      typeArguments: [SUI_TYPE, normTokenType],
      arguments: [
        tx2.object(poolId),
        positionObj,
        suiCoin,
        primaryCoin,
        tx2.pure.u64(0),    // min_amount_x — no slippage for initial deposit
        tx2.pure.u64(0),    // min_amount_y — no slippage for initial deposit
        tx2.object(CLOCK),
        tx2.object(MMT_VERSION),
      ],
    })

    // Transfer leftover coins + position NFT to admin
    tx2.transferObjects([coinA, coinB, positionObj], tx2.pure.address(adminAddress))

    const result2 = await client.signAndExecuteTransaction({
      transaction: tx2,
      signer: keypair,
      options: { showEffects: true, showEvents: true, showObjectChanges: true },
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

    console.log(`[graduation] Liquidity added!`)
    console.log(`  Pool ID:     ${poolId}`)
    console.log(`  Position ID: ${posObj?.objectId ?? 'unknown'}`)
    console.log(`  TX digest:   ${result2.digest}`)

    return {
      success: true,
      digest: result2.digest,
      poolId,
      positionId: posObj?.objectId,
    }
  } catch (e: any) {
    console.error(`[graduation] addLiquidityToPool failed: ${e.message}`)
    return { success: false, poolId, error: e.message }
  }
}

/**
 * Call withdraw_for_migration on a presale contract.
 * Sends raised SUI (minus 2% fee) + liquidity tokens to the admin wallet
 * and emits PresaleMigratingEvent for the graduation cron to pick up.
 */
export async function callPresaleWithdrawForMigration(
  presaleId: string,
  presalePackageId: string,
  tokenType: string,
): Promise<{ success: boolean; digest?: string; error?: string }> {
  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()

  try {
    const tx = new Transaction()
    tx.setSender(keypair.getPublicKey().toSuiAddress())

    tx.moveCall({
      target: `${presalePackageId}::presale::withdraw_for_migration`,
      typeArguments: [tokenType],
      arguments: [
        tx.object(presaleId),
        tx.object(SUI_CLOCK),
      ],
    })

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showEvents: true },
    })

    if (result.effects?.status?.status !== 'success') {
      return {
        success: false,
        digest: result.digest,
        error: `TX failed: ${JSON.stringify(result.effects?.status)}`,
      }
    }

    console.log(`[graduation] withdraw_for_migration succeeded: ${result.digest}`)
    return { success: true, digest: result.digest }
  } catch (e: any) {
    console.error(`[graduation] withdraw_for_migration failed: ${e.message}`)
    return { success: false, error: e.message }
  }
}

/**
 * Collect accumulated trading fees from a Momentum pool position.
 *
 * collect::fee is a public entry function — can be called directly.
 * Signature: collect::fee<CoinX, CoinY>(&mut Pool, &mut Position, &Clock, ctx)
 */
export async function collectMomentumFees(
  poolId: string,
  positionId: string,
  coinXType: string,
  coinYType: string,
): Promise<{ success: boolean; digest?: string; error?: string }> {
  if (!MOMENTUM_PACKAGE) {
    return { success: false, error: 'MOMENTUM_PACKAGE_ID not configured' }
  }

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()

  try {
    const tx = new Transaction()
    tx.setSender(keypair.getPublicKey().toSuiAddress())

    // collect::fee is a public entry function — raw moveCall works
    tx.moveCall({
      target: `${MOMENTUM_PACKAGE}::collect::fee`,
      typeArguments: [coinXType, coinYType],
      arguments: [
        tx.object(poolId),
        tx.object(positionId),
        tx.object(SUI_CLOCK),
      ],
    })

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showEvents: true },
    })

    if (result.effects?.status?.status !== 'success') {
      return {
        success: false,
        digest: result.digest,
        error: `TX failed: ${JSON.stringify(result.effects?.status)}`,
      }
    }

    console.log(`[fees] Collected fees from pool ${poolId}: ${result.digest}`)
    return { success: true, digest: result.digest }
  } catch (e: any) {
    console.error(`[fees] Fee collection failed: ${e.message}`)
    return { success: false, error: e.message }
  }
}
