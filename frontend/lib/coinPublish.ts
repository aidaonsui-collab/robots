/**
 * coinPublish.ts
 * 
 * Publishes unique coin packages with proper module names per token.
 * Uses Move bytecode patching with proper section size updates.
 */

/**
 * Compiles fresh Move bytecode via API → Compiler microservice.
 * This gives us custom token names like ::bob::BOB
 */
async function compileCoin(symbol: string): Promise<number[]> {
  const response = await fetch('/api/compile-coin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol })
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Compilation failed')
  }
  
  const { bytecode } = await response.json()
  return bytecode
}

/**
 * Get coin module bytes ready for tx.publish()
 * Now compiles fresh bytecode with custom names!
 */
export async function getCoinModuleBytes(symbol: string): Promise<number[]> {
  return await compileCoin(symbol)
}

/**
 * Derive coin type from package ID and symbol.
 * With compiler service, tokens have proper names: ::bob::BOB
 */
export function coinTypeFromPackage(packageId: string, symbol: string): string {
  return `${packageId}::${symbol.toLowerCase()}::${symbol.toUpperCase()}`
}

export interface PublishCoinResult {
  packageId:     string
  coinType:      string
  treasuryCapId: string
  metadataId:    string
}

export function extractPublishResult(objectChanges: any[], symbol: string): PublishCoinResult {
  const published = objectChanges.find((c: any) => c.type === 'published')
  if (!published) throw new Error('No published package in objectChanges')

  const packageId = published.packageId as string

  const treasuryCap = objectChanges.find((c: any) =>
    c.type === 'created' && (c.objectType ?? '').includes('TreasuryCap')
  )
  const metadata = objectChanges.find((c: any) =>
    c.type === 'created' && (c.objectType ?? '').includes('CoinMetadata')
  )

  return {
    packageId,
    coinType:      coinTypeFromPackage(packageId, symbol),
    treasuryCapId: treasuryCap?.objectId ?? '',
    metadataId:    metadata?.objectId    ?? '',
  }
}
