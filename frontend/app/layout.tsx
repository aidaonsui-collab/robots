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
  },
  twitter: {
    card: 'summary',
    title: 'Odyssey 2.0 - AI Agent Launchpad',
    description: 'Journey into the world of Ai.',
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
