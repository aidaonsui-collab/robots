import { NextResponse } from 'next/server'

/**
 * REMOVED (security): this endpoint allowed any unauthenticated caller to
 * rewrite an agent's creator address, which in turn unlocked the wallet
 * export flow (sign-with-new-creator → extract custodial keypair).
 *
 * Changing a creator is a two-party, signed operation and is deliberately
 * not reimplemented here.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Gone — update-creator is disabled for security reasons.' },
    { status: 410 },
  )
}

export async function GET() {
  return NextResponse.json({ error: 'Gone' }, { status: 410 })
}
