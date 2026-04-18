import { Metadata } from 'next'
import { fetchAllPoolTokens } from '@/lib/tokens'

type Props = {
  params: Promise<{ slug: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)
  
  // Fetch all tokens to find the matching one
  const tokens = await fetchAllPoolTokens()
  
  // Try to match by coinType or poolId
  const token = tokens.find(t => 
    t.coinType === slug || 
    t.poolId === slug
  )
  
  if (!token) {
    return {
      title: 'Token Not Found | Odyssey',
      description: 'Journey into the world of Ai.',
    }
  }
  
  const price = token.currentPrice > 0 ? `$${token.currentPrice.toFixed(6)}` : 'TBD'
  const mc = token.marketCap ? `$${Math.round(token.marketCap)}` : 'TBD'
  const progress = `${token.progress.toFixed(1)}%`
  const raised = `${token.realSuiRaised.toFixed(2)} SUI`
  
  const title = `${token.name} ($${token.symbol}) • ${price}`
  const description = `${token.description || `Trade ${token.symbol} on Odyssey`}\n\nPrice: ${price} | MC: ${mc} | Bonding: ${progress} | Raised: ${raised}`
  const url = `https://theodyssey.fun/bondingcurve/coins/${token.coinType}`
  
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: 'Odyssey - AI Agent Launchpad',
      images: [
        {
          url: token.logoUrl || 'https://theodyssey.fun/og-default.png',
          width: 1200,
          height: 630,
          alt: `${token.name} logo`,
        },
      ],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: `Price: ${price} | MC: ${mc} | ${progress} bonded`,
      images: [token.logoUrl || 'https://theodyssey.fun/og-default.png'],
      creator: '@TheOdysseyFun',
    },
    other: {
      'fc:frame': 'vNext',
      'fc:frame:image': token.logoUrl || 'https://theodyssey.fun/og-default.png',
      'og:type': 'website',
      'og:price:amount': token.currentPrice.toString(),
      'og:price:currency': 'USD',
    },
  }
}

export default function TokenLayout({ children }: Props) {
  return <>{children}</>
}
