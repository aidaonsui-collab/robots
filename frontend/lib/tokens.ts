import { ODYSSEY_CONTRACT, BACKEND_URL, MOONBAGS_CONTRACT_V12 } from './contracts'
import { fetchAidaPriceUsd, getPairType, type PairToken } from './contracts_aida'
import { TOKEN_CONFIG } from './token-config'
import { kv } from '@vercel/kv'

const RPC = 'https://fullnode.mainnet.sui.io'

/** Check if a token is an AI agent (via KV lookup + hardcoded fallback) */
async function isTokenAnAiAgent(tokenType: string): Promise<boolean> {
  // Hardcoded fallbacks for agents whose KV index is missing
  const HARDCODED_AGENTS = new Set([
    '0x266a1d6e3033c42925b6836c21a686a48792373acd02fc89497dff83210a07f7::alpha::ALPHA',
    '0x76dd032863fdcc44b358c633aeada8cfcf0909893650a057565e4f4e74985038::svec::SVEC',
  ])
  if (HARDCODED_AGENTS.has(tokenType)) return true
  
  try {
    const agentId = await kv.get<string>(`agent:token:${tokenType}`)
    return !!agentId
  } catch (err) {
    console.error('KV lookup error for', tokenType, err)
    return false
  }
}

/** Return the stream URL for a pool — static config → KV API → empty string. */
async function fetchStreamUrl(poolId: string): Promise<string> {
  // 1. Static overrides (always works, no network)
  const override = TOKEN_CONFIG[poolId]?.streamUrl
  if (override) return override

  // 2. Vercel KV via our Next.js API route
  try {
    const base = typeof window !== 'undefined'
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? 'https://aidaonsui-collab-theodyssey2.vercel.app'
    const res = await fetch(`${base}/api/stream-url?poolId=${encodeURIComponent(poolId)}`, {
      next: { revalidate: 60 },
    })
    if (res.ok) {
      const json = await res.json()
      if (json.streamUrl) return json.streamUrl
    }
  } catch { /* ignore */ }

  return ''
}

// Fetch token count from contract
export async function getTokenCount(): Promise<number> {
  try {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getObject',
        params: [
          ODYSSEY_CONTRACT.tokenRegistry,
          { showContent: true }
        ]
      })
    })
    const data = await response.json()
    if (data.result?.data?.content?.fields?.total_tokens) {
      return parseInt(data.result.data.content.fields.total_tokens)
    }
  } catch (e) {
    console.error('Error fetching token count:', e)
  }
  return 0
}

// Fetch all tokens (pools) from contract
export async function fetchRealTokens(): Promise<any[]> {
  const tokens: any[] = []
  
  try {
    // Get registry to find pool IDs
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getObject',
        params: [
          ODYSSEY_CONTRACT.tokenRegistry,
          { showContent: true }
        ]
      })
    })
    
    const data = await response.json()
    const pools = data.result?.data?.content?.fields?.pools
    
    if (pools && pools.fields?.size > 0) {
      // Pool IDs found - would need to query each pool
      // For now return empty until we iterate
      console.log('Pools found:', pools)
    }
    
  } catch (e) {
    console.error('Error fetching tokens:', e)
  }
  
  return tokens
}

// Check if we have real tokens
export async function hasRealTokens(): Promise<boolean> {
  const count = await getTokenCount()
  return count > 0
}

// Legacy origin of the Moonbags upgrade chain — events from any version in
// the chain (v5..v10) show up under this package's event types.
const ORIGIN_PACKAGE = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'

