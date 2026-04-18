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
      const error = await response.json()
      throw new Error(error.error || 'Compilation failed')
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
