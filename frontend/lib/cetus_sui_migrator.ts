// ──────────────────────────────────────────────────────────────────────────────
// Cetus CLMM integration for legacy SUI-pair bonding pools
//
// Legacy moonbags SUI packages (V11, V12_PREV, V12_CURRENT etc.) end
// graduation by dumping `real_sui_reserves` + `real_token_reserves` +
// `remain_token_reserves` to the admin wallet and emitting
// PoolMigratingEvent — no on-chain DEX routing. Historically the
// `createMomentumPool` function in `lib/momentum.ts` handled the
// post-graduation deposit for SUI pairs manually.
//
// This module swaps Momentum → Cetus for legacy SUI graduations, so the
// whole platform routes to Cetus regardless of pair side:
//
//   • V13/V14 SUI pairs auto-migrate inline via buy → transfer_pool → init_cetus_pool
//   • V1/V2/V5 AIDA pairs auto-migrate via the /api/cron/cetus-migrate-aida cron
//   • Legacy V11/V12 SUI pairs auto-migrate via this module + /api/cron/cetus-migrate-sui
//
// The actual Move target is `cetus_clmm::pool_creator::create_pool_v2<Token, SUI>`
// followed by `lp_burn::burn_lp_v2` to lock liquidity. No moonbags entry
// is involved on the SUI legacy side (legacy moonbags doesn't expose a
// PTB-callable Cetus init), so this builds the PTB from Cetus primitives.
// ──────────────────────────────────────────────────────────────────────────────

import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { CETUS_CONTRACT, SUI_METADATA_ID } from './contracts'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const SUI_TYPE = '0x2::sui::SUI'
const SUI_DECIMALS = 9
const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

// Cetus CLMM package — reached via `pool_creator` + `pool` + `factory` modules.
// Published-at address (upgraded chain). Types resolve via original-id.
const CETUS_CLMM_PKG = '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb'
// lp_burn package — same upgrade pattern, one module (`lp_burn`).
const LP_BURN_PKG = '0x12d73de9a6bc3cb658ec9dc0fe7de2662be1cea5c76c092fcc3606048cdbac27'

// 1% fee tier = tick_spacing 200, full-range ticks [-443600, 443600].
// Matches both the AIDA V5 `init_cetus_aida_pool_v2` and the V13/V14 SUI
// inline path so every Cetus pool created through our platform shares
// the same curve parameters.
const CETUS_TICK_SPACING = 200
const CETUS_TICK_LOWER_U32 = 4294523696 // i32::-443600 as u32
const CETUS_TICK_UPPER_U32 = 443600

export interface SuiGraduationEvent {
  tokenType: string        // fully-qualified Move type `0xpkg::module::TYPE`
  suiAmount: bigint        // SUI dumped to admin (MIST, 9d)
  tokenAmount: bigint      // Token dumped to admin (base units)
  tokenDecimals: number
  timestamp: number
}

export interface CetusPoolCreationResult {
  success: boolean
  digest?: string
  cetusPoolId?: string
  burnProofId?: string
  error?: string
}

function getAdminKeypair(): Ed25519Keypair {
  const secret = process.env.ADMIN_WALLET_SECRET
  if (!secret) throw new Error('ADMIN_WALLET_SECRET env var is required for SUI→Cetus migration')
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

async function rpc<T = any>(method: string, params: any[]): Promise<T> {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const j = await res.json()
  if (j.error) throw new Error(`${method}: ${j.error.message}`)
  return j.result
}

/**
 * Compute the Q64.64 sqrt_price Cetus expects given the dumped amounts.
 * Matches the same math `moonbags_aida::init_cetus_aida_pool_inner` does
 * on-chain for AIDA pairs: sqrt((2^128 * sui_amount) / token_amount).
 *
 * Uses JS BigInt + Newton's method; the contract's on-chain sqrt is a
 * u256 Newton's method helper. Close enough for initial price; Cetus
 * accepts any sqrt_price within its tick bounds.
 */
function sqrtU128FromAmounts(suiAmount: bigint, tokenAmount: bigint): bigint {
  if (tokenAmount === 0n) throw new Error('tokenAmount is zero — cannot compute initial sqrt price')
  const TWO_POW_128 = 1n << 128n
  const numerator = TWO_POW_128 * suiAmount
  const value = numerator / tokenAmount
  // Integer sqrt via Newton's method
  if (value === 0n) return 0n
  let x = value
  let y = (value + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + value / x) / 2n
  }
  return x
}

/**
 * Find an admin-owned `Coin<T>` with balance >= `minAmount`. Returns the
 * smallest qualifying coin so we don't over-touch the wallet. Null if
 * nothing fits.
 */
async function findAdminCoin(
  client: SuiClient,
  owner: string,
  coinType: string,
  minAmount: bigint,
): Promise<{ id: string; balance: bigint } | null> {
  const { data } = await client.getCoins({ owner, coinType, limit: 200 })
  const candidates = data
    .map(c => ({ id: c.coinObjectId, balance: BigInt(c.balance) }))
    .filter(c => c.balance >= minAmount)
    .sort((a, b) => (a.balance < b.balance ? -1 : a.balance > b.balance ? 1 : 0))
  return candidates[0] ?? null
}

/**
 * Fetch the CoinMetadata object ID for a token type (required by Cetus
 * for ticker + decimals).
 */
async function fetchTokenMetadataId(tokenType: string): Promise<string> {
  const meta = await rpc<any>('suix_getCoinMetadata', [tokenType])
  if (!meta?.id) throw new Error(`CoinMetadata not found for ${tokenType}`)
  return meta.id
}