// v11 package ID (moved to legacy in contracts.ts; keep here for event fan-out)
const V11_PACKAGE = '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813'
// V12 has two live publishes:
//   - 2026-04-16 (previous, no admin-settable fee)
//   - 2026-04-21 (current, admin-settable fee via Configuration field)
// Both still emit events because pools created under either publish
// continue trading. MOONBAGS_CONTRACT_V12.packageId tracks the *current*
// publish; the previous one is listed explicitly so its events still
// fan out to the UI.
const V12_PACKAGE         = MOONBAGS_CONTRACT_V12.packageId
const V12_PACKAGE_PREV    = '0x95bb61b03a5d476c2621b2b3f512e8fd5f0976260ce4e8d0d9a79ca64b658f4e'

// AIDA-paired fork. Same two-publish story as V12.
const AIDA_PACKAGE        = '0x2156ceed0866b899840871add0efdae25799b2b22df1563922b5b01c011975a8'
const AIDA_PACKAGE_CURRENT = '0x593a2e87f393dcb14e0f8c88d587c04e9bc98295e13212e8992343377bf7f313'

// Packages to fan out event queries across (legacy chain + v11 + both v12
// publishes + both AIDA-fork publishes).
const EVENT_SOURCE_PACKAGES = [
  ORIGIN_PACKAGE,
  V11_PACKAGE,
  V12_PACKAGE,
  V12_PACKAGE_PREV,
  AIDA_PACKAGE,
  AIDA_PACKAGE_CURRENT,
] as const

export interface PoolToken {
  id: string                 // unique ID for card keys (same as poolId)
  createdAt?: number          // creation timestamp (for sorting newest first)
  poolId: string
  name: string
  symbol: string
  description: string
  imageUrl: string
  twitter: string
  telegram: string
  website: string
  streamUrl: string          // YouTube / Twitch live stream URL (from backend)
  creator: string
  currentPrice: number       // SUI per token
  realSuiRaised: number      // SUI (float)
  threshold: number          // SUI (float) - graduation target
  progress: number           // 0-100 percent
  isCompleted: boolean
  virtualSuiReserves: bigint
  virtualTokenReserves: bigint
  coinType: string           // e.g. "0x57ac...::coin_template::COIN_TEMPLATE"
  moonbagsPackageId: string
  pairType?: PairToken // 'SUI' or 'AIDA'  // package segment of Pool object type — used for per-pool routing (legacy vs v11)
  volume1h: number           // SUI traded in last 1 hour
  priceChange24h: number     // % price change over last 24 hours (can be negative)
  isAiLaunched?: boolean     // true if launched by AI agent
  agentVolume24h?: number    // agent trading volume in SUI (24h)
  age: string                // human-readable age (e.g. "5m", "2h", "1d")
  creatorShort: string       // shortened creator address
  creatorFull: string        // full creator address
  logoUrl: string            // alias for imageUrl (for compatibility)
  marketCap: number          // market cap in USD
  totalSupply: number        // total token supply (human-readable, decimals divided out)
  bondingProgress: number    // alias for progress (for compatibility)
}

/** Fetch SUI price in USD from multiple sources. */
export async function fetchSuiPriceUsd(): Promise<number> {
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

export interface TradeEvent {
  isBuy: boolean
  suiAmount: number          // SUI (float)
  tokenAmount: number        // tokens with 6 decimals divided out
  user: string
  timestampMs: number
  price: number              // SUI per token at time of trade
  txDigest: string           // transaction digest for explorer links
}

const suinsCache = new Map<string, string | null>()

/** Resolve a Sui address to its SuiNS .sui name (or null if none). Results are cached. */
export async function fetchSuiNSName(address: string): Promise<string | null> {
  if (suinsCache.has(address)) return suinsCache.get(address) ?? null
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 99,
        method: 'suix_resolveNameServiceNames',
        params: [address, null, 1],
      })
    })
    const json = await res.json()
    const names: string[] = json.result?.data ?? []
    const name = names.length > 0 ? names[0] : null
    suinsCache.set(address, name)
    return name
  } catch {
    suinsCache.set(address, null)
    return null
  }
}

