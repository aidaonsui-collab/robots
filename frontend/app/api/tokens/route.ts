import { NextResponse } from 'next/server'

const RPC = 'https://fullnode.mainnet.sui.io'

// Sui events are typed by their *origin* publishing package, not the upgraded
// one — so legacy v3-v10 tokens all emit `<legacy origin>::moonbags::CreatedEventV2`
// while v11 (a fresh publish, not an upgrade) emits its own type. We have to
// query both to get the full token list.
const ORIGIN_PACKAGE_LEGACY = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'
const ORIGIN_PACKAGE_V11    = '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813'
const ORIGIN_PACKAGE_V12    = '0x95bb61b03a5d476c2621b2b3f512e8fd5f0976260ce4e8d0d9a79ca64b658f4e'

// Denylist — hide test/unwanted tokens. New tokens appear automatically unless added here.
const HIDDEN_TOKENS = new Set([
  '0x57acced890472772e1e3666bdd8f38f88dc9a0d396a8fe41fefa4e91b7efb522::coin_template::COIN_TEMPLATE',  // HOPE
  '0x3bd8425120777a205d5614e0dd9dc19af4f6a640ba6e1680a8248105571c23bb::gong::GONG',                    // GONG (dugong)
  '0xea74f2de7715217eabcacbc7d3c9661bae66c9dc7abc57bc2087924e81d9ed05::coin_template::COIN_TEMPLATE',  // LEGEND
  '0xd5a3eca34b5776ee75a4725bbd3259156189b1bacf828668d29301035ea5fc56::coin_template::COIN_TEMPLATE',  // BIGFOOT
  '0xad7e107830dd3826ce92f9d7025db3b589141ea740a7563c408c6af27203229f::bob__________::BOB__________',  // BOB
  '0x4129a8f1319a89367c844bceeb4e9f64f4406f58aa644b0f647b4df067e56480::genos::GENOS',                  // GENOS
  '0x68a85f4e978f28d174b96fb540cd2d6560c25de9fed8416892ae0d87ea6956fb::saitama::SAITAMA',              // SAITAMA
  '0x517fa7b4b2ef37c5f9fadb23ef02bee83a3e0c65e6d352c99c72274cc0372e4d::opm::OPM',                      // OPM
  '0x30465754531001de37a001b91775575c1e742f759d09a2b662709a7fc1e40f02::dulce::DULCE',                   // Pan Dulce (duplicate)
])

async function queryEvents(eventType: string, limit: number, descending: boolean) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_queryEvents',
      params: [{ MoveEventType: eventType }, null, limit, descending],
    }),
  })
  const json = await res.json()
  return json.result?.data || []
}

/** Fetch SUI price in USD from multiple sources. */
async function fetchSuiPriceUsd(): Promise<number> {
  // 1. Try CoinGecko (cache 60s to avoid rate limits)
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd',
      { next: { revalidate: 60 } }
    )
    if (res.ok) {
      const json = await res.json()
      const price = json?.sui?.usd
      if (price && price > 0) return price
    }
  } catch { /* fall through */ }

  // 2. Try CryptoCompare (no auth needed for simple price)
  try {
    const res = await fetch(
      'https://min-api.cryptocompare.com/data/price?fsym=SUI&tsyms=USD',
      { next: { revalidate: 60 } }
    )
    if (res.ok) {
      const json = await res.json()
      const price = json?.USD
      if (price && price > 0) return price
    }
  } catch { /* fall through */ }

  // 3. Fallback: derive from DexScreener AIDA pair (priceUsd / priceNative = SUI price)
  try {
    const res = await fetch(
      'https://api.dexscreener.com/latest/dex/pairs/sui/0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b',
      { next: { revalidate: 60 } }
    )
    if (res.ok) {
      const json = await res.json()
      const pair = json?.pair || json?.pairs?.[0]
      const priceUsd = parseFloat(pair?.priceUsd || '0')
      const priceNative = parseFloat(pair?.priceNative || '0')
      if (priceUsd > 0 && priceNative > 0) return priceUsd / priceNative
    }
  } catch { /* fall through */ }

  return 0
}

