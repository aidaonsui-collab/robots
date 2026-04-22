import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const RPC = 'https://fullnode.mainnet.sui.io'

// Sui events are typed by their *origin* publishing package, not the upgraded
// one — so legacy v3-v10 tokens all emit `<legacy origin>::moonbags::CreatedEventV2`
// while v11 (a fresh publish, not an upgrade) emits its own type. We have to
// query all three to get the full token list.
const ORIGIN_PACKAGE_LEGACY      = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'
const ORIGIN_PACKAGE_V11         = '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813'
const ORIGIN_PACKAGE_V12         = '0x95bb61b03a5d476c2621b2b3f512e8fd5f0976260ce4e8d0d9a79ca64b658f4e' // 2026-04-16 publish
const ORIGIN_PACKAGE_V12_CURRENT = '0x2ab8f764b67991acaf37966af2274dcf7214ae0e8cea3ede214078f248dce3d2' // 2026-04-21 republish (admin-settable fee)
const ORIGIN_PACKAGE_AIDA        = '0x2156ceed0866b899840871add0efdae25799b2b22df1563922b5b01c011975a8' // 2026-04-18 publish
const ORIGIN_PACKAGE_AIDA_CURRENT = '0x593a2e87f393dcb14e0f8c88d587c04e9bc98295e13212e8992343377bf7f313' // 2026-04-21 republish (admin-settable fee)

// Token supply used as fallback once a bonding curve graduates — the contract
// zeroes out remain_token_reserves on transfer_pool, so we can't read it from
// the pool object after graduation. Standard Odyssey launch supply is 1B.
const POST_GRAD_SUPPLY = 1_000_000_000

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
  '0x64da6249e484247e56331c0b7c4edfced821188d15fd9784bc11950d4e2d0fb1::sword::SWORD',                   // SWORD
  '0x2e9d593c61ae85792a32244d974169e2d9ff09ed8eec57e3e88bd2773eb84d2c::dulce::DULCE',                   // DULCE (duplicate)
  '0x5b5d441190e4fb43735f23dbc4b329c96e996a0beb53a5993a6e052e3adbf83e::shine::SHINE',                   // SHINE
  '0xcf7eeb3d4fc53529996e8903e739cb703528e9b60dd07405b2a3d65afb29d3ee::nav::NAV',                       // NAV
  // Spam / abusive names
  '0x79d820e01cb8e14feded3002dca8a89643bca25ea7adb9c53e5b288f4266c9de::fuck::FUCK',
  '0x3197fc9b14ae9f468805e23f5aa679e78ae68e9e71c3570677f9e7a40dd39557::texmother::TEXMOTHER',
  '0x937769b1d384cb98a96f4e6c88e25c3d4d79f6314fc51698820c7906d248f184::guytexxas::GUYTEXXAS',
  '0x4e392b49594d541b2c926cdf10fac61c18306d7847f3f216cca4bb8686df10bf::fucktexxas::FUCKTEXXAS',
  '0x0f38cfd0374810813a18298f41bf9a58f8c2d0080197a877416264cb44b14e35::scammer::SCAMMER',
  '0xea12d0e905d694e04a06fe0925508e51a10b2a4fc46772f6c6f54c2b83ce60d1::fuckbyme::FUCKBYME',
  '0x72469f9541dea1dea3168ab7fbddd7c28f9d25c74d1697bdda49371fa01a2fac::fuckwife::FUCKWIFE',
  '0x6babb562b62c52b8bbe33c9becd818310946453f8bef5b7482947c54ec96bf4e::fucking::FUCKING',
  '0xfadb5be4baeadda6910f25fb766b3dd4f7b60e8da6f131fc2c9fb3050c9c58d3::sexyist::SEXYIST',
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