export async function fetchPoolToken(poolIdOrCoinType: string): Promise<PoolToken | null> {
  try {
    // If input looks like a coinType (contains ::), find the pool first
    let poolId = poolIdOrCoinType
    if (poolIdOrCoinType.includes('::')) {
      const allTokens = await fetchAllPoolTokens()
      const token = allTokens.find(t => t.coinType === poolIdOrCoinType)
      if (!token) return null
      poolId = token.poolId
    }
    
    // 1. Fetch pool object
    const poolRes = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'sui_getObject',
        params: [poolId, { showContent: true, showType: true }]
      })
    })
    const poolJson = await poolRes.json()
    const poolData = poolJson.result?.data
    if (!poolData) return null
    const f = poolData.content.fields

    // Extract coin type and moonbags package from pool object type.
    // type looks like: "0x<mbagsPkg>::moonbags::Pool<0xABC::coin_template::COIN_TEMPLATE>"
    const typeStr: string = poolData.content.type || ''
    const coinTypeMatch = typeStr.match(/Pool<(.+)>/)
    const coinType = coinTypeMatch ? coinTypeMatch[1] : ''
    const moonbagsPackageId = typeStr.split('::')[0] || ''

    const virtualSui = BigInt(f.virtual_sui_reserves)
    const virtualToken = BigInt(f.virtual_token_reserves)
    const realSuiMist = BigInt(f.real_sui_reserves.fields.balance)
    const thresholdMist = BigInt(f.threshold)
    const isCompleted = f.is_completed
    const remainTokenRaw = BigInt(f.remain_token_reserves?.fields?.balance || '0')

    const price = Number(virtualSui) / 1e9 / (Number(virtualToken) / 1e6)
    const realSuiSui = Number(realSuiMist) / 1e9
    const thresholdSui = Number(thresholdMist) / 1e9
    const progress = isCompleted
     ? 100
     : thresholdMist > 0n ? (Number(realSuiMist) / Number(thresholdMist)) * 100 : 0
    // Post-graduation on-chain balance is zero — fall back to 1B standard launch supply.
    const totalSupply = remainTokenRaw > 0n ? Number(remainTokenRaw) / 1e6 : 1_000_000_000

    // Find the pool's CreatedEventV2 across every known package namespace.
    // Paginate descending (newest first, which is most callers' case) and
    // early-exit per package as soon as we find the matching pool. Caps at
    // 10 pages × 100 events = 1000 events per package — enough headroom
    // for years of launches. Old fixed-limit query (`null, 50, false`)
    // missed any token launched after the 50th — every token from #51
    // onwards was permanently stuck on the "Loading…" header.
    const MAX_PAGES_PER_PKG = 10
    const PAGE_SIZE = 100
    async function findCreationEvent(pkg: string): Promise<any | null> {
      let cursor: any = null
      for (let page = 0; page < MAX_PAGES_PER_PKG; page++) {
        let json: any
        try {
          const res = await fetch(RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 2,
              method: 'suix_queryEvents',
              params: [
                { MoveEventType: `${pkg}::moonbags::CreatedEventV2` },
                cursor, PAGE_SIZE, true,
              ]
            })
          })
          json = await res.json()
        } catch {
          return null
        }
        const data: any[] = json?.result?.data ?? []
        const found = data.find((e: any) => e.parsedJson?.pool_id === poolId)
        if (found) return found
        if (!json?.result?.hasNextPage || !json?.result?.nextCursor) break
        cursor = json.result.nextCursor
      }
      return null
    }
    const creationEventResponses = await Promise.all(
      EVENT_SOURCE_PACKAGES.map(pkg => findCreationEvent(pkg))
    )
    const creationEvent = creationEventResponses.find(e => e !== null)

    if (!creationEvent) return null
    const meta = creationEvent.parsedJson

    const [streamUrl, suiPriceUsd, aidaPriceUsd] = await Promise.all([
      fetchStreamUrl(poolId),
      fetchSuiPriceUsd(),
      fetchAidaPriceUsd(),
    ])
    const pairType = getPairType(moonbagsPackageId)
    const quotePriceUsd = pairType === 'AIDA' ? aidaPriceUsd : suiPriceUsd

    const creator = meta.created_by || ''
    const now = Date.now()
    const createdAt = creationEvent.timestampMs || now
    const ageMs = now - createdAt
    let age = ''
    if (ageMs < 60000) age = `${Math.floor(ageMs / 1000)}s`
    else if (ageMs < 3600000) age = `${Math.floor(ageMs / 60000)}m`
    else if (ageMs < 86400000) age = `${Math.floor(ageMs / 3600000)}h`
    else age = `${Math.floor(ageMs / 86400000)}d`

    // Market cap = spot price × R supply × quote-token price (USD)
    const marketCapUsd = price * totalSupply * quotePriceUsd

    return {
      id: poolId,
      poolId,
      name: meta.name,
      symbol: meta.symbol,
      description: meta.description || '',
      imageUrl: meta.uri || '',
      logoUrl: meta.uri || '',
      twitter: meta.twitter || '',
      telegram: meta.telegram || '',
      website: meta.website || '',
      streamUrl,
      creator,
      creatorShort: `${creator.slice(0, 6)}...${creator.slice(-4)}`,
      creatorFull: creator,
      currentPrice: price,
      realSuiRaised: realSuiSui,
      threshold: thresholdSui,
      progress: Math.min(100, progress),
      bondingProgress: Math.min(100, progress),
      marketCap: marketCapUsd,
      totalSupply,
      isCompleted,
      virtualSuiReserves: virtualSui,
      virtualTokenReserves: virtualToken,
      coinType,
      moonbagsPackageId,
      pairType,
      volume1h: 0,
      priceChange24h: 0,
      age,
      isAiLaunched: false,
      agentVolume24h: undefined,
    }
  } catch (e) {
    console.error('fetchPoolToken error:', e)
    return null
  }
}

