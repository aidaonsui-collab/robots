// ──────────────────────────────────────────────────────────────────────────────
// Presale — types and on-chain data fetching
//
// Reads presale objects by querying PresaleCreatedEvent events on-chain,
// then fetching each Presale shared object for live state.
// ──────────────────────────────────────────────────────────────────────────────

import { fetchSuiPriceUsd } from './tokens'

const RPC = 'https://fullnode.mainnet.sui.io'

// Deployed 2026-04-14 — v8: 32-field struct (removed fee_balance, tokens_burned, telegram, website from struct)
export const PRESALE_PACKAGE_ID = (process.env.NEXT_PUBLIC_PRESALE_PACKAGE_ID || '0x4c9f2fe6a524873adea66ff6f31d6caba0df10d10ffd8b28e99d0b8e26eabc76').trim()

// All known presale package IDs (current + previous deploys) for event discovery
const PRESALE_ALL_PACKAGES: readonly string[] = [
  '0x4c9f2fe6a524873adea66ff6f31d6caba0df10d10ffd8b28e99d0b8e26eabc76', // v8 (32-field struct, telegram+website in event)
  '0xd35d85f2347cb6b3a913839d067f48852b824a1f18e8910aea7bf1ff1f944933', // v6 (team vesting, burn-on-fail, admin cancel, 20 SUI fee)
  '0x10bc92bae029c96b484447fb367fc38d7207580d79049cdf22d7f2c768887283', // v5 (no contribution fee, verified)
  '0xfd93d109c5045a5095d895af332fd377a44114e775e8d48109f00b483cce2b1e', // v4 (had contribution fee bug on-chain)
  '0x7418205d6fb7c9493dcb7fdd12cea7de92737560fef1c741016bd151d7558c0f', // v3
  '0x98c139f5735c34c101121a1542ebf0f76697391571e8bc62e59cdf866afabb2c', // v2
  '0xca1a16f85e69d0c990cd393ecfc23c0ed375a55c5b125a18828157b8692c0225', // v1
] as const

// Token types that should never appear in the UI (test mints, duplicate deploys, etc.)
const HIDDEN_TOKEN_TYPES = new Set([
  '0xbdc4ed021b2409c0a0c3c0312232d7f892f79d811c4d77abd9c732c36d37187a::spartans::SPARTANS',
  '0x832293e2cbb370fe3d31c0e9764f63d640eb3e72aeb1e564f41cf39b327cbd9f::spartans::SPARTANS',
  '0x61858a884c0389a8290d21b82c19cf8059b1b83d3fc7502b8b93a527c7c213fe::spartans::SPARTANS',
  '0xca317d52a62681dba855eb06042545379e803f28296bcf79eb79d363ccaaa6d3::spartans::SPARTANS',
  '0x093eeea432571cdb10e9aa7c61c6ad90065cc306d56dadc9f809b8954b0d2423::spartans::SPARTANS',
  '0xa092811148f2c37b0b7ea3e45ef8d49081a393290108d09c85e6346ee02f1e20::spartans::SPARTANS',
])

// Status codes (match Move contract)
export const PRESALE_STATUS = {
  PENDING: 0,
  ACTIVE: 1,
  SUCCESS: 2,
  FAILED: 3,
  MIGRATED: 4,
  CANCELLED: 5,
} as const

export type PresaleStatus = typeof PRESALE_STATUS[keyof typeof PRESALE_STATUS]

