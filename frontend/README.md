# The Odyssey — AIDA Pairs Fork

Forked from [TheOdyssey2](https://github.com/aidaonsui-collab/theodyssey2) with support for **AIDA-paired bonding curves**.

## Key Changes from upstream

### AIDA Pair Support

When creating a new token, choose **Pair Asset**:

- **SUI pair** (default) — standard Odyssey bonding curve, denominated in SUI
- **AIDA pair** — bonding curve denominated in AIDA, powered by Bluefin AIDA/SUI pool for pricing

### AIDA Contract

The AIDA-paired bonding curve uses `moonbags_aida` contract from `/contracts/moonbags_aida/`.

**AIDA Coin:** `0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA`

**Bluefin AIDA/SUI Pool:** `0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b`

### New Dependencies

- `@/lib/contracts_aida` — AIDA contract addresses, Bluefin pool info, curve constants

## Setup

```bash
npm install
npm run dev
```

## Environment Variables

```env
NEXT_PUBLIC_BACKEND_URL=https://theodyssey-backend1-production.up.railway.app/api/v1
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=your_project_id
```

## Deploy

```bash
vercel --prod
```

## AIDA Pair Flow

1. User selects "AIDA" as pair asset
2. Wallet fetches user's AIDA coins and joins them
3. Bonding curve pool created with `Coin<AIDA>` reserves
4. All buy/sell math denominated in AIDA
5. Graduation → Momentum CLMM pool (SUI pair)

## Status

🧪 Experimental — AIDA contract must be published to mainnet before AIDA pairs can be created
