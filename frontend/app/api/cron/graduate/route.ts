import { NextResponse } from 'next/server'
import { createMomentumPool, callPresaleWithdrawForMigration, type GraduationEvent } from '@/lib/momentum'

export const dynamic = 'force-dynamic'

const RPC = 'https://fullnode.mainnet.sui.io'

// Events are typed by the ORIGIN package (the first publish), not upgrades.
// v11 pools emit events typed against the v11 origin.
// Legacy pools emit against the legacy origin.
const V11_ORIGIN = '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813'
const LEGACY_ORIGIN = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'

// All known presale package IDs (current + previous deploys) for event discovery.
// Each presale version is a separate publish (not an upgrade), so events are
// typed by the specific package that created them.
const PRESALE_ALL_PACKAGES: readonly string[] = [
  '0x10bc92bae029c96b484447fb367fc38d7207580d79049cdf22d7f2c768887283', // v5 (no contribution fee, verified)
  '0xfd93d109c5045a5095d895af332fd377a44114e775e8d48109f00b483cce2b1e', // v4
  '0x7418205d6fb7c9493dcb7fdd12cea7de92737560fef1c741016bd151d7558c0f', // v3
  '0x98c139f5735c34c101121a1542ebf0f76697391571e8bc62e59cdf866afabb2c', // v2
  '0xca1a16f85e69d0c990cd393ecfc23c0ed375a55c5b125a18828157b8692c0225', // v1
] as const

// Test presales to skip during graduation
const HIDDEN_PRESALE_IDS = new Set([
  '0xab1bc4a29e800c990f8918ceb54cd50fd69599e8fc7f02ad7bc2502f47738cb0',
  '0x6ef4092524979a81711d8d07b132d6911b5332d55035911a80031b7662dacc02',
])

// Token decimals (all bonding curve tokens use 6 from the Configuration)
const TOKEN_DECIMALS = 6
// Platform fee: 2% taken from total raised SUI during withdraw_for_migration
const PLATFORM_FEE_BPS = 200
const FEE_DENOMINATOR = 10000

// Presale status codes (match Move contract)
const STATUS_SUCCESS = 2
const STATUS_MIGRATED = 4

// Redis key to track which graduation events we've already processed
const PROCESSED_KEY = 'graduation:processed'

async function rpc(method: string, params: any[]) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const j = await res.json()
  if (j.error) throw new Error(j.error.message)
  return j.result
}

