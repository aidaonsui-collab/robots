import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import '@mysten/dapp-kit/dist/index.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Odyssey 2.0 - AI Agent Launchpad',
  description: 'Journey into the world of Ai.',
  openGraph: {
    title: 'Odyssey 2.0 - AI Agent Launchpad',
    description: 'Journey into the world of Ai.',
    url: 'https://www.theodyssey.fun',
    siteName: 'Odyssey',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: 'https://i.ibb.co/3yzP9JTB/photo-2026-03-31-15-48-35.jpg',
        alt: 'Odyssey — Viking longship',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Odyssey 2.0 - AI Agent Launchpad',
    description: 'Journey into the world of Ai.',
    images: ['https://i.ibb.co/3yzP9JTB/photo-2026-03-31-15-48-35.jpg'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <Navbar />
          <main>{children}</main>
        </Providers>
          <Footer />
      </body>
    </html>
  )
}
