import { NextResponse } from 'next/server'
import { createMomentumPool, type GraduationEvent } from '@/lib/momentum_aida'

export const dynamic = 'force-dynamic'

const RPC = 'https://fullnode.mainnet.sui.io'
const ORIGIN_PACKAGE_AIDA = '0x2156ceed0866b899840871add0efdae25799b2b22df1563922b5b01c011975a8'
const TOKEN_DECIMALS = 6
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
  } catch { return new Set() }
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

async function unmarkProcessed(eventId: string): Promise<void> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!redisUrl || !redisToken) return
  await fetch(`${redisUrl}/srem/${PROCESSED_KEY}/${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${redisToken}` },
    cache: 'no-store',
  })
}

export async function GET(req: Request) {
  // Fail-closed auth. Previously `if (cronSecret && …)` short-circuited the
  // check when the env var was unset, leaving an admin-signed endpoint open.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron/graduate] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 })
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.ADMIN_WALLET_SECRET) {
    return NextResponse.json({ error: 'ADMIN_WALLET_SECRET not configured' }, { status: 503 })
  }
  if (!process.env.MOMENTUM_PACKAGE_ID) {
    return NextResponse.json({ error: 'MOMENTUM_PACKAGE_ID not configured' }, { status: 503 })
  }

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'
  const tokenFilter = url.searchParams.get('token')

  const results: any[] = []
  const processed = force ? new Set<string>() : await getProcessedSet()
  const markedThisRun = new Set<string>()
  const isProcessed = (k: string) => processed.has(k) || markedThisRun.has(k)
  const markAndTrack = async (k: string) => { markedThisRun.add(k); await markProcessed(k) }

  try {
    const eventType = `${ORIGIN_PACKAGE_AIDA}::moonbags::PoolMigratingEvent`
    const data = await rpc('suix_queryEvents', [{ MoveEventType: eventType }, null, 50, true])
    const events = data?.data || []
    console.log(`[graduate] Found ${events.length} PoolMigratingEvent from AIDA package`)

    for (const ev of events) {
      const evId = ev.id as any
      const eventId = `${evId?.txDigest}:${evId?.eventSeq ?? 0}`
      const parsed = ev.parsedJson
      if (!parsed) continue

      const aidaRaw = BigInt(parsed.aida_amount ?? parsed.sui_amount ?? '0')
      const tokenType = parsed.token_address?.startsWith('0x')
        ? parsed.token_address
        : `0x${parsed.token_address}`

      if (tokenFilter) {
        if (tokenType !== tokenFilter && tokenType !== normalizePkg(tokenFilter)) continue
        await unmarkProcessed(eventId)
      } else if (isProcessed(eventId)) {
        continue
      }

      if (aidaRaw === 0n) {
        console.warn(`[graduate] Event ${eventId} has zero AIDA amount — skipping`)
        await markAndTrack(eventId)
        continue
      }

      const graduation: GraduationEvent = {
        tokenType,
        aidaAmount: aidaRaw,
        tokenAmount: BigInt(parsed.token_amount || '0'),
        tokenDecimals: TOKEN_DECIMALS,
        timestamp: Number(parsed.ts || '0'),
      }

      console.log(`[graduate] Graduating: ${graduation.tokenType}`)

      const poolResult = await createMomentumPool(graduation)

      results.push({
        eventId,
        tokenType: graduation.tokenType,
        aidaAmount: graduation.aidaAmount.toString(),
        tokenAmount: graduation.tokenAmount.toString(),
        pool: poolResult,
      })

      if (poolResult.success) {
        await markAndTrack(eventId)
        console.log(`[graduate] Graduated! Pool: ${poolResult.poolId}`)
      } else {
        console.error(`[graduate] Pool creation failed: ${poolResult.error}`)
      }
    }
  } catch (e: any) {
    console.error(`[graduate] Error:`, e.message)
    results.push({ error: e.message })
  }

  return NextResponse.json({
    processed: results.length,
    results,
    timestamp: new Date().toISOString(),
  })
}

function normalizePkg(tokenType: string): string {
  const parts = tokenType.split('::')
  if (parts.length < 3) return tokenType
  const addr = parts[0].startsWith('0x') ? parts[0] : `0x${parts[0]}`
  parts[0] = addr.slice(0, 2) + addr.slice(2).padStart(64, '0')
  return parts.join('::')
}