export interface PresaleToken {
  id: string                // presale object ID
  packageId: string         // package that owns this presale object
  creator: string
  name: string
  symbol: string
  imageUrl: string
  description: string
  twitter: string
  telegram: string
  website: string
  tokenAddress: string
  tokenType: string           // full Move type e.g. "0xPKG::module::TYPE"
  // Presale params
  pricePerTokenMist: number
  pricePerTokenSui: number
  minRaiseMist: number
  maxRaiseMist: number
  minRaiseSui: number
  maxRaiseSui: number
  maxPerWalletMist: number
  maxPerWalletSui: number
  startTimeMs: number
  endTimeMs: number
  tokenDecimals: number
  presaleBps: number
  liquidityBps: number
  teamBps: number
  creatorBps: number
  creatorSuiBps: number        // % of raised SUI to creator wallet at migration (0 = all to DEX)
  // Team vesting
  teamWallet: string
  teamCliffMs: number
  teamVestingEndMs: number
  teamTokenSupply: number       // tokens still locked in contract (0 if no team or already released)
  // Creator vesting
  creatorCliffMs: number
  creatorVestingEndMs: number
  // Flags
  tokensBurned: boolean
  // Live state
  totalRaisedMist: number
  totalRaisedSui: number
  totalRaisedUsd: number
  presaleTokenSupply: number
  liquidityTokenSupply: number
  creatorTokenSupply: number
  contributorCount: number
  status: PresaleStatus
  // Computed
  progress: number          // 0-100 (raised / maxRaise * 100)
  timeRemaining: number     // ms until end (0 if ended)
  isActive: boolean
  isPending: boolean
  isSuccess: boolean
  isFailed: boolean
  isMigrated: boolean
  isCancelled: boolean
  hasEnded: boolean         // time expired but not yet finalized
  createdAt: number
}

async function rpcCall(method: string, params: any[]) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const json = await res.json()
  return json.result
}

async function queryEvents(eventType: string, limit: number, descending: boolean) {
  const result = await rpcCall('suix_queryEvents', [
    { MoveEventType: eventType },
    null,
    limit,
    descending,
  ])
  return result?.data || []
}

