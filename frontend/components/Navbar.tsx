'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Coins, Plus, Rocket, BookOpen, Menu, X, Sparkles, Store, Bot, Mountain } from 'lucide-react'

// Dynamically import ConnectButton to avoid SSR issues
const ConnectButton = dynamic(
  () => import('@mysten/dapp-kit').then(mod => mod.ConnectButton),
  { ssr: false, loading: () => <button className="px-3 py-1.5 rounded-lg bg-[#D4AF37]/20 border border-[#D4AF37]/40 text-[#D4AF37] text-sm">Loading...</button> }
)
import { cn } from '@/lib/utils'

// Premium Viking Longship SVG icon (detailed version from banner)
function VikingBoatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 70"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Hull - elegant curved shape */}
      <path d="M 10,45 Q 5,50 3,52 Q 40,58 77,52 Q 75,50 70,45 Z" 
            fill="currentColor" stroke="currentColor" strokeWidth="1.5" opacity="0.9"/>
      
      {/* Hull upper edge */}
      <path d="M 10,45 L 15,35 L 65,35 L 70,45" 
            fill="currentColor" stroke="currentColor" strokeWidth="1.5" opacity="0.95"/>
      
      {/* Hull planking details */}
      <line x1="17" y1="37" x2="63" y2="37" stroke="currentColor" strokeWidth="0.8" opacity="0.4"/>
      <line x1="18" y1="40" x2="62" y2="40" stroke="currentColor" strokeWidth="0.8" opacity="0.4"/>
      
      {/* Ornate dragon head (bow) */}
      <g transform="translate(70, 40)">
        <path d="M 0,0 Q 5,-5 10,-8" stroke="currentColor" strokeWidth="2" fill="none"/>
        <ellipse cx="12" cy="-10" rx="4" ry="5" fill="currentColor" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="13" cy="-11" r="1" fill="#D4AF37"/>
        <path d="M 14,-8 L 17,-7 L 16,-9 Z" fill="currentColor"/>
        <path d="M 11,-14 L 10,-18 L 12,-15" fill="currentColor"/>
      </g>
      
      {/* Stern ornament */}
      <g transform="translate(10, 40)">
        <path d="M 0,0 Q -4,-3 -7,-6" stroke="currentColor" strokeWidth="2" fill="none"/>
        <circle cx="-8" cy="-7" r="2.5" fill="currentColor" stroke="currentColor" strokeWidth="1.5"/>
      </g>
      
      {/* Tall mast */}
      <line x1="40" y1="35" x2="40" y2="-5" stroke="currentColor" strokeWidth="2.5"/>
      
      {/* Large billowing sail */}
      <path d="M 40,-3 Q 55,5 60,15 Q 58,20 40,30 Z" 
            fill="currentColor" stroke="currentColor" strokeWidth="1.8" opacity="0.75"/>
      
      {/* Sail rigging */}
      <line x1="40" y1="5" x2="57" y2="8" stroke="currentColor" strokeWidth="0.8" opacity="0.4"/>
      <line x1="40" y1="12" x2="58" y2="15" stroke="currentColor" strokeWidth="0.8" opacity="0.4"/>
      
      {/* Viking shields along hull */}
      <g opacity="0.85">
        <circle cx="22" cy="38" r="3" fill="#8B4513" stroke="currentColor" strokeWidth="0.8"/>
        <circle cx="32" cy="38" r="3" fill="#654321" stroke="currentColor" strokeWidth="0.8"/>
        <circle cx="42" cy="38" r="3" fill="#8B4513" stroke="currentColor" strokeWidth="0.8"/>
        <circle cx="52" cy="38" r="3" fill="#654321" stroke="currentColor" strokeWidth="0.8"/>
        <circle cx="62" cy="38" r="3" fill="#8B4513" stroke="currentColor" strokeWidth="0.8"/>
      </g>
      
      {/* Oars in rowing motion */}
      <g stroke="currentColor" strokeWidth="2" opacity="0.6" strokeLinecap="round">
        <line x1="25" y1="40" x2="15" y2="55"/>
        <line x1="45" y1="40" x2="40" y2="58"/>
        <line x1="55" y1="40" x2="52" y2="57"/>
      </g>
    </svg>
  )
}



const navItems = [
  { href: '/bondingcurve', label: 'Projects', icon: Rocket, live: true, soon: false },
  { href: '/olympus', label: 'Olympus', icon: Mountain, live: false, soon: false },
  { href: '/agents', label: 'AI Agents', icon: Sparkles, live: false, soon: false },
  { href: '/marketplace', label: 'Marketplace', icon: Store, live: false, soon: false },
  { href: '/robotics', label: 'Robotics', icon: Bot, live: false, soon: true },
  { href: '/staking', label: 'Staking', icon: Coins, live: false, soon: false },
  { href: '/docs', label: 'Docs', icon: BookOpen, live: false, soon: false },
]

export default function Navbar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#07070e]/90 backdrop-blur-xl border-b border-[#D4AF37]/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/bondingcurve" className="flex items-center gap-2 group" onClick={() => setMobileOpen(false)}>
            <div className="relative w-11 h-11 rounded-xl bg-[#D4AF37] flex items-center justify-center shadow-lg group-hover:shadow-[#D4AF37]/40 transition-shadow">
              <VikingBoatIcon className="w-6 h-6 text-black" />
              <div className="absolute inset-0 rounded-xl bg-[#D4AF37] opacity-0 group-hover:opacity-60 blur-md transition-opacity" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-[#D4AF37]">Odyssey</span>
              <span className="hidden sm:flex items-center gap-1 bg-red-500/20 border border-red-500/40 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 bg-red-400 rounded-full pulse-dot" />
                LIVE
              </span>
            </div>
          </Link>

          {/* Nav Links — desktop */}
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
                      ? 'bg-[#D4AF37]/20 text-[#D4AF37] shadow-sm shadow-[#D4AF37]/10'
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
                  {item.soon && (
                    <span className="text-[9px] font-bold bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30 px-1.5 py-0.5 rounded-full tracking-wider">
                      SOON
                    </span>
                  )}
                </Link>
              )
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Link
              href="/bondingcurve/coins/create"
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D4AF37] text-black font-semibold text-sm hover:opacity-90 hover:shadow-lg hover:shadow-[#D4AF37]/30 transition-all duration-200"
              onClick={() => setMobileOpen(false)}
            >
              <Plus className="w-4 h-4" />
              Create Token
            </Link>
            <ConnectButton />
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              onClick={() => setMobileOpen(o => !o)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#D4AF37]/20 bg-[#07070e]/95 backdrop-blur-xl">
          <div className="px-4 py-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all',
                    isActive
                      ? 'bg-[#D4AF37]/20 text-[#D4AF37]'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                  {item.live && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-green-400 pulse-dot" />
                  )}
                  {item.soon && (
                    <span className="ml-auto text-[10px] font-bold bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30 px-2 py-0.5 rounded-full tracking-wider">
                      SOON
                    </span>
                  )}
                </Link>
              )
            })}
            <Link
              href="/bondingcurve/coins/create"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold bg-[#D4AF37] text-black mt-2"
            >
              <Plus className="w-5 h-5" />
              Create Token
            </Link>
          </div>
        </div>
      )}
    </nav>
  )
}