export async function fetchPoolTrades(poolIdOrCoinType: string): Promise<TradeEvent[]> {
  // If input looks like a coinType (contains ::), find the pool first
  let poolId = poolIdOrCoinType
  if (poolIdOrCoinType.includes('::')) {
    const allTokens = await fetchAllPoolTokens()
    const token = allTokens.find(t => t.coinType === poolIdOrCoinType)
    if (!token) return []
    poolId = token.poolId
  }
  
  const allEvents: any[] = []
  const MAX_PAGES = 20 // up to 2000 events per package namespace

  try {
    // Fan out across every known package namespace. v11 pools emit events
    // under the v11 package; legacy pools emit under the origin package.
    // Query DESCENDING (newest first) so recent tokens' events are in the
    // first pages rather than buried past the 2000-event cap.
    for (const pkg of EVENT_SOURCE_PACKAGES) {
      let cursor: any = null
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetch(RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 3,
            method: 'suix_queryEvents',
            params: [
              { MoveEventType: `${pkg}::moonbags::TradedEventV2` },
              cursor, 100, true  // descending: newest events first
            ]
          })
        })
        const json = await res.json()
        const data: any[] = json.result?.data || []
        const poolEvents = data.filter((e: any) => e.parsedJson?.pool_id === poolId)
        allEvents.push(...poolEvents)

        if (!json.result?.hasNextPage) break
        cursor = json.result.nextCursor
      }
    }

    // Sort ascending by timestamp so callers get chronological order
    allEvents.sort((a, b) => Number(a.parsedJson?.ts ?? 0) - Number(b.parsedJson?.ts ?? 0))

    return allEvents.map((e: any) => {
      const p = e.parsedJson
      const vSui = Number(p.virtual_sui_reserves)
      const vToken = Number(p.virtual_token_reserves)
      const price = vToken > 0 ? (vSui / 1e9) / (vToken / 1e6) : 0
      return {
        isBuy: p.is_buy,
        suiAmount: Number(p.sui_amount) / 1e9,
        tokenAmount: Number(p.token_amount) / 1e6,
        user: p.user || '',
        timestampMs: Number(p.ts),
        price,
        txDigest: e.id?.txDigest ?? '',
      }
    })
  } catch (e) {
    console.error('fetchPoolTrades error:', e)
    return []
  }
}

