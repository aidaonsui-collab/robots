'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Coins, Lock, Plus, TrendingUp, Rocket, BookOpen } from 'lucide-react'

// Dynamically import ConnectButton to avoid SSR issues
const ConnectButton = dynamic(
  () => import('@mysten/dapp-kit').then(mod => mod.ConnectButton),
  { ssr: false, loading: () => <button className="px-3 py-1.5 rounded-lg bg-purple-600/20 border border-purple-500/40 text-purple-300 text-sm">Loading...</button> }
)
import { cn } from '@/lib/utils'

// Custom Viking Longship SVG icon
function VikingBoatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Hull bottom curve */}
      <path d="M2 16 Q12 20 22 16" />
      {/* Hull sides */}
      <path d="M2 16 L4 12 L20 12 L22 16" />
      {/* Mast */}
      <line x1="12" y1="12" x2="12" y2="4" />
      {/* Sail */}
      <path d="M12 5 L18 8 L12 11 Z" fill="currentColor" stroke="none" opacity="0.7" />
      {/* Dragon head (bow) */}
      <path d="M20 12 L23 10 L22 12" />
      {/* Shields along hull */}
      <circle cx="6" cy="14" r="1" fill="currentColor" stroke="none" opacity="0.6" />
      <circle cx="10" cy="14" r="1" fill="currentColor" stroke="none" opacity="0.6" />
      <circle cx="14" cy="14" r="1" fill="currentColor" stroke="none" opacity="0.6" />
      <circle cx="18" cy="14" r="1" fill="currentColor" stroke="none" opacity="0.6" />
      {/* Oars */}
      <line x1="6" y1="14" x2="4" y2="17" strokeWidth="1.2" />
      <line x1="18" y1="14" x2="20" y2="17" strokeWidth="1.2" />
    </svg>
  )
}



const navItems = [
  { href: '/bondingcurve', label: 'Live', icon: Rocket, live: true },
  { href: '/docs', label: 'Docs', icon: BookOpen, live: false },
  { href: '/stats', label: 'Stats', icon: TrendingUp, live: false },
  { href: '/staking', label: 'Staking', icon: Coins, live: false },
]

export default function Navbar() {
  const pathname = usePathname()

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#07070e]/90 backdrop-blur-xl border-b border-purple-500/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/bondingcurve" className="flex items-center gap-2 group">
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-green-500 flex items-center justify-center shadow-lg group-hover:shadow-purple-500/40 transition-shadow">
              <VikingBoatIcon className="w-5 h-5 text-white" />
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-green-500 opacity-0 group-hover:opacity-60 blur-md transition-opacity" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold gradient-text">Odyssey</span>
              <span className="hidden sm:flex items-center gap-1 bg-red-500/20 border border-red-500/40 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 bg-red-400 rounded-full pulse-dot" />
                LIVE
              </span>
            </div>
          </Link>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-purple-500/20 text-purple-400 shadow-sm shadow-purple-500/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                  {item.live && (
                    <span className={cn(
                      'w-2 h-2 rounded-full',
                      isActive ? 'bg-green-400 pulse-dot' : 'bg-green-500/50'
                    )} />
                  )}
                </Link>
              )
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Link
              href="/bondingcurve/coins/create"
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 via-pink-500 to-green-500 text-white font-semibold text-sm hover:opacity-90 hover:shadow-lg hover:shadow-purple-500/30 transition-all duration-200"
            >
              <Plus className="w-4 h-4" />
              Create Token
            </Link>
            <ConnectButton />
          </div>
        </div>
      </div>
    </nav>
  )
}