/** Extract package address from a full event type string like "0xabc::moonbags::CreatedEventV2" */
function getPackageFromEventType(eventType: string): string {
  const match = eventType.match(/^(0x[a-f0-9]{64})::/)
  return match ? match[1] : ''
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

/** Fetch AIDA price in USD directly from DexScreener (AIDA priced in USD on DexScreener). */
async function fetchAidaPriceUsd(): Promise<number> {
  try {
    const res = await fetch(
      'https://api.dexscreener.com/latest/dex/pairs/sui/0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b',
      { next: { revalidate: 60 } }
    )
    if (res.ok) {
      const json = await res.json()
      const pair = json?.pair || json?.pairs?.[0]
      const priceUsd = parseFloat(pair?.priceUsd || '0')
      if (priceUsd > 0) return priceUsd
    }
  } catch { /* fall through */ }
  return 0
}

export async function GET() {
  try {
    // Fetch prices for market cap calculations
    const [suiPriceUsd, aidaPriceUsd] = await Promise.all([
      fetchSuiPriceUsd(),
      fetchAidaPriceUsd(),
    ])

    // Fetch CreatedEventV2 + TradedEventV2 from ALL package origins
    // (legacy, v11, both v12 publishes, both AIDA-fork publishes).
    const [
      createdLegacy,
      createdV11,
      createdV12,
      createdV12Current,
      createdAida,
      createdAidaCurrent,
      tradesLegacy,
      tradesV11,
      tradesV12,
      tradesV12Current,
      tradesAida,
      tradesAidaCurrent,
    ] = await Promise.all([
      queryEvents(`${ORIGIN_PACKAGE_LEGACY}::moonbags::CreatedEventV2`,       50, true),
      queryEvents(`${ORIGIN_PACKAGE_V11}::moonbags::CreatedEventV2`,          50, true),
      queryEvents(`${ORIGIN_PACKAGE_V12}::moonbags::CreatedEventV2`,          50, true),
      queryEvents(`${ORIGIN_PACKAGE_V12_CURRENT}::moonbags::CreatedEventV2`,  50, true),
      queryEvents(`${ORIGIN_PACKAGE_AIDA}::moonbags::CreatedEventV2`,         50, true),
      queryEvents(`${ORIGIN_PACKAGE_AIDA_CURRENT}::moonbags::CreatedEventV2`, 50, true),
      queryEvents(`${ORIGIN_PACKAGE_LEGACY}::moonbags::TradedEventV2`,        200, false),
      queryEvents(`${ORIGIN_PACKAGE_V11}::moonbags::TradedEventV2`,           200, false),
      queryEvents(`${ORIGIN_PACKAGE_V12}::moonbags::TradedEventV2`,           200, false),
      queryEvents(`${ORIGIN_PACKAGE_V12_CURRENT}::moonbags::TradedEventV2`,   200, false),
      queryEvents(`${ORIGIN_PACKAGE_AIDA}::moonbags::TradedEventV2`,          200, false),
      queryEvents(`${ORIGIN_PACKAGE_AIDA_CURRENT}::moonbags::TradedEventV2`,  200, false),
    ])

    // Merge + dedupe by pool_id. Newest publish takes priority over older
    // ones for the same pool id (shouldn't happen in practice — a pool
    // belongs to the package that emitted its CreatedEventV2 — but the
    // dedupe guards against any bridging we might add later).
    const seen = new Set<string>()
    const events: any[] = []
    for (const e of [...createdV12Current, ...createdV12, ...createdV11, ...createdLegacy, ...createdAidaCurrent, ...createdAida]) {
      const pid = e.parsedJson?.pool_id
      if (!pid || seen.has(pid)) continue
      seen.add(pid)
      events.push(e)
    }
    const allTrades = [...tradesLegacy, ...tradesV11, ...tradesV12, ...tradesV12Current, ...tradesAida, ...tradesAidaCurrent]

    // Build trades by pool
    const tradesByPool = new Map<string, any[]>()
    for (const e of allTrades) {
      const poolId = e.parsedJson?.pool_id
      if (!poolId) continue
      if (!tradesByPool.has(poolId)) tradesByPool.set(poolId, [])
      tradesByPool.get(poolId)!.push(e.parsedJson)
    }

    // Determine which packages are AIDA-paired (covers both publish eras)
    const isAidaPackage = (pkgId: string) =>
      pkgId === ORIGIN_PACKAGE_AIDA || pkgId === ORIGIN_PACKAGE_AIDA_CURRENT

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
        const isCompleted = !!f.is_completed

        const virtualSui = BigInt(f.virtual_sui_reserves || '0')
        const virtualToken = BigInt(f.virtual_token_reserves || '0')
        const realSuiMist = BigInt(f.real_sui_reserves?.fields?.balance || '0')
        const thresholdMist = BigInt(f.threshold || '0')
        const remainTokenRaw = BigInt(f.remain_token_reserves?.fields?.balance || '0')

        const price = virtualToken > 0n ? Number(virtualSui) / 1e9 / (Number(virtualToken) / 1e6) : 0
        // Post-graduation the remain_token_reserves balance is 0 (transferred to admin),
        // so use the standard 1B launch supply fallback so market cap still renders.
        const totalSupply = remainTokenRaw > 0n
          ? Number(remainTokenRaw) / 1e6
          : POST_GRAD_SUPPLY
        const realSuiSui = Number(realSuiMist) / 1e9
        const thresholdSui = Number(thresholdMist) / 1e9
        // Graduated pools get capped to 100% — their realSuiMist was drained to the admin.
        const progress = isCompleted
          ? 100
          : thresholdMist > 0n
            ? (Number(realSuiMist) / Number(thresholdMist)) * 100
            : 0

        // Detect pair token from the event type package (not the transaction sender)
        const eventType = e.type || e.eventType || ''
        const eventPackage = getPackageFromEventType(eventType)
        const pairToken = isAidaPackage(eventPackage) ? 'AIDA' : 'SUI'
        const quotePriceUsd = pairToken === 'AIDA' ? aidaPriceUsd : suiPriceUsd
        const marketCap = price * totalSupply * quotePriceUsd

        // Calculate volume from trades (always in quote token — SUI for SUI pairs, AIDA for AIDA pairs)
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
          realSuiRaised: realSuiSui,
          threshold: thresholdSui,
          thresholdSui,
          progress,
          volume1h,
          isCompleted,
          createdAt: Number(meta.ts),
          creator: meta.created_by,
          moonbagsPackageId: eventPackage,
          // Canonical name used by PoolToken / TokenCard. Legacy `pairToken`
          // kept for any older consumers that still read the old field.
          pairType: pairToken,
          pairToken,
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
