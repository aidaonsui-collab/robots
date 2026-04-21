'use client'

import SendForm from './SendForm'
import GiftsDashboard from './GiftsDashboard'
import ClaimSearch from './ClaimSearch'
import PublicFeed from './PublicFeed'

/**
 * Culture sub-tab of /staking. Single-scroll page:
 *   1. Header + Send form            (senders)
 *   2. Claim Search                   (recipients — search their handle)
 *   3. Your sent airdrops             (senders' dashboard)
 *   4. Public activity feed           (everyone — social proof)
 */
export default function CultureTab() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="text-center mb-2">
        <h1
          className="text-2xl font-bold tracking-wide"
          style={{
            background: 'linear-gradient(135deg, #D4AF37 0%, #F5E7A3 25%, #D4AF37 50%, #AA7C11 75%, #D4AF37 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Build Culture — Send Gifts
        </h1>
        <p className="text-sm text-gray-500 mt-2">
          Send airdrop gifts to any .sui name or X handle. They verify with X (or their wallet for .sui) and claim from their own wallet. Nothing claimed in 48h refunds to you.
        </p>
      </div>

      <SendForm />
      <ClaimSearch />
      <GiftsDashboard />
      <PublicFeed />
    </div>
  )
}
