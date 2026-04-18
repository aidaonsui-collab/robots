# Odyssey 2.0 - Launchpad Frontend

A modern DeFi launchpad frontend built with Next.js 14+, featuring bonding curve trading and staking.

## Features

- 🎯 Bonding Curve Token Trading
- 💰 Native Token ($AIDA) Staking - 30% of platform fees
- 🔄 Any Token Staking - 25% of token fees
- 📊 Real-time Data Simulation
- 🔐 Sui Wallet Integration

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# or
yarn install
```

### Environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Update the SUI RPC endpoint:

```env
NEXT_PUBLIC_SUI_RPC=https://fullnode.mainnet.sui.io:443
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Configuration

### AIDA Contract

The native staking token contract:

```
0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA
```

### Reward Percentages

- **Native Staking ($AIDA)**: 30% of all SUI trading fees
- **Any Token Staking**: 25% of that token's trading fees

To modify, edit:
- `lib/contracts.ts` - Contract addresses
- `app/staking/page.tsx` - Reward percentages in UI text

## Project Structure

```
theodyssey2/
├── app/
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Redirect to bondingcurve
│   ├── bondingcurve/      # Token discovery & trading
│   └── staking/           # Staking dashboard
├── components/
│   ├── Navbar.tsx         # Top navigation
│   ├── TokenCard.tsx      # Token display card
│   ├── TradeModal.tsx    # Buy/Sell modal
│   ├── StakingCard.tsx   # Staking interface
│   └── BondingChart.tsx  # Progress visualization
├── lib/
│   ├── contracts.ts       # Contract addresses & ABIs
│   └── utils.ts          # Helper functions
└── public/
    └── tokens/           # Token logos
```

## Pages

### /bondingcurve
- Token grid with search & filters
- Market cap, holders, bonding progress
- Recent transactions feed
- Buy/Sell modal

### /staking
- Native $AIDA staking (30% fees)
- Any token staking (25% fees)
- Stake/Unstake/Claim flows

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- @suiet/wallet-kit
- Recharts
- Lucide React

## License

MIT