export async function GET() {
  try {
    // Fetch SUI price once for all market cap calculations
    const suiPriceUsd = await fetchSuiPriceUsd()

    // Fetch CreatedEventV2 + TradedEventV2 from BOTH legacy and v11 origins.
    const [
      createdLegacy,
      createdV11,
      createdV12,
      tradesLegacy,
      tradesV11,
      tradesV12,
    ] = await Promise.all([
      queryEvents(`${ORIGIN_PACKAGE_LEGACY}::moonbags::CreatedEventV2`, 50, true),
      queryEvents(`${ORIGIN_PACKAGE_V11}::moonbags::CreatedEventV2`,    50, true),
      queryEvents(`${ORIGIN_PACKAGE_V12}::moonbags::CreatedEventV2`,    50, true),
      queryEvents(`${ORIGIN_PACKAGE_LEGACY}::moonbags::TradedEventV2`,  200, false),
      queryEvents(`${ORIGIN_PACKAGE_V11}::moonbags::TradedEventV2`,     200, false),
      queryEvents(`${ORIGIN_PACKAGE_V12}::moonbags::TradedEventV2`,     200, false),
    ])

    // Merge + dedupe by pool_id, keep newest first.
    const seen = new Set<string>()
    const events: any[] = []
    for (const e of [...createdV12, ...createdV11, ...createdLegacy]) {
      const pid = e.parsedJson?.pool_id
      if (!pid || seen.has(pid)) continue
      seen.add(pid)
      events.push(e)
    }
    const allTrades = [...tradesLegacy, ...tradesV11, ...tradesV12]
    
    // Build trades by pool
    const tradesByPool = new Map<string, any[]>()
    for (const e of allTrades) {
      const poolId = e.parsedJson?.pool_id
      if (!poolId) continue
      if (!tradesByPool.has(poolId)) tradesByPool.set(poolId, [])
      tradesByPool.get(poolId)!.push(e.parsedJson)
    }
    
    // Process each event into a token
    const tokens = await Promise.all(
      events.map(async (e: any) => {
        const meta = e.parsedJson
        const poolId = meta.pool_id
        
        const poolRes = await fetch(RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sui_getObject',
            params: [poolId, { showContent: true, showType: true }]
          })
        })
        
        const poolJson = await poolRes.json()
        const poolData = poolJson.result?.data
        
        if (!poolData) return null
        
        const f = poolData.content.fields
        const typeStr = poolData.content.type || ''
        const coinTypeMatch = typeStr.match(/Pool<(.+)>/)
        const coinType = coinTypeMatch ? coinTypeMatch[1] : ''
        
        const virtualSui = BigInt(f.virtual_sui_reserves || '0')
        const virtualToken = BigInt(f.virtual_token_reserves || '0')
        const realSuiMist = BigInt(f.real_sui_reserves?.fields?.balance || '0')
        const thresholdMist = BigInt(f.threshold || '0')
        const remainTokenRaw = BigInt(f.remain_token_reserves?.fields?.balance || '0')

        const price = virtualToken > 0n ? Number(virtualSui) / 1e9 / (Number(virtualToken) / 1e6) : 0
        // Use tradeable supply (R) not total minted (2R) — second R is locked for DEX LP.
        // MC = spot price × R — launch MC = threshold/4 × SUI_price ≈ $1.1K at 2000 SUI threshold.
        const totalSupply = Number(remainTokenRaw) / 1e6  // R tokens
        const realSuiSui = Number(realSuiMist) / 1e9
        const marketCap = price * totalSupply * suiPriceUsd
        const thresholdSui = Number(thresholdMist) / 1e9
        const progress = thresholdMist > 0n ? (Number(realSuiMist) / Number(thresholdMist)) * 100 : 0
        
        // Calculate volume from trades
        const poolTrades = tradesByPool.get(poolId) ?? []
        const now = Date.now()
        const oneHourAgo = now - 60 * 60 * 1000
        const volume1h = poolTrades
          .filter(t => Number(t.ts) >= oneHourAgo)
          .reduce((sum, t) => sum + Number(t.sui_amount || 0), 0) / 1e9
        
        return {
          id: poolId,
          poolId,
          coinType,
          symbol: meta.symbol,
          name: meta.name,
          description: meta.description,
          imageUrl: meta.uri,
          twitter: meta.twitter,
          telegram: meta.telegram,
          website: meta.website,
          currentPrice: price,
          marketCap,
          totalSupply,
          realSuiSui,
          thresholdSui,
          progress,
          volume1h,
          isCompleted: f.is_completed,
          createdAt: Number(meta.ts),
          creator: meta.created_by,
        }
      })
    )
    
    const validTokens = tokens.filter((t): t is NonNullable<typeof t> => t !== null).filter(t => !HIDDEN_TOKENS.has(t.coinType))
    
    return NextResponse.json(validTokens)
  } catch (error: any) {
    console.error('Error fetching tokens:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}