/** Fetch all presale objects from on-chain events. */
export async function fetchAllPresales(): Promise<PresaleToken[]> {
  if (!PRESALE_PACKAGE_ID) return []

  const suiPriceUsd = await fetchSuiPriceUsd()
  const now = Date.now()

  // Query PresaleCreatedEvent from all known packages to discover all presales
  const eventArrays = await Promise.all(
    PRESALE_ALL_PACKAGES.map(pkg =>
      queryEvents(`${pkg}::presale::PresaleCreatedEvent`, 50, true)
    )
  )

  // Also batch-fetch PresaleMigratingEvent to recover historical sui_raised
  // for MIGRATED presales (withdraw_for_migration drains the live balance to 0)
  const migratingArrays = await Promise.all(
    PRESALE_ALL_PACKAGES.map(pkg =>
      queryEvents(`${pkg}::presale::PresaleMigratingEvent`, 50, true).catch(() => [] as any[])
    )
  )
  const migratingById = new Map<string, { suiAmount: number; tokenAmount: number }>()
  for (const arr of migratingArrays) {
    for (const ev of arr) {
      const p = ev.parsedJson
      if (p?.presale_id && !migratingById.has(p.presale_id)) {
        migratingById.set(p.presale_id, {
          suiAmount: Number(p.sui_amount || '0'),
          tokenAmount: Number(p.token_amount || '0'),
        })
      }
    }
  }
  // Merge and deduplicate by presale_id
  const seenIds = new Set<string>()
  const events: any[] = []
  for (const arr of eventArrays) {
    for (const e of arr) {
      const id = e.parsedJson?.presale_id
      if (id && !seenIds.has(id)) {
        seenIds.add(id)
        events.push(e)
      }
    }
  }

  const presales = await Promise.all(
    events
      // Filter out hidden token types before fetching on-chain state
      .filter((e: any) => {
        const addr = e.parsedJson?.token_address
        if (!addr) return true
        // token_address in the event is the raw type_name string (may lack 0x prefix)
        const normalised = addr.startsWith('0x') ? addr : `0x${addr}`
        return !HIDDEN_TOKEN_TYPES.has(normalised)
      })
      .map(async (e: any) => {
      const meta = e.parsedJson
      if (!meta) return null

      const presaleId = meta.presale_id
      if (!presaleId) return null

      // Fetch live presale object state
      const objRes = await rpcCall('sui_getObject', [
        presaleId,
        { showContent: true, showType: true },
      ])

      const objData = objRes?.data
      if (!objData?.content?.fields) return null

      // Extract package ID and full token type from object type
      // Type format: "0xPKG::presale::Presale<0xTOKEN_PKG::module::TYPE>"
      const objType: string = objData.content?.type || objData.type || ''
      const objPackageId = objType.split('::')[0] || PRESALE_PACKAGE_ID
      // Extract token type from generic angle brackets
      const typeMatch = objType.match(/<(.+)>$/)
      const tokenType = typeMatch ? typeMatch[1] : ''

      const f = objData.content.fields

      const liveSuiRaised = Number(f.sui_raised?.fields?.balance || f.sui_raised || '0')
      // For MIGRATED presales, sui_raised is drained to 0 by withdraw_for_migration.
      // Recover the historical amount from the PresaleMigratingEvent.
      const migratingData = migratingById.get(presaleId)
      const totalRaisedMist = liveSuiRaised > 0
        ? liveSuiRaised
        : (migratingData?.suiAmount ?? 0)
      const maxRaiseMist = Number(f.max_raise_mist || '0')
      const minRaiseMist = Number(f.min_raise_mist || '0')
      const pricePerTokenMist = Number(f.price_per_token_mist || '0')
      const startTimeMs = Number(f.start_time_ms || '0')
      const endTimeMs = Number(f.end_time_ms || '0')
      const maxPerWalletMist = Number(f.max_per_wallet_mist || '0')
      const status = Number(f.status || '0') as PresaleStatus
      const contributorCount = Number(f.contributor_count || '0')
      const presaleBps = Number(f.presale_bps || '0')
      const liquidityBps = Number(f.liquidity_bps || '0')
      const teamBps = Number(f.team_bps || '0')
      const creatorBps = 10000 - presaleBps - liquidityBps - teamBps
      const creatorSuiBps = Number(f.creator_sui_bps || '0')
      const tokenDecimals = Number(f.token_decimals || '6')

      const presaleTokenSupply = Number(f.presale_tokens?.fields?.balance || '0') / 10 ** tokenDecimals
      const liquidityTokenSupply = Number(f.liquidity_tokens?.fields?.balance || '0') / 10 ** tokenDecimals
      const creatorTokenSupply = Number(f.creator_tokens?.fields?.balance || '0') / 10 ** tokenDecimals
      const teamTokenSupply = Number(f.team_tokens?.fields?.balance || '0') / 10 ** tokenDecimals

      const teamWallet = f.team_wallet || ''
      const teamCliffMs = Number(f.team_cliff_ms || '0')
      const teamVestingEndMs = Number(f.team_vesting_end_ms || '0')
      const creatorCliffMs = Number(f.creator_cliff_ms || '0')
      const creatorVestingEndMs = Number(f.creator_vesting_end_ms || '0')
      // tokens_burned field removed in v8 struct — derive from balances
      const tokensBurned = (status === PRESALE_STATUS.FAILED || status === PRESALE_STATUS.CANCELLED) &&
        presaleTokenSupply === 0 && liquidityTokenSupply === 0 && teamTokenSupply === 0 && creatorTokenSupply === 0

      const totalRaisedSui = totalRaisedMist / 1e9
      const maxRaiseSui = maxRaiseMist / 1e9
      const minRaiseSui = minRaiseMist / 1e9
      const maxPerWalletSui = maxPerWalletMist / 1e9
      const pricePerTokenSui = pricePerTokenMist / 1e9
      const progress = maxRaiseMist > 0 ? (totalRaisedMist / maxRaiseMist) * 100 : 0
      const timeRemaining = Math.max(0, endTimeMs - now)

      const isEnded = now >= endTimeMs
      const isActive = !isEnded && (status === PRESALE_STATUS.ACTIVE || (status === PRESALE_STATUS.PENDING && now >= startTimeMs))
      const hasEnded = isEnded && (status === PRESALE_STATUS.ACTIVE || status === PRESALE_STATUS.PENDING)

      return {
        id: presaleId,
        packageId: objPackageId,
        creator: f.creator || meta.creator || '',
        name: f.name || meta.name || '',
        symbol: f.symbol || meta.symbol || '',
        imageUrl: f.uri || meta.uri || '',
        description: f.description || meta.description || '',
        twitter: f.twitter || meta.twitter || '',
        telegram: meta.telegram || f.telegram || '',
        website: meta.website || f.website || '',
        tokenAddress: f.token_address || meta.token_address || '',
        tokenType,
        pricePerTokenMist,
        pricePerTokenSui,
        minRaiseMist,
        maxRaiseMist,
        minRaiseSui,
        maxRaiseSui,
        maxPerWalletMist,
        maxPerWalletSui,
        startTimeMs,
        endTimeMs,
        tokenDecimals,
        presaleBps,
        liquidityBps,
        teamBps,
        creatorBps,
        creatorSuiBps,
        teamWallet,
        teamCliffMs,
        teamVestingEndMs,
        teamTokenSupply,
        creatorCliffMs,
        creatorVestingEndMs,
        tokensBurned,
        totalRaisedMist,
        totalRaisedSui,
        totalRaisedUsd: totalRaisedSui * suiPriceUsd,
        presaleTokenSupply,
        liquidityTokenSupply,
        creatorTokenSupply,
        contributorCount,
        status,
        progress: Math.min(100, progress),
        timeRemaining,
        isActive,
        isPending: status === PRESALE_STATUS.PENDING && now < startTimeMs,
        isSuccess: status === PRESALE_STATUS.SUCCESS,
        isFailed: status === PRESALE_STATUS.FAILED,
        isMigrated: status === PRESALE_STATUS.MIGRATED,
        isCancelled: status === PRESALE_STATUS.CANCELLED,
        hasEnded,
        createdAt: Number(meta.ts || '0'),
      } as PresaleToken
    })
  )

  // Filter out test presales by object ID
  const HIDDEN_PRESALE_IDS = new Set([
    '0xab1bc4a29e800c990f8918ceb54cd50fd69599e8fc7f02ad7bc2502f47738cb0',
    '0x6ef4092524979a81711d8d07b132d6911b5332d55035911a80031b7662dacc02',
  ])

  return presales.filter((p): p is PresaleToken =>
    p !== null &&
    !HIDDEN_PRESALE_IDS.has(p.id) &&
    !HIDDEN_TOKEN_TYPES.has(p.tokenType)
  )
}

/** Fetch a single presale by object ID. */
export async function fetchPresale(presaleId: string): Promise<PresaleToken | null> {
  const all = await fetchAllPresales()
  return all.find(p => p.id === presaleId) ?? null
}

/** Get a user's contribution to a presale via on-chain dynamic field read. */
export async function getUserContribution(presaleId: string, userAddress: string): Promise<number> {
  if (!presaleId || !userAddress) return 0

  try {
    // First, fetch the presale object to get the contributions Table ID
    const objRes = await rpcCall('sui_getObject', [
      presaleId,
      { showContent: true },
    ])
    const fields = objRes?.data?.content?.fields
    if (!fields) return 0

    // The contributions field is a Table<address, u64> — get its object ID
    const tableId = fields.contributions?.fields?.id?.id
    if (!tableId) return 0

    // Read dynamic field from the Table object (not the presale object)
    const result = await rpcCall('suix_getDynamicFieldObject', [
      tableId,
      { type: 'address', value: userAddress },
    ])
    return Number(result?.data?.content?.fields?.value || '0')
  } catch {
    return 0
  }
}
