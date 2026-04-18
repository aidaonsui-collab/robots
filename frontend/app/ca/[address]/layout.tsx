import { Metadata } from 'next'
import { fetchAllPoolTokens } from '@/lib/tokens'
import { redirect } from 'next/navigation'

type Props = {
  params: Promise<{ address: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address: rawAddress } = await params
  const address = decodeURIComponent(rawAddress)
  
  const tokens = await fetchAllPoolTokens()
  const token = tokens.find(t => t.coinType === address)
  
  if (!token) {
    return {
      title: 'Token Not Found | Odyssey',
      description: 'This contract address was not found on Odyssey',
    }
  }
  
  const price = token.currentPrice > 0 ? `$${token.currentPrice.toFixed(6)}` : 'TBD'
  const mc = token.marketCap ? `$${Math.round(token.marketCap)}` : 'TBD'
  const progress = `${token.progress.toFixed(1)}%`
  
  return {
    title: `${token.name} ($${token.symbol}) • ${price}`,
    description: `Price: ${price} | MC: ${mc} | Bonding: ${progress}`,
    openGraph: {
      title: `${token.name} ($${token.symbol})`,
      description: `💰 ${price} | 📊 MC: ${mc} | 🔥 ${progress} bonded`,
      url: `https://theodyssey.fun/bondingcurve/coins/${token.coinType}`,
      siteName: 'Odyssey',
      images: [{
        url: token.logoUrl || 'https://theodyssey.fun/og-default.png',
        width: 1200,
        height: 630,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${token.name} ($${token.symbol})`,
      description: `${price} | MC: ${mc} | ${progress} bonded`,
    },
  }
}

export default function CALayout({ children }: Props) {
  return <>{children}</>
}
