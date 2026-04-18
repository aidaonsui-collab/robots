import { ODYSSEY_CONTRACT } from './contracts'

const RPC = 'https://fullnode.mainnet.sui.io'

// Fetch token count from contract
export async function getTokenCount(): Promise<number> {
  try {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getObject',
        params: [
          ODYSSEY_CONTRACT.tokenRegistry,
          { showContent: true }
        ]
      })
    })
    const data = await response.json()
    if (data.result?.data?.content?.fields?.total_tokens) {
      return parseInt(data.result.data.content.fields.total_tokens)
    }
  } catch (e) {
    console.error('Error fetching token count:', e)
  }
  return 0
}

// Fetch all tokens (pools) from contract
export async function fetchRealTokens(): Promise<any[]> {
  const tokens: any[] = []
  
  try {
    // Get registry to find pool IDs
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getObject',
        params: [
          ODYSSEY_CONTRACT.tokenRegistry,
          { showContent: true }
        ]
      })
    })
    
    const data = await response.json()
    const pools = data.result?.data?.content?.fields?.pools
    
    if (pools && pools.fields?.size > 0) {
      // Pool IDs found - would need to query each pool
      // For now return empty until we iterate
      console.log('Pools found:', pools)
    }
    
  } catch (e) {
    console.error('Error fetching tokens:', e)
  }
  
  return tokens
}

// Check if we have real tokens
export async function hasRealTokens(): Promise<boolean> {
  const count = await getTokenCount()
  return count > 0
}
