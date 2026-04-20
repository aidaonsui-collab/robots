import { NextResponse } from 'next/server'
import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

export const dynamic = 'force-dynamic'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const MOMENTUM_PACKAGE = process.env.MOMENTUM_PACKAGE_ID || '0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1'
const MMT_VERSION  = process.env.MMT_VERSION  || '0x2375a0b1ec12010aaea3b2545acfa2ad34cfbba03ce4b59f4c39e1e25eed1b2a'
const CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'
const AIDA_TYPE = '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA'
const HERO_TYPE = '0x9b23d1a041b7ca45e2f72e68f6221528b82dc6c40357101601f27e1bde8f7a46::hero::HERO'

const POOL_ID     = '0x740de5bb3b03aa8eeb651cc3c6b751ba4f46f4a2d7b8307a8a9eac5d596ff55b'
const POSITION_ID = '0xcfba0103313c26a4818ea3528d4791c3e80164c4c474f486db55b164f1e88eba'

function getAdminKeypair(): Ed25519Keypair {
  const secret = process.env.ADMIN_WALLET_SECRET
  if (!secret) throw new Error('ADMIN_WALLET_SECRET not configured')
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

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.ADMIN_WALLET_SECRET) {
    return NextResponse.json({ error: 'ADMIN_WALLET_SECRET not configured' }, { status: 503 })
  }

  const client = new SuiClient({ url: SUI_RPC })
  const keypair = getAdminKeypair()
  const adminAddress = keypair.getPublicKey().toSuiAddress()

  try {
    const tx = new Transaction()
    tx.setSender(adminAddress)
    tx.setGasBudget(100_000_000)

    // Mirror the working pattern from fix-pool/route.ts:
    // collect::fee(pool, position, clock, version) — 4 args, returns (Coin<X>, Coin<Y>)
    // Pool type = Pool<HERO,AIDA> → type args [HERO, AIDA]
    const allCoins: any[] = []

    const [feeCoinX, feeCoinY] = tx.moveCall({
      target: `${MOMENTUM_PACKAGE}::collect::fee`,
      typeArguments: [HERO_TYPE, AIDA_TYPE],
      arguments: [
        tx.object(POOL_ID),
        tx.object(POSITION_ID),
        tx.object(CLOCK),
        tx.object(MMT_VERSION),
      ],
    })
    allCoins.push(feeCoinX, feeCoinY)

    tx.transferObjects(allCoins, tx.pure.address(adminAddress))

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showObjectChanges: true },
    })

    const ok = result.effects?.status?.status === 'success'

    // Extract amounts from created coin objects
    let amounts: {x?: string, y?: string} = {}
    if (ok && result.objectChanges) {
      const created = result.objectChanges.filter((c: any) => c.type === 'created')
      for (const c of created) {
        const t = c.objectType || ''
        if (t.includes('::hero::HERO')) amounts.x = c.objectId
        else if (t.includes('::aida::AIDA')) amounts.y = c.objectId
      }
    }

    return NextResponse.json({
      success: ok,
      digest: result.digest,
      amounts,
      error: ok ? undefined : JSON.stringify(result.effects?.status),
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