// Denylist — hide test/unwanted tokens. New tokens show automatically unless added here.
const HIDDEN_TOKENS = new Set([
  '0x57acced890472772e1e3666bdd8f38f88dc9a0d396a8fe41fefa4e91b7efb522::coin_template::COIN_TEMPLATE',  // HOPE
  '0x3bd8425120777a205d5614e0dd9dc19af4f6a640ba6e1680a8248105571c23bb::gong::GONG',                    // GONG (dugong)
  '0xea74f2de7715217eabcacbc7d3c9661bae66c9dc7abc57bc2087924e81d9ed05::coin_template::COIN_TEMPLATE',  // LEGEND
  '0xd5a3eca34b5776ee75a4725bbd3259156189b1bacf828668d29301035ea5fc56::coin_template::COIN_TEMPLATE',  // BIGFOOT
  '0xad7e107830dd3826ce92f9d7025db3b589141ea740a7563c408c6af27203229f::bob__________::BOB__________',  // BOB
  '0x4129a8f1319a89367c844bceeb4e9f64f4406f58aa644b0f647b4df067e56480::genos::GENOS',                  // GENOS
  '0x68a85f4e978f28d174b96fb540cd2d6560c25de9fed8416892ae0d87ea6956fb::saitama::SAITAMA',              // SAITAMA
  '0x517fa7b4b2ef37c5f9fadb23ef02bee83a3e0c65e6d352c99c72274cc0372e4d::opm::OPM',                      // OPM
  '0x64da6249e484247e56331c0b7c4edfced821188d15fd9784bc11950d4e2d0fb1::sword::SWORD',                   // SWORD
  '0x2e9d593c61ae85792a32244d974169e2d9ff09ed8eec57e3e88bd2773eb84d2c::dulce::DULCE',                   // DULCE (duplicate)
  '0x5b5d441190e4fb43735f23dbc4b329c96e996a0beb53a5993a6e052e3adbf83e::shine::SHINE',                   // SHINE
  '0xcf7eeb3d4fc53529996e8903e739cb703528e9b60dd07405b2a3d65afb29d3ee::nav::NAV',                       // NAV
  '0x77b8fd2ad820cc3602c7d81e36e5a19e6c7af584d5a5dffb9b47a705b1d64fba::suixseven::SUIXSEVEN',           // SUIXSEVEN (test launch)
  '0x600cadec5c80e8bfe3d5d0823a2ca7bb9b2c1ba6d422763cb1f1b98e7b6cf8ec::fym::FYM',
  '0xd7a3fdf8c6e4bb7625fdb6fbbaaa28557fd9deeb55ef77aaebcab3f12a2cc156::nrdac::NRDAC',
  '0xac79fcb64b6811791450242436cf2da244d29e364f3b9eb93128610c5c4394e4::fbt::FBT',
  '0x639b32dfd2ce83b9218343caa7164c21ade89f886dcc98d14d15ff4a74679fc8::sxbt::SXBT',
  '0xb49de3fd424e6d4ebb96ade8b30e150a29d17bb8a841239129a3ab1c708f6751::tstc::TSTC',
  '0x2a90398d315ab871a0ebfa610d3d8b2a45236c2f7bbe9191276556572079086a::dhrtlmrt::DHRTLMRT',
  '0x508abe5fb919bf276eab41eceada797dbb61d57254258ab26499d05e3990170f::guy::GUY',
  '0x2dca63e8c5d1b60e0c940f406f1e4d2429d083964c44c9722815cbc3eeab7a25::ball::BALL',
  '0xeeb0e41bd5d8525020065a50c811b42a001547a720419e230612404951639009::fo100sb::FO100SB',
  '0x3321c0c105d58208bc7916594b889137c9f86abb79401be7e68db972ec7e4eed::fbtts::FBTTS',
  '0x286576735b5751251f62ab6e35a34230601a825dc85e2625701baf5db6ca23eb::flbt::FLBT',
  '0x1f92292041c50df7b64f770d2c97215919ca8c3ac3b11efa22b3c25733367889::iwfe::IWFE',
  '0x24a3db3b1086bf8cf49043e5aabb10d6ce04970aa7405af9f5c81d41a763f4af::tfe::TFE',
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
  '0x9fca52d98e7ff59d45f2063e42d2b6062b4d5701c79db77da88c97e4fb1942de::tonyfucker::TONYFUCKER',
])