/**
 * Create a Cetus CLMM pool (Coin<Token, SUI>) and immediately burn the
 * returned LP position via `lp_burn::burn_lp_v2`. Funds used are the
 * admin wallet's dumped Coin<SUI> + Coin<Token> from graduation; the
 * function splits exact `suiAmount` / `tokenAmount` slices so the rest
 * of the wallet stays untouched.
 *
 * This is the SUI-pair twin of `init_cetus_aida_pool_v2` on V5 AIDA —
 * same Cetus calls, same tick spacing (200), same full-range ticks, same
 * LP-burn flow. The only difference is that it's built entirely in a
 * client-side PTB because legacy SUI moonbags doesn't expose a
 * PTB-callable Cetus init entry.
 */
export async function createCetusPoolForLegacySui(
  event: SuiGraduationEvent,
): Promise<CetusPoolCreationResult> {
  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const admin = keypair.getPublicKey().toSuiAddress()

  const { tokenType, suiAmount, tokenAmount } = event

  // Sanity — a zero-balance coin would cause division-by-zero inside the
  // sqrt price math (same class of bug that bit PEPEG's first attempt).
  if (suiAmount <= 0n || tokenAmount <= 0n) {
    return { success: false, error: `invalid amounts: sui=${suiAmount}, token=${tokenAmount}` }
  }

  // Pre-flight: ensure enough SUI for tx gas (~0.3 SUI) on top of the
  // pool-side suiAmount. Without this, TX1 can consume the SUI and
  // later steps run out of gas mid-PTB.
  const GAS_BUFFER_MIST = 300_000_000n
  const balance = await client.getBalance({ owner: admin })
  const available = BigInt(balance.totalBalance)
  if (available < suiAmount + GAS_BUFFER_MIST) {
    return {
      success: false,
      error: `admin has ${Number(available) / 1e9} SUI, need ≥ ${Number(suiAmount + GAS_BUFFER_MIST) / 1e9} (pool + 0.3 gas)`,
    }
  }

  // Admin wallet coin selection.
  const tokenCoin = await findAdminCoin(client, admin, tokenType, tokenAmount)
  if (!tokenCoin) {
    return { success: false, error: `no admin Coin<${tokenType}> with balance ≥ ${tokenAmount}` }
  }

  // Cetus needs CoinMetadata for both sides. SUI metadata is a known
  // mainnet singleton; token metadata we look up by type.
  let tokenMetaId: string
  try {
    tokenMetaId = await fetchTokenMetadataId(tokenType)
  } catch (e: any) {
    return { success: false, error: `CoinMetadata lookup failed: ${e.message}` }
  }

  // Cetus expects sqrt_price in CoinA/CoinB terms. Our generic call is
  // `create_pool_v2<Token, SUI>` (Token=A, SUI=B) so sqrt_price = sqrt(SUI/Token).
  const sqrtPrice = sqrtU128FromAmounts(suiAmount, tokenAmount)

  const tx = new Transaction()
  tx.setSender(admin)
  tx.setGasBudget(500_000_000)

  // Split exact-amount slices. SUI from gas (standard pattern); token
  // from the admin's existing coin object.
  const [suiSlice] = tx.splitCoins(tx.gas, [tx.pure.u64(suiAmount)])
  const [tokenSlice] = tx.splitCoins(tx.object(tokenCoin.id), [tx.pure.u64(tokenAmount)])

  const [position, tokenRefund, suiRefund] = tx.moveCall({
    target: `${CETUS_CLMM_PKG}::pool_creator::create_pool_v2`,
    typeArguments: [tokenType, SUI_TYPE],
    arguments: [
      tx.object(CETUS_CONTRACT.globalConfig),
      tx.object(CETUS_CONTRACT.pools),
      tx.pure.u32(CETUS_TICK_SPACING),
      tx.pure.u128(sqrtPrice),
      tx.pure.string(''), // icon URL — empty is fine; Cetus UI pulls from CoinMetadata
      tx.pure.u32(CETUS_TICK_LOWER_U32),
      tx.pure.u32(CETUS_TICK_UPPER_U32),
      tokenSlice,
      suiSlice,
      tx.object(tokenMetaId),
      tx.object(SUI_METADATA_ID),
      tx.pure.bool(true), // fix_amount_a = use exact token side, SUI side absorbs rounding
      tx.object(SUI_CLOCK),
    ],
  })

  // Burn the LP position to permanently lock liquidity. burn_lp_v2
  // returns a CetusLPBurnProof object; we hand it to the admin as a
  // receipt (not attached to any pool object since legacy SUI moonbags
  // doesn't expose a BURN_PROOF_FIELD slot for it).
  const [burnProof] = tx.moveCall({
    target: `${LP_BURN_PKG}::lp_burn::burn_lp_v2`,
    arguments: [tx.object(CETUS_CONTRACT.burnManager), position],
  })

  tx.transferObjects([burnProof, tokenRefund, suiRefund], tx.pure.address(admin))

  try {
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showObjectChanges: true, showEvents: true },
    })

    if (result.effects?.status?.status !== 'success') {
      return {
        success: false,
        digest: result.digest,
        error: `Cetus pool creation TX failed: ${JSON.stringify(result.effects?.status)}`,
      }
    }

    const cetusPool = result.objectChanges?.find(
      (c: any) => c.type === 'created' && c.objectType?.includes('::pool::Pool<'),
    ) as any
    const burn = result.objectChanges?.find(
      (c: any) => c.type === 'created' && c.objectType?.includes('LPBurnProof'),
    ) as any

    return {
      success: true,
      digest: result.digest,
      cetusPoolId: cetusPool?.objectId,
      burnProofId: burn?.objectId,
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
