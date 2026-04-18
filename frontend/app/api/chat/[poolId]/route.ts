import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'

export const dynamic = 'force-dynamic'

const MAX_MESSAGES = 100

export interface ChatMessage {
  id: string
  user: string      // display name (SuiNS or shortened address)
  address: string   // full wallet address
  avatar: string    // emoji
  message: string
  timestamp: number // unix ms
}

function chatKey(poolId: string) {
  return `chat:${poolId}`
}

/** GET /api/chat/[poolId] — return up to 100 recent messages (newest first) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ poolId: string }> }
) {
  try {
    const { poolId } = await params
    const messages = await kv.get<ChatMessage[]>(chatKey(poolId)) || []
    return NextResponse.json({ messages })
  } catch (err: any) {
    console.error('chat GET error:', err)
    return NextResponse.json({ messages: [] })
  }
}

/** POST /api/chat/[poolId] — append a new message */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ poolId: string }> }
) {
  try {
    const { poolId } = await params
    const body = await req.json()
    const { user, address, avatar, message } = body

    if (!address || !message?.trim()) {
      return NextResponse.json({ error: 'address and message required' }, { status: 400 })
    }
    if (message.trim().length > 280) {
      return NextResponse.json({ error: 'message too long' }, { status: 400 })
    }

    const newMsg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user: user || `${address.slice(0, 6)}...${address.slice(-4)}`,
      address,
      avatar: avatar || '💬',
      message: message.trim(),
      timestamp: Date.now(),
    }

    const existing = await kv.get<ChatMessage[]>(chatKey(poolId)) || []
    const updated = [newMsg, ...existing].slice(0, MAX_MESSAGES)
    await kv.set(chatKey(poolId), updated)

    return NextResponse.json({ message: newMsg }, { status: 201 })
  } catch (err: any) {
    console.error('chat POST error:', err)
    return NextResponse.json({ error: err.message || 'Failed to post' }, { status: 500 })
  }
}