export async function fetchAllPoolTokens(): Promise<PoolToken[]> {
  try {
    const now = Date.now()
    const ONE_HOUR_MS = 60 * 60 * 1000
    const TWENTYFOUR_HOURS_MS = 24 * ONE_HOUR_MS

    // Fetch created + trade events from EVERY known package namespace in
    // parallel. v11 is a fresh publish (not an upgrade of the legacy
    // chain), so its events live under a separate namespace and must be
    // queried independently.
    const eventRequests = EVENT_SOURCE_PACKAGES.flatMap(pkg => [
      fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 4,
          method: 'suix_queryEvents',
          params: [
            { MoveEventType: `${pkg}::moonbags::CreatedEventV2` },
            null, 200, true
          ]
        })
      }).then(r => r.json()).catch(() => ({ result: { data: [] } })),
      fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 5,
          method: 'suix_queryEvents',
          params: [
            { MoveEventType: `${pkg}::moonbags::TradedEventV2` },
            null, 100, false
          ]
        })
      }).then(r => r.json()).catch(() => ({ result: { data: [] } })),
    ])
    const eventResults = await Promise.all(eventRequests)

    // eventResults is interleaved [created_pkgA, trades_pkgA, created_pkgB, trades_pkgB, ...]
    const events: any[] = []
    const allTrades: any[] = []
    for (let i = 0; i < eventResults.length; i += 2) {
      events.push(...(eventResults[i]?.result?.data || []))
      allTrades.push(...(eventResults[i + 1]?.result?.data || []))
    }

    // Build per-pool trade maps for volume/price stats
    const tradesByPool = new Map<string, any[]>()
    for (const e of allTrades) {
      const poolId = e.parsedJson?.pool_id
      if (!poolId) continue
      if (!tradesByPool.has(poolId)) tradesByPool.set(poolId, [])
      tradesByPool.get(poolId)!.push(e.parsedJson)
    }

    // Fetch SUI and AIDA prices once for all market cap calculations
    const [suiPriceUsd, aidaPriceUsd] = await Promise.all([
      fetchSuiPriceUsd(),
      fetchAidaPriceUsd(),
    ])

    const tokens: (PoolToken | null)[] = await Promise.all(
      events.map(async (e: any) => {
        const meta = e.parsedJson
        const poolId = meta.pool_id

        const poolRes = await fetch(RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'sui_getObject',
            params: [poolId, { showContent: true, showType: true }]
          })
        })
        const poolJson = await poolRes.json()
        const poolData = poolJson.result?.data
        if (!poolData) return null

        const f = poolData.content.fields
        const typeStr: string = poolData.content.type || ''
        const coinTypeMatch = typeStr.match(/Pool<(.+)>/)
        const coinType = coinTypeMatch ? coinTypeMatch[1] : ''
        const moonbagsPackageId = typeStr.split('::')[0] || ''
        const pairType = getPairType(moonbagsPackageId)
        const quotePriceUsd = pairType === 'AIDA' ? aidaPriceUsd : suiPriceUsd

        const virtualSui   = BigInt(f.virtual_sui_reserves)
        const virtualToken = BigInt(f.virtual_token_reserves)
        const realSuiMist  = BigInt(f.real_sui_reserves.fields.balance)
        const thresholdMist = BigInt(f.threshold)
        const isCompleted  = f.is_completed
        const remainTokenRaw = BigInt(f.remain_token_reserves?.fields?.balance || '0')

        const price       = Number(virtualSui) / 1e9 / (Number(virtualToken) / 1e6)
        const realSuiSui  = Number(realSuiMist) / 1e9
        const thresholdSui = Number(thresholdMist) / 1e9
        const progress = isCompleted
         ? 100
         : thresholdMist > 0n ? (Number(realSuiMist) / Number(thresholdMist)) * 100 : 0
        // Post-graduation on-chain balance is zero — fall back to 1B standard launch supply.
        const totalSupply = remainTokenRaw > 0n ? Number(remainTokenRaw) / 1e6 : 1_000_000_000

        // Compute volume1h and priceChange24h from trade events
        const poolTrades = tradesByPool.get(poolId) ?? []
        let volume1h = 0
        let price24hAgo = 0
        let closestDiff = Infinity

        for (const t of poolTrades) {
          const ts = Number(t.ts)
          const age = now - ts
          if (age <= ONE_HOUR_MS) {
            volume1h += Number(t.sui_amount) / 1e9
          }
          // Find the trade closest to 24h ago for price comparison
          const diff = Math.abs(age - TWENTYFOUR_HOURS_MS)
          if (diff < closestDiff) {
            closestDiff = diff
            const vSui = Number(t.virtual_sui_reserves)
            const vTok = Number(t.virtual_token_reserves)
            price24hAgo = vTok > 0 ? (vSui / 1e9) / (vTok / 1e6) : 0
          }
        }

        const priceChange24h = price24hAgo > 0
          ? ((price - price24hAgo) / price24hAgo) * 100
          : 0

        const creator = meta.created_by || ''
        const createdAt = e.timestampMs || now
        const ageMs = now - createdAt
        let age = ''
        if (ageMs < 60000) age = `${Math.floor(ageMs / 1000)}s`
        else if (ageMs < 3600000) age = `${Math.floor(ageMs / 60000)}m`
        else if (ageMs < 86400000) age = `${Math.floor(ageMs / 3600000)}h`
        else age = `${Math.floor(ageMs / 86400000)}d`

        return {
          poolId,
          id: poolId,
          name: meta.name,
          symbol: meta.symbol,
          description: meta.description || '',
          imageUrl: meta.uri || '',
          logoUrl: meta.uri || '',
          twitter: meta.twitter || '',
          telegram: meta.telegram || '',
          website: meta.website || '',
          streamUrl: await fetchStreamUrl(poolId),
          creator,
          creatorShort: `${creator.slice(0, 6)}...${creator.slice(-4)}`,
          creatorFull: creator,
          currentPrice: price,
          realSuiRaised: realSuiSui,
          threshold: thresholdSui,
          progress: Math.min(100, progress),
          bondingProgress: Math.min(100, progress),
          marketCap: price * totalSupply * quotePriceUsd,
          totalSupply,
          isCompleted,
          virtualSuiReserves: virtualSui,
          virtualTokenReserves: virtualToken,
          coinType,
          moonbagsPackageId,
          pairType,
          volume1h,
          priceChange24h,
          age,
          isAiLaunched: await isTokenAnAiAgent(coinType),
          agentVolume24h: undefined,
        } as PoolToken
      })
    )

    return tokens
      .filter((t): t is PoolToken => t !== null)
      .filter(t => !HIDDEN_TOKENS.has(t.coinType))
  } catch (e) {
    console.error('fetchAllPoolTokens error:', e)
    return []
  }
}


