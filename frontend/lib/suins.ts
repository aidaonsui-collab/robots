// SuiNS integration - resolves .sui names to addresses and vice versa
// SuiNS registry on mainnet: 0x725e3245837b0e819c00f2c84f8b5e4d3c0d7c1f8e3f0c9c4c0c0c0c0c0c0c0c0

const SUINS_REGISTRY = '0x725e3245837b0e819c00f2c84f8b5e4d3c0d7c1f8e3f0c9c4c0c0c0c0c0c0c0c0'

export interface SuinsClient {
  resolveName: (name: string) => Promise<string>
  getDomainNameByAddress: (address: string) => Promise<string | null>
}

// Create a SuiNS client from a SuiClient
export function createSuinsClient(suiClient: any): SuinsClient {
  return {
    resolveName: async (name: string): Promise<string> => {
      // normalize name (remove .sui suffix if present)
      const normalized = name.endsWith('.sui') ? name.slice(0, -4) : name
      // Use devInspect to call the registry's resolve function
      const tx = {
        kind: 'moveCall' as const,
        data: {
          package: SUINS_REGISTRY,
          module: 'suins',
          function: 'resolve',
          arguments: [normalized],
          typeArguments: [],
        },
      }
      const result = await suiClient.devInspectTransaction({
        transaction: tx,
        sender: SUINS_REGISTRY,
      })
      // Parse the return value - it's an address string
      if (result.results?.[0]?.returnValues?.[0]) {
        const [bytes] = result.results[0].returnValues[0]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return Buffer.from(bytes as any).toString('hex')
      }
      throw new Error('Name not found')
    },
    getDomainNameByAddress: async (address: string): Promise<string | null> => {
      try {
        const tx = {
          kind: 'moveCall' as const,
          data: {
            package: SUINS_REGISTRY,
            module: 'suins',
            function: 'reverse_resolve',
            arguments: [address],
            typeArguments: [],
          },
        }
        const result = await suiClient.devInspectTransaction({
          transaction: tx,
          sender: SUINS_REGISTRY,
        })
        if (result.results?.[0]?.returnValues?.[0]) {
          const [bytes] = result.results[0].returnValues[0]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hex = Buffer.from(bytes as any).toString('hex')
          // Parse the string from hex
          return parseHexString(hex)
        }
        return null
      } catch {
        return null
      }
    },
  }
}

function parseHexString(hex: string): string {
  // Remove trailing zeros
  let end = hex.length
  while (end > 0 && hex.slice(end - 2, end) === '00') {
    end -= 2
  }
  if (end === 0) return ''
  const truncated = hex.slice(0, end)
  try {
    return Buffer.from(truncated, 'hex').toString('utf8')
  } catch {
    return ''
  }
}
