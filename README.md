# Robots 🤖

AIDA-paired DeFi contracts and forked frontend for TheOdyssey.

## Repos Structure

```
robots/
├── contracts/
│   └── moonbags_aida/     # AIDA-paired bonding curve (fork of Odyssey Moonbags v12)
├── frontend/               # Forked Odyssey 2.0 with AIDA pair support
├── scripts/
├── tests/
└── README.md
```

## Quick Start

### 1. Publish the AIDA Contract

```bash
cd contracts/moonbags_aida
sui client publish --gas-budget 500000000
# Save the new package ID and update contracts/moonbags_aida/Move.toml
```

### 2. Update Frontend

After publishing, update `frontend/lib/contracts_aida.ts`:

```typescript
export const MOONBAGS_AIDA_CONTRACT = {
  packageId:     '0x<NEW_PACKAGE_ID>',
  configuration: '0x<NEW_CONFIG_ID>',
  stakeConfig:   '0x<NEW_STAKE_CONFIG_ID>',
  lockConfig:    '0x<NEW_LOCK_CONFIG_ID>',
  tokenRegistry: '0x0',
}
```

### 3. Run Frontend

```bash
cd frontend
npm install
npm run dev
```

## Key Differences: SUI vs AIDA Pairs

| Feature | SUI Pair | AIDA Pair |
|---------|----------|-----------|
| Module | `moonbags` | `moonbags_aida` |
| Quote coin | `Coin<SUI>` | `Coin<AIDA>` |
| Contract | Odyssey v12 | `moonbags_aida` (robots) |
| Graduation | Momentum CLMM | Momentum CLMM |

## AIDA Contract

**Bluefin AIDA/SUI Pool:** `0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b`

The bonding curve uses Bluefin as the price reference for AIDA. The AIDA/SUI pool provides on-chain pricing data.

## GitHub

https://github.com/aidaonsui-collab/robots
