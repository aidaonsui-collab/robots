import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

// Mints an Odyssey Founder NFT for a freshly-created agent. Returns
// the NFT object id on success, null on any failure.
//
// Best-effort by design: if the founder_nft package env vars aren't
// configured (which they aren't until Jack publishes the package),
// this returns null and logs a single line. Agent creation never
// fails because the NFT didn't mint.
//
// All gas paid by the admin wallet (already used for the migration
// crons). Per-mint cost ~0.001 SUI.
//
// Env vars required for actual minting:
//   ADMIN_WALLET_SECRET        — admin keypair (already configured)
//   FOUNDER_NFT_PACKAGE_ID     — `0x…` of the published package
//   FOUNDER_NFT_ADMIN_CAP_ID   — `0x…` of the AdminCap minted at init
//   FOUNDER_NFT_REGISTRY_ID    — `0x…` of the shared Registry from init

const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const SUI_CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006'

function loadAdminKeypair(): Ed25519Keypair | null {
  const secret = process.env.ADMIN_WALLET_SECRET
  if (!secret) return null
  try {
    const { secretKey } = decodeSuiPrivateKey(secret)
    return Ed25519Keypair.fromSecretKey(secretKey)
  } catch {
    try {
      const bytes = secret.startsWith('0x')
        ? Uint8Array.from(Buffer.from(secret.slice(2), 'hex'))
        : Uint8Array.from(Buffer.from(secret, 'base64'))
      return Ed25519Keypair.fromSecretKey(bytes)
    } catch {
      return null
    }
  }
}

export interface MintFounderNftParams {
  recipient: string         // human creator's Sui address
  agentId: string           // agent's auto-generated wallet address (used as NFT.agent_id)
  poolId: string            // bonding curve Pool<Token> object id
  agentName: string
  agentSymbol: string
  imageUrl?: string
}

export async function mintFounderNft(params: MintFounderNftParams): Promise<string | null> {
  const pkg = process.env.FOUNDER_NFT_PACKAGE_ID
  const adminCap = process.env.FOUNDER_NFT_ADMIN_CAP_ID
  const registry = process.env.FOUNDER_NFT_REGISTRY_ID

  if (!pkg || !adminCap || !registry) {
    console.log('[founder-nft] mint skipped — package env vars not configured')
    return null
  }
  const keypair = loadAdminKeypair()
  if (!keypair) {
    console.warn('[founder-nft] mint skipped — ADMIN_WALLET_SECRET not configured')
    return null
  }
  if (!params.recipient?.startsWith('0x') || !params.agentId?.startsWith('0x') || !params.poolId?.startsWith('0x')) {
    console.warn('[founder-nft] mint skipped — invalid address/id', { recipient: params.recipient, agentId: params.agentId, poolId: params.poolId })
    return null
  }

  // Truncate image URL defensively. Sui object size is generous but
  // an arbitrary user-supplied URL has no real upper bound.
  const imageUrl = (params.imageUrl ?? '').slice(0, 1000)

  try {
    const client = new SuiClient({ url: SUI_RPC })
    const tx = new Transaction()
    tx.setSender(keypair.getPublicKey().toSuiAddress())
    tx.setGasBudget(50_000_000)

    tx.moveCall({
      target: `${pkg}::founder_nft::mint`,
      arguments: [
        tx.object(adminCap),
        tx.object(registry),
        tx.pure.address(params.recipient),
        tx.pure.address(params.agentId),
        tx.pure.id(params.poolId),
        tx.pure.vector('u8', Array.from(new TextEncoder().encode(params.agentName))),
        tx.pure.vector('u8', Array.from(new TextEncoder().encode(params.agentSymbol))),
        tx.pure.vector('u8', Array.from(new TextEncoder().encode(imageUrl))),
        tx.object(SUI_CLOCK),
      ],
    })

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showObjectChanges: true },
    })

    if (result.effects?.status?.status !== 'success') {
      console.warn('[founder-nft] mint tx failed', result.effects?.status, 'digest:', result.digest)
      return null
    }

    // Extract the new NFT object id from objectChanges. The mint
    // creates one new owned object of type `<pkg>::founder_nft::OdysseyFounderNFT`.
    const created = result.objectChanges?.find(
      (c: any) => c.type === 'created' && typeof c.objectType === 'string' && c.objectType.endsWith('::founder_nft::OdysseyFounderNFT')
    ) as any | undefined
    const nftId = created?.objectId ?? null

    console.log('[founder-nft] minted', { agentId: params.agentId, poolId: params.poolId, nftId, digest: result.digest })
    return nftId
  } catch (e: any) {
    console.warn('[founder-nft] mint error', e?.message)
    return null
  }
}
