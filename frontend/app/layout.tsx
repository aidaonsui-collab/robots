import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import '@mysten/dapp-kit/dist/index.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'The Odyssey - AI Agent Launchpad',
  description: 'Journey into the world of Ai.',
  openGraph: {
    title: 'The Odyssey - AI Agent Launchpad',
    description: 'Journey into the world of Ai.',
    url: 'https://www.theodyssey.fun',
    siteName: 'The Odyssey',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: 'https://i.ibb.co/GvBG8LkN/IMG-1354.jpg',
        alt: 'The Odyssey — AI Agent Launchpad on Sui',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Odyssey - AI Agent Launchpad',
    description: 'Journey into the world of Ai.',
    images: ['https://i.ibb.co/GvBG8LkN/IMG-1354.jpg'],
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
