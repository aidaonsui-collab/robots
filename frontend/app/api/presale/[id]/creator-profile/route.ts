/**
 * GET/POST /api/presale/:id/creator-profile
 *
 * Off-chain creator profile for a presale (the creator's personal X handle,
 * etc.). The Move presale struct has no field for this, so we persist it in
 * Vercel KV keyed by presale object ID.
 */

import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { fetchPresale } from '@/lib/presale'

export const dynamic = 'force-dynamic'

const KEY = (id: string) => `presale:creator-profile:${id}`

export interface CreatorProfile {
  creatorX?: string        // @handle or full URL
  updatedAt: string
  updatedBy: string        // wallet address that wrote this
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const profile = await kv.get<CreatorProfile>(KEY(id))
  return NextResponse.json(profile ?? {})
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const creatorX = typeof body.creatorX === 'string' ? body.creatorX.trim().slice(0, 200) : ''
    const claimedCreator = typeof body.creator === 'string' ? body.creator.trim().toLowerCase() : ''

    // Only the on-chain presale creator can write this. Look up the presale
    // and compare the caller-supplied address against the Move `creator` field.
    const presale = await fetchPresale(id)
    if (!presale) {
      return NextResponse.json({ error: 'Presale not found' }, { status: 404 })
    }
    if (!claimedCreator || claimedCreator !== (presale.creator || '').toLowerCase()) {
      return NextResponse.json({ error: 'Only the presale creator can set their profile' }, { status: 403 })
    }

    const profile: CreatorProfile = {
      creatorX: creatorX || undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: claimedCreator,
    }
    await kv.set(KEY(id), profile)
    return NextResponse.json({ success: true, profile })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
