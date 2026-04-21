import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SUI_RPC = 'https://fullnode.mainnet.sui.io'

const STAKE_CONFIGS = [
  '0x59c35bc4c50631e4d4468d9964ba23c3961e1ff8d7c6df740fcf776c8936e940',
  '0x312216a4b80aa2665be3539667ef3749fafb0bde8c8ff529867ca0f0dc13bc18',
]

async function rpc(method: string, params: any[]) {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const j = await res.json()
  return j.result
}

function readBalance(field: any): bigint {
  if (field == null) return 0n
  if (typeof field === 'string' || typeof field === 'number') return BigInt(field)
  if (typeof field === 'object') {
    const v = field?.fields?.value ?? field?.value
    if (v != null) return BigInt(v)
  }
  return 0n
}

async function findPool(stakeConfig: string, typeKey: string) {
  const fields = await rpc('suix_getDynamicFields', [stakeConfig, null, 100])
  const pool = (fields?.data ?? []).find((f: any) =>
    f.objectType?.includes('StakingPool') && f.objectType?.includes(typeKey)
  )
  return pool ?? null
}

export async function GET(
  req: NextRequest,
  _context: { params: Promise<{ slug: string }> }
) {
  const coinType = req.nextUrl.searchParams.get('coinType')
  const explicitStakeConfig = req.nextUrl.searchParams.get('stakeConfig')

  if (!coinType) {
    return NextResponse.json({ error: 'coinType required' }, { status: 400 })
  }

  try {
    const typeKey = coinType.split('::').slice(1).join('::')
    const configsToTry = explicitStakeConfig ? [explicitStakeConfig] : STAKE_CONFIGS

    let pool: any = null
    for (const cfg of configsToTry) {
      pool = await findPool(cfg, typeKey)
      if (pool) break
    }

    if (!pool) {
      return NextResponse.json({ totalStaked: 0, poolFound: false })
    }

    const obj = await rpc('sui_getObject', [pool.objectId, { showContent: true }])
    const f = obj?.data?.content?.fields

    const totalStakedRaw =
      BigInt(f?.total_supply ?? 0) ||
      readBalance(f?.staking_token?.fields?.balance) ||
      0n

    const totalStaked = Number(totalStakedRaw) / 1e6

    return NextResponse.json({ totalStaked, poolFound: true, poolId: pool.objectId, fieldKeys: f ? Object.keys(f) : [] })
  } catch (e: any) {
    console.error('[pool-stats] error', e)
    return NextResponse.json({ error: e.message, totalStaked: 0 }, { status: 500 })
  }
}
