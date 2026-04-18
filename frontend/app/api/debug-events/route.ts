import { NextResponse } from 'next/server'

export async function GET() {
  const RPC = 'https://fullnode.mainnet.sui.io'
  const ORIGIN_PACKAGE = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'
  
  try {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_queryEvents',
        params: [
          { MoveEventType: `${ORIGIN_PACKAGE}::moonbags::CreatedEventV2` },
          null,
          50,
          true
        ]
      })
    })
    
    const json = await response.json()
    const events = json.result?.data || []
    
    return NextResponse.json({
      eventCount: events.length,
      events: events.map((e: any) => ({
        poolId: e.parsedJson?.pool_id,
        symbol: e.parsedJson?.symbol,
        name: e.parsedJson?.name,
        tokenAddress: e.parsedJson?.token_address
      }))
    })
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}