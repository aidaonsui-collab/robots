'use client'

import { useDomain } from '@/hooks/useSuins'

interface AddressDisplayProps {
  address: string | null | undefined
  length?: number
  showFull?: boolean
}

function shortenAddress(addr: string, length: number = 4): string {
  if (!addr) return ''
  return `${addr.slice(0, length + 2)}...${addr.slice(-length)}`
}

export default function AddressDisplay({ address, length = 4, showFull = false }: AddressDisplayProps) {
  const domain = useDomain(address ?? null)

  if (!address) return <span className="text-gray-500">—</span>

  if (showFull) {
    return (
      <span title={address}>
        {domain ? (
          <span className="text-purple-400">{domain}</span>
        ) : (
          address
        )}
      </span>
    )
  }

  return (
    <span title={address} className="font-mono">
      {domain ? (
        <span className="text-purple-400">{domain}</span>
      ) : (
        shortenAddress(address, length)
      )}
    </span>
  )
}
