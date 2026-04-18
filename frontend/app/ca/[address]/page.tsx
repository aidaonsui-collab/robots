'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function ContractAddressRedirect() {
  const params = useParams()
  const router = useRouter()
  const address = decodeURIComponent(params.address as string)
  
  useEffect(() => {
    // Redirect to the token page
    router.replace(`/bondingcurve/coins/${address}`)
  }, [address, router])
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f]">
      <div className="text-center">
        <div className="w-12 h-12 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">Redirecting to token page...</p>
      </div>
    </div>
  )
}
