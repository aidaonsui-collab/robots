'use client'

import SendForm from './SendForm'
import GiftsDashboard from './GiftsDashboard'

export default function CultureTab() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="text-center mb-4">
        <h1
          className="text-2xl font-bold tracking-wide"
          style={{
            background: 'linear-gradient(135deg, #D4AF37 0%, #F5E7A3 25%, #D4AF37 50%, #AA7C11 75%, #D4AF37 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Culture — Send Airdrops by X Handle
        </h1>
        <p className="text-sm text-gray-500 mt-2">
          Lock SUI, AIDA, or USDC for any X user. They verify with X and claim from their own wallet. Nothing claimed in 48h refunds to you.
        </p>
      </div>
      <SendForm />
      <GiftsDashboard />
    </div>
  )
}
