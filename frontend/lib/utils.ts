import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format address
export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

// Format number with commas
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num)
}

// Format SUI amount
export function formatSui(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(2)}M`
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(2)}K`
  }
  return amount.toFixed(2)
}

// Calculate APY from rewards
export function calculateAPY(staked: number, rewards: number, days: number = 30): number {
  if (staked === 0) return 0
  return (rewards / staked) * (365 / days) * 100
}

// Format time ago
export function timeAgo(time: string): string {
  return time // Already formatted in mock data
}
