/**
 * API route for compiling Move coin modules.
 * POST /api/compile-coin
 * Body: { symbol: string }
 * Returns: { bytecode: number[] }
 * 
 * Proxies requests to the Move compiler microservice.
 */

import { NextRequest, NextResponse } from 'next/server'

const COMPILER_URL = process.env.MOVE_COMPILER_URL || 'http://localhost:3001'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''

    if (!symbol) {
      return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
    }

    // Call the compiler microservice
    const response = await fetch(`${COMPILER_URL}/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    })

    if (!response.ok) {
      // Preserve the microservice's real error so the UI can show the
      // underlying `sui move build` stderr instead of the bare wrapper
      // message. Prior behaviour stringified through `throw new Error`
      // and lost everything but the first line.
      const contentType = response.headers.get('content-type') ?? ''
      let detail: unknown
      try {
        detail = contentType.includes('application/json')
          ? await response.json()
          : await response.text()
      } catch {
        detail = `Upstream ${response.status} ${response.statusText}`
      }
      console.error('[compile-coin] upstream error', response.status, detail)
      return NextResponse.json(
        {
          error: typeof detail === 'string'
            ? detail
            : ((detail as any)?.error ?? 'Compilation failed'),
          upstreamStatus: response.status,
          upstreamBody: detail,
        },
        { status: 502 } // microservice failure → 502, not our own 500
      )
    }
    
    const result = await response.json()
    
    return NextResponse.json({
      bytecode: result.bytecode,
      moduleName: result.moduleName,
      structName: result.structName
    })
    
  } catch (error: any) {
    console.error('Compilation error:', error)
    return NextResponse.json(
      { error: error.message || 'Compilation service unavailable' },
      { status: 500 }
    )
  }
}
