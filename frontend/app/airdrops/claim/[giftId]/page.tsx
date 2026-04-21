'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { Gift, Clock, ExternalLink, Loader2, AlertCircle, Check, ArrowLeft } from 'lucide-react'
import {
  CULTURE_LATEST_PKG,
  CULTURE_CONFIG_ID,
  SUI_CLOCK,
  fetchGiftById,
  timeUntil,
  shortenAddr,
  tokenConfigFor,
  formatAmount,
  GiftEvent,
} from '@/lib/culture'

const ConnectButton = dynamicImport(
  () => import('@mysten/dapp-kit').then(m => m.ConnectButton),
  { ssr: false }
)

type Step = 'loading' | 'needs-connect' | 'needs-verify' | 'verifying' | 'ready' | 'claiming' | 'done' | 'error'

export default function ClaimPage() {
  const params = useParams<{ giftId: string }>()
  const giftId = params?.giftId || ''
  const account = useCurrentAccount()
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()

  const [gift, setGift] = useState<GiftEvent | null>(null)
  const [step, setStep] = useState<Step>('loading')
  const [error, setError] = useState<string | null>(null)
  const [verifyToken, setVerifyToken] = useState<string | null>(null)
  const [verifiedAs, setVerifiedAs] = useState<string | null>(null)
  const [claimDigest, setClaimDigest] = useState<string | null>(null)

  // Load gift
  useEffect(() => {
    if (!giftId) return
    fetchGiftById(suiClient, giftId).then(g => {
      if (!g) { setError('Gift not found — link may be wrong or it expired'); setStep('error'); return }
      setGift(g)
      if (g.claimed) { setError('This gift has already been claimed'); setStep('error'); return }
      if (g.isExpired) { setError('This gift has expired and refunded to the sender'); setStep('error'); return }
      setStep(account?.address ? 'needs-verify' : 'needs-connect')
    }).catch(e => { setError(e?.message || 'Failed to load gift'); setStep('error') })
  }, [giftId, suiClient, account?.address])

  // After wallet connects, advance past needs-connect
  useEffect(() => {
    if (step === 'needs-connect' && account?.address) setStep('needs-verify')
  }, [account?.address, step])

  // If the user just came back from /airdrops/callback, pick up the
  // verifyToken + username that the callback page stashed in sessionStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!giftId) return
    try {
      const raw = sessionStorage.getItem(`culture:verify:${giftId}`)
      if (!raw) return
      const stashed = JSON.parse(raw) as { verifyToken: string; username: string; ts: number }
      // Verify records TTL on the server is 15 min — drop anything older locally
      if (!stashed.verifyToken || Date.now() - (stashed.ts || 0) > 15 * 60 * 1000) {
        sessionStorage.removeItem(`culture:verify:${giftId}`)
        return
      }
      setVerifyToken(stashed.verifyToken)
      setVerifiedAs(stashed.username)
      setStep('ready')
    } catch { /* ignore — user will re-verify */ }
  }, [giftId])

  async function startVerify() {
    if (!gift || !account?.address) return
    setStep('verifying'); setError(null)
    try {
      const res = await fetch('/api/culture/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          giftId: gift.giftId,
          walletAddress: account.address,
          recipientHandle: gift.recipientHandle,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start verification')
      window.location.assign(data.authUrl)
    } catch (e: any) {
      setError(e?.message || 'Could not start X verification')
      setStep('error')
    }
  }

  async function executeClaim() {
    if (!gift || !account?.address || !verifyToken) return
    if (!CULTURE_CONFIG_ID) { setError('Culture tab not configured'); setStep('error'); return }

    setStep('claiming'); setError(null)
    try {
      // Revalidate the verify token right before signing (token is short-lived)
      const checkRes = await fetch('/api/culture/auth/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifyToken, giftId: gift.giftId, walletAddress: account.address }),
      })
      const checkData = await checkRes.json()
      if (!checkData.valid) throw new Error(checkData.error || 'Verification expired — re-verify with X')

      const tx = new Transaction()
      tx.setGasBudget(50_000_000)
      tx.moveCall({
        target: `${CULTURE_LATEST_PKG}::culture_fund::claim_by_wallet`,
        typeArguments: [gift.tokenType],
        arguments: [
          tx.object(gift.giftId),
          tx.object(CULTURE_CONFIG_ID),
          tx.object(SUI_CLOCK),
          tx.pure.address(account.address),
        ],
      })

      const result = await signAndExecute({ transaction: tx })
      const settled = await suiClient.waitForTransaction({ digest: result.digest, options: { showEffects: true } })
      if (settled.effects?.status?.status !== 'success') {
        throw new Error(settled.effects?.status?.error || 'Claim tx reverted')
      }
      setClaimDigest(result.digest)
      setStep('done')
    } catch (e: any) {
      setError(e?.message || 'Claim failed')
      setStep('error')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  const cfg = gift ? tokenConfigFor(gift.tokenType) : undefined
  const decimals = cfg?.decimals ?? 9
  const label = cfg?.label ?? gift?.tokenSymbol

  return (
    <main className="min-h-screen bg-[#07070e] pt-20 pb-16">
      <div className="max-w-xl mx-auto px-4">
        <Link href="/staking" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 mb-4">
          <ArrowLeft className="w-3 h-3" /> back
        </Link>

        <div className="card-lift bg-[#0d0f1a]/80 backdrop-blur-md border border-[#D4AF37]/30 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#D4AF37]/15 flex items-center justify-center">
              <Gift className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div>
              <h1 className="text-white font-bold">Airdrop waiting for you</h1>
              <p className="text-xs text-gray-500">Verify with X to claim.</p>
            </div>
          </div>

          {step === 'loading' && (
            <div className="py-10 text-center text-gray-500 text-sm">Loading gift…</div>
          )}

          {gift && step !== 'loading' && step !== 'error' && (
            <div className="bg-black/30 border border-white/5 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-xs">Amount</span>
                <span className="text-xl font-bold text-[#D4AF37]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatAmount(gift.amount, decimals)} <span className="text-sm text-gray-400 font-normal">{label}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-xs">For</span>
                <span className="text-white text-sm">@{gift.recipientHandle}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-xs">From</span>
                <span className="text-gray-300 text-xs font-mono">{shortenAddr(gift.depositor)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-xs">Time left</span>
                <span className="inline-flex items-center gap-1 text-xs text-[#D4AF37]"><Clock className="w-3 h-3" /> {timeUntil(gift.expiresAt)}</span>
              </div>
              {gift.message && (
                <div className="pt-2 mt-2 border-t border-white/5">
                  <p className="text-xs text-gray-500">Message</p>
                  <p className="text-sm text-gray-300 mt-0.5 italic">"{gift.message}"</p>
                </div>
              )}
              <p className="text-[10px] text-gray-600 pt-1">2% platform fee deducted at claim.</p>
            </div>
          )}

          {step === 'needs-connect' && (
            <div className="text-center space-y-3">
              <p className="text-gray-400 text-sm">Connect your wallet to claim this gift.</p>
              <div className="flex justify-center"><ConnectButton /></div>
            </div>
          )}

          {step === 'needs-verify' && (
            <div className="space-y-3">
              <p className="text-gray-400 text-sm">
                You're signed in as <span className="text-gray-300 font-mono">{shortenAddr(account?.address || '')}</span>.
                Prove you're <span className="text-white">@{gift?.recipientHandle}</span> on X to claim.
              </p>
              <button
                onClick={startVerify}
                className="w-full py-3 rounded-xl bg-[#D4AF37] text-black text-sm font-bold hover:opacity-90 transition-opacity"
              >
                Verify with X
              </button>
            </div>
          )}

          {step === 'verifying' && (
            <div className="py-6 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Verifying with X…
            </div>
          )}

          {step === 'ready' && (
            <div className="space-y-3">
              <div className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-1">
                <Check className="w-3 h-3" /> Verified as @{verifiedAs}
              </div>
              <button
                onClick={executeClaim}
                className="w-full py-3 rounded-xl bg-[#D4AF37] text-black text-sm font-bold hover:opacity-90 transition-opacity"
              >
                Claim {gift ? formatAmount(gift.amount, decimals) : ''} {label}
              </button>
            </div>
          )}

          {step === 'claiming' && (
            <div className="py-6 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Claiming on-chain…
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-3 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 flex items-center justify-center">
                <Check className="w-7 h-7 text-emerald-400" />
              </div>
              <p className="text-white font-semibold">Claimed! 🎉</p>
              {claimDigest && (
                <a
                  href={`https://suivision.xyz/txblock/${claimDigest}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#D4AF37] hover:underline"
                >
                  view on Suivision <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}

          {step === 'error' && (
            <div className="px-3 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error || 'Something went wrong'}</span>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
