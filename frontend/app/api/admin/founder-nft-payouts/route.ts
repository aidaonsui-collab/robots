import { NextResponse } from 'next/server'
import { SuiClient } from '@mysten/sui/client'
import { listAllAgents } from '@/lib/agents-db'

// Read-only admin helper: returns (pool, agent, current Founder NFT
// holder, accrued creator-share fees) rows for manual payout rounds.
//
// Usage:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     https://theodyssey.fun/api/admin/founder-nft-payouts
//
// The actual payouts are still manual — this just consolidates the
// lookup work (current NFT holder + on-curve pot + creator share
// calculation) so the admin doesn't have to scan per agent.
//
// Notes:
//  - Rows are sorted by creatorShareAida desc, biggest payouts first.
//  - isOrphaned=true flags NFTs where the holder != original creator
//    (NFT was sold/transferred) — those are the rows you specifically
//    want to double-check routing on.
//  - For v1, only looks at on-curve `fee_recipient` balance. Graduated
//    pools have additional LP-fee claims via the Cetus BurnProof — not
//    handled here, add in a follow-up if you want to sweep those too.
//  - Owner resolution returns the raw object owner. If the NFT is
//    wrapped in a Kiosk, you'll see an ObjectOwner (kiosk id) instead
//    of an address — that's a signal to look up the kiosk's owner
//    manually.

export const dynamic = 'force-dynamic'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'

// Creator's share of the 2% trade fee. Matches FEE_SPLIT.creator in
// lib/contracts.ts (3000 / 10000 = 30%). If the admin retunes the
// on-chain fee split, update this constant to match.
const CREATOR_BPS = 3000n

interface PayoutRow {
  agentId: string
  agentName: string
  agentSymbol: string
  poolId: string
  tokenType: string
  founderNftId: string
  holder: string | null
  isOrphaned: boolean
  poolFeePotMist: string
  poolFeePotAida: number
  creatorShareMist: string
  creatorShareAida: number
  note?: string
}

function extractOwnerAddress(owner: unknown): string | null {
  if (!owner || typeof owner !== 'object') return null
  const o = owner as Record<string, unknown>
  if (typeof o.AddressOwner === 'string') return o.AddressOwner
  if (typeof o.ObjectOwner === 'string') return o.ObjectOwner  // likely a Kiosk
  return null
}

function extractCoinBalance(fields: any, fieldName: string): bigint {
  const coin = fields?.[fieldName]
  if (!coin) return 0n
  // Sui returns Coin<T> either as { balance: "123" } or
  // { fields: { balance: "123" } } depending on how it's nested.
  const raw = coin?.fields?.balance ?? coin?.balance
  if (raw == null) return 0n
  try { return BigInt(raw) } catch { return 0n }
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = new SuiClient({ url: SUI_RPC })
  const agents = await listAllAgents(500)
  const rows: PayoutRow[] = []

  for (const agent of agents) {
    if (!agent.founderNftId || !agent.poolId) continue

    const row: PayoutRow = {
      agentId: agent.id,
      agentName: agent.name ?? '',
      agentSymbol: agent.symbol ?? '',
      poolId: agent.poolId,
      tokenType: agent.tokenType ?? '',
      founderNftId: agent.founderNftId,
      holder: null,
      isOrphaned: false,
      poolFeePotMist: '0',
      poolFeePotAida: 0,
      creatorShareMist: '0',
      creatorShareAida: 0,
    }

    try {
      // NFT owner
      const nftRes = await client.getObject({
        id: agent.founderNftId,
        options: { showOwner: true },
      })
      const holder = extractOwnerAddress(nftRes.data?.owner)
      row.holder = holder
      row.isOrphaned = !!(holder && agent.creatorAddress && holder !== agent.creatorAddress)

      // Pool fee_recipient balance. AIDA-fork pools store this directly
      // on the Pool struct. SUI-fork pools use the same field name, so
      // this works for both.
      try {
        const poolRes = await client.getObject({
          id: agent.poolId,
          options: { showContent: true },
        })
        const fields = (poolRes.data?.content as any)?.fields
        const feeTotal = extractCoinBalance(fields, 'fee_recipient')
        row.poolFeePotMist = feeTotal.toString()
        row.poolFeePotAida = Number(feeTotal) / 1e9
        const creatorShare = (feeTotal * CREATOR_BPS) / 10000n
        row.creatorShareMist = creatorShare.toString()
        row.creatorShareAida = Number(creatorShare) / 1e9
      } catch (e: any) {
        row.note = `pool lookup failed: ${e.message}`
      }
    } catch (e: any) {
      row.note = `nft lookup failed: ${e.message}`
    }

    rows.push(row)
  }

  rows.sort((a, b) => b.creatorShareAida - a.creatorShareAida)

  const totalCreatorShareAida = rows.reduce((s, r) => s + r.creatorShareAida, 0)
  const orphanedCount = rows.filter(r => r.isOrphaned).length

  return NextResponse.json({
    summary: {
      agentsWithNft: rows.length,
      orphanedNfts: orphanedCount,
      totalCreatorShareAida,
      generatedAt: new Date().toISOString(),
    },
    rows,
  })
}
