'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertCircle } from 'lucide-react'

const CALLBACK_VERSION = 'v2-2026-04-21-diag'

export default function AirdropCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    console.log('[culture/callback]', CALLBACK_VERSION, 'loaded, href=', window.location.href)

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const err = params.get('error')

    if (err) {
      console.warn('[culture/callback] X returned error param:', err, params.get('error_description'))
      setError(params.get('error_description') || err)
      return
    }
    if (!code || !state) {
      console.warn('[culture/callback] missing code/state, query was', window.location.search)
      setError('Missing code/state from X — return to the claim page and try again.')
      return
    }

    console.log('[culture/callback] posting to /api/culture/auth/verify', { code: code.slice(0, 8) + '…', state: state.slice(0, 8) + '…' })

    ;(async () => {
      try {
        const res = await fetch('/api/culture/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        })
        const data = await res.json()
        console.log('[culture/callback] verify response', res.status, data)
        if (!res.ok) throw new Error(data.error || 'Verification failed')

        const { giftId, verifyToken, username } = data
        try {
          sessionStorage.setItem(
            `culture:verify:${giftId}`,
            JSON.stringify({ verifyToken, username, ts: Date.now() })
          )
          console.log('[culture/callback] sessionStorage set for', giftId, 'username=', username)
        } catch (e) {
          console.warn('[culture/callback] sessionStorage.setItem failed', e)
        }

        console.log('[culture/callback] redirecting to /airdrops/claim/' + giftId)
        router.replace(`/airdrops/claim/${giftId}`)
      } catch (e: any) {
        console.error('[culture/callback] verify failed', e)
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