async function getProcessedSet(): Promise<Set<string>> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!redisUrl || !redisToken) return new Set()

  try {
    const res = await fetch(`${redisUrl}/smembers/${PROCESSED_KEY}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
      cache: 'no-store',
    })
    const json = await res.json()
    return new Set(json.result || [])
  } catch {
    return new Set()
  }
}

async function markProcessed(eventId: string): Promise<void> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!redisUrl || !redisToken) return

  await fetch(`${redisUrl}/sadd/${PROCESSED_KEY}/${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${redisToken}` },
    cache: 'no-store',
  })
}

/**
 * Normalize a Move token type to include the 0x prefix.
 * type_name::into_string() in Move may omit the 0x prefix,
 * but the Momentum SDK and Sui RPC expect it.
 */
function normalizeTokenType(tokenType: string): string {
  if (!tokenType) return tokenType
  const parts = tokenType.split('::')
  if (parts.length >= 3 && !parts[0].startsWith('0x')) {
    parts[0] = `0x${parts[0]}`
  }
  return parts.join('::')
}

/**
 * GET /api/cron/graduate
 *
 * Three-phase graduation pipeline:
 *
 * Phase 1 — Presale auto-graduation:
 *   Polls PresaleFinalizedEvent for SUCCESS presales, calls
 *   withdraw_for_migration to send funds to admin wallet, then
 *   immediately creates a Momentum CLMM pool.
 *
 * Phase 2 — Presale manual migration:
 *   Polls PresaleMigratingEvent for cases where admin manually
 *   called withdraw_for_migration. Creates Momentum pool if not
 *   already handled by Phase 1.
 *
 * Phase 3 — Bonding curve migration:
 *   Polls PoolMigratingEvent from v11 and legacy origins.
 *   Creates Momentum pool for each graduated bonding curve token.
 *
 * Designed to be called by Vercel Cron (daily) or manually.
 * Idempotent — tracks processed events in Redis to avoid double-creation.
 */
export async function GET(req: Request) {
  // Optional auth for Vercel Cron
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.ADMIN_WALLET_SECRET) {
    return NextResponse.json({
      error: 'ADMIN_WALLET_SECRET not configured — graduation disabled',
    }, { status: 503 })
  }

  if (!process.env.MOMENTUM_PACKAGE_ID) {
    return NextResponse.json({
      error: 'MOMENTUM_PACKAGE_ID not configured — graduation disabled',
    }, { status: 503 })
  }

  const results: any[] = []
  const processed = await getProcessedSet()
  // Track keys marked during this run so Phase 2 sees Phase 1's marks immediately.
  // (processed is a snapshot from Redis taken before Phase 1 runs, so we must
  // maintain a local overlay to avoid processing the same presale in both phases.)
  const markedThisRun = new Set<string>()
  const isProcessed = (key: string) => processed.has(key) || markedThisRun.has(key)
  const markAndTrack = async (key: string) => {
    markedThisRun.add(key)
    await markProcessed(key)
  }

  // ── Phase 1: Presale auto-graduation ─────────────────────────
  // Find finalized (SUCCESS) presales that haven't been migrated yet.
  // Call withdraw_for_migration → then create Momentum pool immediately.
  for (const pkg of PRESALE_ALL_PACKAGES) {
    try {
      const eventType = `${pkg}::presale::PresaleFinalizedEvent`
      const data = await rpc('suix_queryEvents', [
        { MoveEventType: eventType },
        null,
        50,
        true,
      ])

      const events = data?.data || []

      for (const ev of events) {
        const parsed = ev.parsedJson
        if (!parsed) continue
        if (Number(parsed.status) !== STATUS_SUCCESS) continue

        const presaleId = parsed.presale_id
        if (!presaleId) continue
        if (HIDDEN_PRESALE_IDS.has(presaleId)) continue

        const graduatedKey = `presale-graduated:${presaleId}`
        if (isProcessed(graduatedKey)) continue

        // Fetch live presale object to check current status and get token type
        const objRes = await rpc('sui_getObject', [
          presaleId,
          { showContent: true, showType: true },
        ])

        const objData = objRes?.data
        if (!objData?.content?.fields) continue

        const fields = objData.content.fields
        const currentStatus = Number(fields.status || '0')

        // Already migrated — mark processed and skip
        if (currentStatus === STATUS_MIGRATED) {
          await markAndTrack(graduatedKey)
          continue
        }
        // Not in SUCCESS state — skip (might be FAILED or still ACTIVE)
        if (currentStatus !== STATUS_SUCCESS) continue

        // Extract full token type from object type:
        // "0xPKG::presale::Presale<0xTOKEN_PKG::module::TYPE>"
        const objType: string = objData.content?.type || objData.type || ''
        const typeMatch = objType.match(/<(.+)>$/)
        const tokenType = typeMatch ? typeMatch[1] : ''
        if (!tokenType) {
          console.error(`[graduate] Cannot extract token type from presale ${presaleId}: ${objType}`)
          continue
        }

        const objPackageId = objType.split('::')[0] || pkg
        const normalizedTokenType = normalizeTokenType(tokenType)

        // Read amounts BEFORE withdrawal drains them
        const totalRaisedMist = Number(fields.sui_raised?.fields?.balance || fields.sui_raised || '0')
        const liquidityTokenAmount = Number(fields.liquidity_tokens?.fields?.balance || '0')
        const tokenDec = Number(fields.token_decimals || '6')

        if (totalRaisedMist === 0 || liquidityTokenAmount === 0) {
          console.error(`[graduate] Presale ${presaleId} has zero balances — skipping`)
          continue
        }

        console.log(`[graduate] Auto-graduating presale ${presaleId}`)
        console.log(`  token:     ${normalizedTokenType}`)
        console.log(`  raised:    ${totalRaisedMist / 1e9} SUI`)
        console.log(`  liq tokens: ${liquidityTokenAmount / 10 ** tokenDec}`)

        // Step 1: Call withdraw_for_migration on-chain
        const withdrawResult = await callPresaleWithdrawForMigration(
          presaleId,
          objPackageId,
          normalizedTokenType,
        )

        if (!withdrawResult.success) {
          console.error(`[graduate] Withdraw failed for ${presaleId}: ${withdrawResult.error}`)
          results.push({
            source: 'presale-auto-withdraw',
            presaleId,
            error: withdrawResult.error,
          })
          // Don't mark processed — retry on next cron cycle
          continue
        }

        // Step 2: Create Momentum pool immediately
        // Admin received totalRaised minus 2% platform fee
        const platformFee = Math.floor(totalRaisedMist * PLATFORM_FEE_BPS / FEE_DENOMINATOR)
        const suiForPool = totalRaisedMist - platformFee

        const graduation: GraduationEvent = {
          tokenType: normalizedTokenType,
          suiAmount: BigInt(suiForPool),
          tokenAmount: BigInt(liquidityTokenAmount),
          tokenDecimals: tokenDec,
          timestamp: Date.now(),
        }

        console.log(`[graduate] Creating Momentum pool for presale ${presaleId}`)
        console.log(`  SUI (post-fee): ${suiForPool / 1e9}`)

        const poolResult = await createMomentumPool(graduation)

        results.push({
          source: 'presale-auto-graduate',
          presaleId,
          tokenType: normalizedTokenType,
          suiAmount: suiForPool.toString(),
          tokenAmount: liquidityTokenAmount.toString(),
          withdrawDigest: withdrawResult.digest,
          pool: poolResult,
        })

        if (!poolResult.success) {
          // Do NOT mark as processed — Phase 2 can retry via PresaleMigratingEvent
          console.error(`[graduate] Pool creation failed for ${presaleId}: ${poolResult.error}`)
        } else {
          await markAndTrack(graduatedKey)
          console.log(`[graduate] Presale ${presaleId} graduated successfully!`)
        }
      }
    } catch (e: any) {
      console.error(`[graduate] Error in presale auto-graduation from ${pkg.slice(0, 10)}...: ${e.message}`)
      results.push({ source: 'presale-auto-graduate', pkg, error: e.message })
    }
  }

  // ── Phase 2: Presale manual migration events ─────────────────
  // Handles cases where admin manually called withdraw_for_migration
  // and Phase 1 didn't catch it (e.g., cron was down during finalize).
  for (const pkg of PRESALE_ALL_PACKAGES) {
    try {
      const eventType = `${pkg}::presale::PresaleMigratingEvent`
      const data = await rpc('suix_queryEvents', [
        { MoveEventType: eventType },
        null,
        50,
        true,
      ])

      const events = data?.data || []
      if (events.length > 0) {
        console.log(`[graduate] Found ${events.length} PresaleMigratingEvent from ${pkg.slice(0, 10)}...`)
      }

      for (const ev of events) {
        const eventId = `presale:${ev.id?.txDigest}:${ev.id?.eventSeq ?? 0}`
        if (isProcessed(eventId)) continue

        const parsed = ev.parsedJson
        if (!parsed) continue

        const presaleId = parsed.presale_id
        if (presaleId && HIDDEN_PRESALE_IDS.has(presaleId)) {
          await markAndTrack(eventId)
          continue
        }

        // Skip if already graduated via Phase 1 (checks both Redis snapshot and this-run marks)
        if (presaleId) {
          const graduatedKey = `presale-graduated:${presaleId}`
          if (isProcessed(graduatedKey)) {
            await markAndTrack(eventId)
            continue
          }
        }

        // Normalize token type (type_name::into_string may omit 0x prefix)
        const tokenAddr = normalizeTokenType(parsed.token_address || '')

        // Event sui_amount is pre-fee — adjust for 2% platform fee
        const rawSuiAmount = BigInt(parsed.sui_amount || '0')
        const platformFee = rawSuiAmount * BigInt(PLATFORM_FEE_BPS) / BigInt(FEE_DENOMINATOR)
        const suiForPool = rawSuiAmount - platformFee

        const graduation: GraduationEvent = {
          tokenType: tokenAddr,
          suiAmount: suiForPool,
          tokenAmount: BigInt(parsed.token_amount || '0'),
          tokenDecimals: TOKEN_DECIMALS,
          timestamp: Number(parsed.ts || '0'),
        }

        console.log(`[graduate] Presale migration event: ${graduation.tokenType}`)
        console.log(`  SUI (post-fee): ${Number(graduation.suiAmount) / 1e9}`)
        console.log(`  Tokens: ${Number(graduation.tokenAmount) / 10 ** TOKEN_DECIMALS}`)

        const poolResult = await createMomentumPool(graduation)

        results.push({
          eventId,
          source: 'olympus-presale',
          tokenType: graduation.tokenType,
          suiAmount: graduation.suiAmount.toString(),
          tokenAmount: graduation.tokenAmount.toString(),
          pool: poolResult,
        })

        await markAndTrack(eventId)

        // Also mark the presale as graduated so Phase 1 doesn't retry
        if (presaleId) {
          await markAndTrack(`presale-graduated:${presaleId}`)
        }

        if (!poolResult.success) {
          console.error(`[graduate] Pool creation failed for ${graduation.tokenType}: ${poolResult.error}`)
        }
      }
    } catch (e: any) {
      console.error(`[graduate] Error querying presale events from ${pkg.slice(0, 10)}...: ${e.message}`)
      results.push({ source: 'olympus-presale', pkg, error: e.message })
    }
  }

  // ── Phase 3: Bonding curve migrations ────────────────────────
  // Query graduation events from both v11 and legacy origins
  for (const origin of [V11_ORIGIN, LEGACY_ORIGIN]) {
    try {
      const eventType = `${origin}::moonbags::PoolMigratingEvent`
      const data = await rpc('suix_queryEvents', [
        { MoveEventType: eventType },
        null,
        50,    // last 50 events
        true,  // descending (newest first)
      ])

      const events = data?.data || []
      console.log(`[graduate] Found ${events.length} PoolMigratingEvent from ${origin.slice(0, 10)}...`)

      for (const ev of events) {
        // Unique ID: tx digest + event index
        const eventId = `${ev.id?.txDigest}:${ev.id?.eventSeq ?? 0}`

        if (isProcessed(eventId)) {
          continue // already handled
        }

        const parsed = ev.parsedJson
        if (!parsed) continue

        const graduation: GraduationEvent = {
          tokenType: parsed.token_address,
          suiAmount: BigInt(parsed.sui_amount),
          tokenAmount: BigInt(parsed.token_amount),
          tokenDecimals: TOKEN_DECIMALS,
          timestamp: Number(parsed.ts),
        }

        console.log(`[graduate] New graduation: ${graduation.tokenType}`)
        console.log(`  SUI: ${Number(graduation.suiAmount) / 1e9}`)
        console.log(`  Tokens: ${Number(graduation.tokenAmount) / 10 ** TOKEN_DECIMALS}`)

        // Create the Momentum pool
        const poolResult = await createMomentumPool(graduation)

        results.push({
          eventId,
          tokenType: graduation.tokenType,
          suiAmount: graduation.suiAmount.toString(),
          tokenAmount: graduation.tokenAmount.toString(),
          pool: poolResult,
        })

        // Mark as processed regardless of success/failure to avoid retry loops.
        // Failed graduations should be investigated manually.
        await markAndTrack(eventId)

        if (!poolResult.success) {
          console.error(`[graduate] Pool creation failed for ${graduation.tokenType}: ${poolResult.error}`)
        }
      }
    } catch (e: any) {
      console.error(`[graduate] Error querying events from ${origin}: ${e.message}`)
      results.push({ origin, error: e.message })
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
    timestamp: new Date().toISOString(),
  })
}
