'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertCircle } from 'lucide-react'

/**
 * X OAuth2 redirect target. X sends the user here with ?code&state after
 * authorization. We POST those to /api/culture/auth/verify, stash the
 * resulting verifyToken in sessionStorage under the gift id, then forward
 * the user back to the claim page where they signed the "Verify" button.
 *
 * Registered in the X Dev Portal as a single, static redirect URI:
 *   https://<your-domain>/airdrops/callback
 * — sessionStorage plus the state-bound PKCE record carry the gift id, so
 * the redirect URI doesn't need to be dynamic per gift.
 */
export default function AirdropCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const err = params.get('error')

    if (err) {
      setError(params.get('error_description') || err)
      return
    }
    if (!code || !state) {
      setError('Missing code/state from X — return to the claim page and try again.')
      return
    }

    ;(async () => {
      try {
        const res = await fetch('/api/culture/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Verification failed')

        const { giftId, verifyToken, username } = data
        try {
          sessionStorage.setItem(
            `culture:verify:${giftId}`,
            JSON.stringify({ verifyToken, username, ts: Date.now() })
          )
        } catch { /* sessionStorage might be disabled — the claim page will just re-verify */ }

        router.replace(`/airdrops/claim/${giftId}`)
      } catch (e: any) {
        setError(e?.message || 'Could not verify with X')
      }
    })()
  }, [router])

  return (
    <main className="min-h-screen bg-[#07070e] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-[#0d0f1a]/80 backdrop-blur-md border border-white/[0.06] rounded-2xl p-6 text-center space-y-3">
        {error ? (
          <>
            <div className="w-11 h-11 mx-auto rounded-full bg-red-500/15 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-red-400" />
            </div>
            <p className="text-sm text-red-400">{error}</p>
            <p className="text-xs text-gray-500">
              Close this tab and click "Verify with X" again on the claim page.
            </p>
          </>
        ) : (
          <>
            <Loader2 className="w-6 h-6 text-[#D4AF37] animate-spin mx-auto" />
            <p className="text-sm text-gray-400">Finishing X verification…</p>
          </>
        )}
      </div>
    </main>
  )
}
