import { NextResponse } from 'next/server'
import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { MOONBAGS_AIDA_CONTRACT, MOONBAGS_AIDA_V2_ORIGINAL_PKG } from '@/lib/contracts_aida'

// One-shot admin route to set the AIDA-fork bonding-pool creation fee.
// Wraps the `setter_pool_creation_fee(AdminCap, &mut Configuration, u64)`
// entry on the V5 package. Looks up the admin's AdminCap automatically
// (filter: owned objects of type `<origin_pkg>::moonbags::AdminCap`), so
// the caller doesn't need to provide it.
//
// Usage:
//   # Default 50,000 AIDA
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "https://theodyssey.fun/api/admin/set-aida-fee"
//
//   # Custom value in mist (AIDA = 9 decimals)
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "https://theodyssey.fun/api/admin/set-aida-fee?feeMist=5000000000"
//
// Required env: ADMIN_WALLET_SECRET, CRON_SECRET (optional but recommended)

export const dynamic = 'force-dynamic'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'

// AdminCap type is pinned to the ORIGINAL V2 publish id — Sui anchors
// struct types to origin-id across upgrades.
const ADMIN_CAP_TYPE = `${MOONBAGS_AIDA_V2_ORIGINAL_PKG}::moonbags::AdminCap`

// Default when caller doesn't pass ?feeMist= — the value currently
// documented as the target creation fee.
const DEFAULT_FEE_MIST = 50_000_000_000_000n // 50,000 AIDA

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

async function findAdminCap(client: SuiClient, owner: string): Promise<string | null> {
  let cursor: string | null = null
  for (let page = 0; page < 5; page++) {
    const res = await client.getOwnedObjects({
      owner,
      filter: { StructType: ADMIN_CAP_TYPE },
      options: { showType: true },
      cursor: cursor ?? undefined,
    })
    const hit = res.data.find(o => o.data?.type === ADMIN_CAP_TYPE)
    if (hit?.data?.objectId) return hit.data.objectId
    if (!res.hasNextPage || !res.nextCursor) break
    cursor = res.nextCursor
  }
  return null
}

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.ADMIN_WALLET_SECRET) {
    return NextResponse.json({ error: 'ADMIN_WALLET_SECRET not configured' }, { status: 503 })
  }

  const url = new URL(req.url)
  const feeMistParam = url.searchParams.get('feeMist')
  let feeMist: bigint
  try {
    feeMist = feeMistParam ? BigInt(feeMistParam) : DEFAULT_FEE_MIST
  } catch {
    return NextResponse.json({ error: `Invalid feeMist: ${feeMistParam}` }, { status: 400 })
  }
  if (feeMist < 0n) {
    return NextResponse.json({ error: 'feeMist must be >= 0' }, { status: 400 })
  }

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  try {
    const adminCapId = await findAdminCap(client, adminAddress)
    if (!adminCapId) {
      return NextResponse.json({
        error: `No AdminCap of type ${ADMIN_CAP_TYPE} found in wallet ${adminAddress}`,
      }, { status: 404 })
    }

    const tx = new Transaction()
    tx.setSender(adminAddress)
    tx.setGasBudget(50_000_000)
    tx.moveCall({
      target: `${MOONBAGS_AIDA_CONTRACT.packageId}::moonbags::setter_pool_creation_fee`,
      arguments: [
        tx.object(adminCapId),
        tx.object(MOONBAGS_AIDA_CONTRACT.configuration),
        tx.pure.u64(feeMist),
      ],
    })

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true },
    })

    const ok = result.effects?.status?.status === 'success'
    const humanFee = Number(feeMist) / 1e9
    return NextResponse.json({
      success: ok,
      digest: result.digest,
      adminCap: adminCapId,
      configuration: MOONBAGS_AIDA_CONTRACT.configuration,
      newFee: { mist: feeMist.toString(), aida: humanFee },
      error: ok ? undefined : JSON.stringify(result.effects?.status),
    })
  } catch (e: any) {
    console.error(`[set-aida-fee] failed: ${e.message}`)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
