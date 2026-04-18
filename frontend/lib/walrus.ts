/**
 * Walrus Protocol — Decentralized Blob Storage on Sui
 * Simple HTTP API wrapper for storing and retrieving data.
 *
 * Architecture: Platform wallet (Option 1) — Odyssey pays storage costs.
 * Publisher nodes handle WAL payment; we just PUT/GET blobs.
 */

// Use community mainnet endpoints; swap to our own publisher later
const WALRUS_PUBLISHER = process.env.WALRUS_PUBLISHER_URL || 'https://publisher.walrus-testnet.walrus.space'
const WALRUS_AGGREGATOR = process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space'

// Default storage duration in epochs (each epoch ≈ 1 day on testnet, longer on mainnet)
const DEFAULT_EPOCHS = 5

export interface WalrusStoreResult {
  blobId: string
  endEpoch: number
  objectId?: string
}

/**
 * Store a blob on Walrus
 * Returns the blob ID which can be used to retrieve the content later.
 */
export async function storeBlob(
  content: string | Uint8Array,
  epochs: number = DEFAULT_EPOCHS
): Promise<{ success: boolean; blobId?: string; endEpoch?: number; error?: string }> {
  try {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    const body = new Blob([bytes as BlobPart])

    const res = await fetch(`${WALRUS_PUBLISHER}/v1/blobs?epochs=${epochs}`, {
      method: 'PUT',
      body,
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { success: false, error: `Walrus PUT ${res.status}: ${errText.slice(0, 200)}` }
    }

    const data = await res.json() as any

    // Response can be "newlyCreated" or "alreadyCertified" (same content = same blobId)
    const blobInfo = data.newlyCreated?.blobObject || data.alreadyCertified
    const blobId = blobInfo?.blobId || data.newlyCreated?.blobObject?.blobId || data.alreadyCertified?.blobId

    if (!blobId) {
      return { success: false, error: 'No blobId in response: ' + JSON.stringify(data).slice(0, 200) }
    }

    console.log(`[walrus] Stored blob: ${blobId} (${bytes.length} bytes, ${epochs} epochs)`)

    return {
      success: true,
      blobId,
      endEpoch: blobInfo?.endEpoch || data.newlyCreated?.blobObject?.endEpoch,
    }
  } catch (err: any) {
    console.error('[walrus] Store error:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Retrieve a blob from Walrus by blob ID
 */
export async function retrieveBlob(
  blobId: string
): Promise<{ success: boolean; data?: string; raw?: Uint8Array; error?: string }> {
  try {
    const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`, {
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { success: false, error: `Walrus GET ${res.status}: ${errText.slice(0, 200)}` }
    }

    const contentType = res.headers.get('content-type') || ''
    const raw = new Uint8Array(await res.arrayBuffer())

    // Try to decode as text if it looks like text content
    let data: string | undefined
    if (contentType.includes('text') || contentType.includes('json') || raw.length < 1_000_000) {
      try {
        data = new TextDecoder().decode(raw)
      } catch { /* binary content */ }
    }

    return { success: true, data, raw }
  } catch (err: any) {
    console.error('[walrus] Retrieve error:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Store a JSON object on Walrus
 */
export async function storeJSON(
  obj: any,
  epochs: number = DEFAULT_EPOCHS
): Promise<{ success: boolean; blobId?: string; error?: string }> {
  const json = JSON.stringify(obj)
  return storeBlob(json, epochs)
}

/**
 * Retrieve and parse a JSON blob from Walrus
 */
export async function retrieveJSON<T = any>(
  blobId: string
): Promise<{ success: boolean; data?: T; error?: string }> {
  const result = await retrieveBlob(blobId)
  if (!result.success || !result.data) {
    return { success: false, error: result.error || 'No data returned' }
  }
  try {
    const parsed = JSON.parse(result.data) as T
    return { success: true, data: parsed }
  } catch {
    return { success: false, error: 'Failed to parse JSON from blob' }
  }
}
