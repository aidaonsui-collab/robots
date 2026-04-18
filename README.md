# Robots — AIDA-Paired Bonding Curve Contracts

Fork of the Odyssey Moonbags bonding curve contract, adapted to use **AIDA** as the quote token instead of SUI.

## Key Difference from Moonbags (SUI pairs)

| | Moonbags (SUI) | Moonbags AIDA |
|---|---|---|
| Quote token | `Coin<SUI>` | `Coin<AIDA>` |
| Module | `moonbags` | `moonbags_aida` |
| AIDA import | N/A | `0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA` |

## Bluefin Integration

The **AIDA/SUI pool** on Bluefin is used as the price reference:
- **Pool ID:** `0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b`
- **Pool type:** `Pool<AIDA, SUI>`
- **Reserves:** ~123M AIDA / ~3.78M SUI

## Contract Structure

```
contracts/moonbags_aida/
├── sources/
│   ├── moonbags_aida.move     # Main bonding curve contract
│   ├── moonbags_stake.move    # Staking module (AIDA rewards)
│   ├── moonbags_token_lock.move
│   ├── curves.move
│   └── utils.move
└── sources_deps/
    └── aida/                  # Mock AIDA module (compilation only — NOT published)
        └── sources/aida.move
```

## Build

```bash
cd contracts/moonbags_aida
sui move build
```

## Publish

> ⚠️ The `sources_deps/aida` mock module is for **compilation only**. When publishing, the real AIDA module already on-chain at `0xcee208...` is used. Do NOT publish the mock aida module.

```bash
sui client publish --gas-budget 500000000
```

## Architecture

- `Pool<Token>.real_sui_reserves` → `Coin<AIDA>` (renamed from `Coin<SUI>`)
- All buy/sell math operates in AIDA instead of SUI
- Staking rewards paid in AIDA
- Graduation still goes to Momentum CLMM (SUI pair)

## Status

🧪 Experimental — not yet deployed to mainnet
