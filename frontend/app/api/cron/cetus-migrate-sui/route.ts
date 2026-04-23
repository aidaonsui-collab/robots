import { NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import {
  createCetusPoolForLegacySui,
  type SuiGraduationEvent,
  type CetusPoolCreationResult,
} from '@/lib/cetus_sui_migrator'
import { MOONBAGS_LEGACY_PACKAGE_IDS } from '@/lib/contracts'

// Cetus auto-migration cron for LEGACY SUI-pair bonding pools.
//
// Historically legacy moonbags SUI packages (V11, V12_PREV, V12_CURRENT
// etc.) ended graduation by dumping everything to the admin wallet —
// no on-chain DEX routing — and a human or the `createMomentumPool`
// path in `lib/momentum.ts` would manually pick a target DEX. This
// cron replaces that manual step with auto-migration to Cetus, so every
// legacy SUI pair that graduates from here forward lands a Coin<T, SUI>
// Cetus pool + burned LP position.
//
// V13/V14 SUI pairs auto-migrate INLINE in the buy tx that fills the
// curve (transfer_pool → init_cetus_pool), so those are not re-handled
// here — we skip their PoolMigratingEvent entries to avoid
// double-processing.
//
// Env vars mirror the AIDA cron:
//   ADMIN_WALLET_SECRET — admin keypair
//   CRON_SECRET         — optional Bearer auth

export const dynamic = 'force-dynamic'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'

// Legacy event-emitting packages. Sui pins event types to the module's
// original-id across upgrades, so we watch each publish's origin here.
// V7 root is the upgrade chain; V11/V12_PREV/V12_CURRENT are fresh
// publishes each with their own type signatures. V13/V14 intentionally
// excluded (they auto-migrate inline).
const LEGACY_EVENT_PACKAGES = MOONBAGS_LEGACY_PACKAGE_IDS

// Cursor (per-package) in Vercel KV.
const KV_CURSOR_KEY_PREFIX = 'cetus-migrate-sui:cursor:'

// Don't replay ancient graduations on first deploy.
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000 // 24h

// Upper bound on how many events we process per invocation so a huge
// backlog doesn't blow the Vercel function timeout.
const MAX_PAGES_PER_PKG = 5

async function rpc<T = any>(method: string, params: any[]): Promise<T> {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const j = await res.json()
  if (j.error) throw new Error(`${method}: ${j.error.message}`)
  return j.result
}

interface Pending {
  event: SuiGraduationEvent
  eventDigest: string
  eventPkg: string
}

// Parse a PoolMigratingEvent into a SuiGraduationEvent. The legacy event
// shape: {token_address, sui_amount, token_amount, ts, ...}. We derive
// `tokenType` by prepending 0x, and assume 6-decimal tokens (the
// platform default for every moonbags-launched coin — see TOKEN_DECIMALS
// in coins/create/page.tsx).
function toGraduationEvent(e: any, eventPkg: string): Pending | null {
  const pj = e?.parsedJson || {}
  const tokenTypeRaw: string = pj.token_address || ''
  if (!tokenTypeRaw) return null
  const tokenType = tokenTypeRaw.startsWith('0x') ? tokenTypeRaw : `0x${tokenTypeRaw}`
  const suiAmount = BigInt(pj.sui_amount ?? 0)
  const tokenAmount = BigInt(pj.token_amount ?? 0)
  const timestamp = Number(pj.ts ?? e.timestampMs ?? 0)
  return {
    event: { tokenType, suiAmount, tokenAmount, tokenDecimals: 6, timestamp },
    eventDigest: e.id?.txDigest || '',
    eventPkg,
  }
}

async function fetchPendingForPackage(pkg: string, cursor: any): Promise<{ pending: Pending[]; nextCursor: any; hasNextPage: boolean }> {
  const data = await rpc<any>('suix_queryEvents', [
    { MoveEventType: `${pkg}::moonbags::PoolMigratingEvent` },
    cursor,
    50,
    false, // ascending so we process oldest-first
  ])
  const events: any[] = data?.data || []
  const pending: Pending[] = []
  const now = Date.now()
  for (const e of events) {
    const p = toGraduationEvent(e, pkg)
    if (!p) continue
    if (p.event.timestamp && now - p.event.timestamp > MAX_EVENT_AGE_MS) continue
    pending.push(p)
  }
  return { pending, nextCursor: data?.nextCursor ?? null, hasNextPage: !!data?.hasNextPage }
}

// Idempotency hint — once a given graduation has been handled, we
// persist the tx digest to KV so even if the cursor resets we don't
// re-create Cetus pools.
async function alreadyHandled(eventDigest: string): Promise<boolean> {
  if (!eventDigest) return false
  try {
    const key = `cetus-migrate-sui:done:${eventDigest}`
    const v = await kv.get<string>(key)
    return !!v
  } catch {
    return false
  }
}

async function markHandled(eventDigest: string, migrationDigest: string | undefined): Promise<void> {
  if (!eventDigest) return
  try {
    const key = `cetus-migrate-sui:done:${eventDigest}`
    await kv.set(key, migrationDigest || 'ok', { ex: 60 * 60 * 24 * 30 }) // 30d TTL
  } catch { /* non-fatal */ }
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

  const perPackageResults: Record<string, Array<{ tokenType: string; status: string; digest?: string; error?: string }>> = {}
  let scanned = 0

  for (const pkg of LEGACY_EVENT_PACKAGES) {
    perPackageResults[pkg] = []
    let cursor: any = null
    try {
      cursor = (await kv.get<any>(KV_CURSOR_KEY_PREFIX + pkg)) ?? null
    } catch { /* first run */ }

    let lastSeenCursor: any = cursor
    try {
      for (let page = 0; page < MAX_PAGES_PER_PKG; page++) {
        const { pending, nextCursor, hasNextPage } = await fetchPendingForPackage(pkg, cursor)
        scanned += pending.length

        for (const p of pending) {
          if (await alreadyHandled(p.eventDigest)) {
            perPackageResults[pkg].push({ tokenType: p.event.tokenType, status: 'already-handled' })
            continue
          }
          let r: CetusPoolCreationResult
          try {
            r = await createCetusPoolForLegacySui(p.event)
          } catch (e: any) {
            r = { success: false, error: e.message }
          }
          if (r.success) {
            await markHandled(p.eventDigest, r.digest)
            perPackageResults[pkg].push({ tokenType: p.event.tokenType, status: 'migrated', digest: r.digest })
          } else {
            perPackageResults[pkg].push({ tokenType: p.event.tokenType, status: 'error', error: r.error })
          }
        }

        if (nextCursor) lastSeenCursor = nextCursor
        if (!hasNextPage || !nextCursor) break
        cursor = nextCursor
      }

      if (lastSeenCursor) {
        try { await kv.set(KV_CURSOR_KEY_PREFIX + pkg, lastSeenCursor) } catch { /* non-fatal */ }
      }
    } catch (e: any) {
      perPackageResults[pkg].push({ tokenType: '<fatal>', status: 'error', error: e.message })
    }
  }

  const flat = Object.values(perPackageResults).flat()
  return NextResponse.json({
    ok: true,
    scanned,
    migrated: flat.filter(r => r.status === 'migrated').length,
    alreadyHandled: flat.filter(r => r.status === 'already-handled').length,
    errors: flat.filter(r => r.status === 'error').length,
    byPackage: perPackageResults,
  })
}
