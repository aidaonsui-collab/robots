import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const RPC = 'https://fullnode.mainnet.sui.io'

async function getIncomingFunders(address: string): Promise<string[]> {
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'suix_queryTransactionBlocks',
        params: [
          { filter: { ToAddress: address }, options: { showInput: true, showEffects: false } },
          null, 10, true,
        ],
      }),
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    })
    const j = await res.json()
    const txs: any[] = j.result?.data ?? []
    return txs
      .map((tx: any) => tx.transaction?.data?.sender)
      .filter((s: any): s is string => typeof s === 'string' && s.startsWith('0x'))
  } catch {
    return []
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const addressesParam = req.nextUrl.searchParams.get('addresses')
  if (!addressesParam) return NextResponse.json({ clusters: {}, clusterCount: 0 })

  const addresses = addressesParam.split(',').filter(Boolean).slice(0, 30)
  const addressSet = new Set(addresses.map(a => a.toLowerCase()))

  // Fetch funders for all addresses in parallel
  const funderResults = await Promise.all(
    addresses.map(async addr => {
      const funders = await getIncomingFunders(addr)
      // Exclude funders that are themselves top holders
      const external = funders.filter(f => !addressSet.has(f.toLowerCase()))
      const counts: Record<string, number> = {}
      for (const f of external) counts[f] = (counts[f] || 0) + 1
      const primaryFunder = Object.entries(counts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null
      return { addr: addr.toLowerCase(), primaryFunder }
    })
  )

  // Group by primary funder
  const funderToCluster: Record<string, number> = {}
  const clusters: Record<string, number> = {}
  let nextId = 0

  for (const { addr, primaryFunder } of funderResults) {
    if (!primaryFunder) continue
    if (funderToCluster[primaryFunder] === undefined) {
      funderToCluster[primaryFunder] = nextId++
    }
    clusters[addr] = funderToCluster[primaryFunder]
  }

  // Only keep clusters with 2+ members (single-member clusters aren't meaningful)
  const clusterCounts: Record<number, number> = {}
  for (const cId of Object.values(clusters)) {
    clusterCounts[cId] = (clusterCounts[cId] || 0) + 1
  }
  const validClusters = new Set(
    Object.entries(clusterCounts)
      .filter(([, c]) => c >= 2)
      .map(([id]) => Number(id))
  )

  const filteredClusters: Record<string, number> = {}
  let filteredId = 0
  const remapId: Record<number, number> = {}
  for (const [addr, cId] of Object.entries(clusters)) {
    if (!validClusters.has(cId)) continue
    if (remapId[cId] === undefined) remapId[cId] = filteredId++
    filteredClusters[addr] = remapId[cId]
  }

  return NextResponse.json({ clusters: filteredClusters, clusterCount: filteredId })
}
