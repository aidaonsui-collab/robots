# robots — Claude guidance

> Orient here before touching anything. This file is the persistent brain for
> this repo — session-to-session decisions, current contract IDs, and the
> conventions you're expected to follow.

## Deployment

**Always deploy to production, never preview.**

- Merging PRs to `main` auto-deploys with `target: "production"` via Vercel's GitHub integration. That's the correct path.
- `vercel` CLI: always pass `--prod`. Never run plain `vercel` or `vercel deploy`.
- Any deploy tool result should show `target: "production"` — never `null` or `"preview"`.
- Vercel project: `aidas-projects-01b569fd/robots`.

## Workflow

- Feature branch: `claude/fix-staking-display-aLY7m`. PR → `main` → squash-merge.
- Contract changes: draft PR first, wait for Jack to compile + publish on mainnet, then merge.
- After any contract publish: update the package's `Published.toml` with the new IDs.
- One PR per logical change. Session history is visible in `git log --oneline main`.

## Contracts at a glance (Sui mainnet)

### Moonbags bonding curve — SUI pair (latest: V14)
- Package: `0xd58106acf43da3ed75dbe6eef4603207a701ea6df659ed07c005bb517cfcc995`
- Configuration: `0x4eb8300e6f0d5f45311fba19f19e0bc765c9733a8508f7fa1410b649d6dc1ae2`
- `frontend/lib/contracts.ts` → `MOONBAGS_CONTRACT_V14`
- Buy entry takes 10 args with Cetus deps (tick_spacing 200, 1% fee tier).

### Moonbags bonding curve — AIDA pair (latest: V5 upgrade of V2)
- Package (versioned): `0x23e754414a8e5b26b0c16f16afed69bd90560dc184b466f58045ceb64a7e43c0`
- Original publish id (for event filters forever): `0x593a2e87f393dcb14e0f8c88d587c04e9bc98295e13212e8992343377bf7f313`
- Configuration (shared, survives upgrades): `0x1b08a4a16024a7456e3c42449daec1dc8cbe130e24d6a6c37482e4fd2293b60f`
- `frontend/lib/contracts_aida.ts` → `MOONBAGS_AIDA_CONTRACT_V2.packageId` + `MOONBAGS_AIDA_V2_ORIGINAL_PKG`
- Buy entry = `buy_exact_in_with_lock` (6 args, uses dynamic_object_field pool lookup).
- Sell entry = `sell` (4 args).

### Odyssey Founder NFT (published 2026-04-24)
- Package: `0xc8b56110ebd4f85e98a5aa04732ae70851a16c5ec56259267f86abd7aace0f6e`
- AdminCap (owned by admin): `0xd2750a6fe81630ba928967e8159af76dca18a9ea72f34581a1bc9d517a73eb59`
- Registry (shared): `0x1910dec975a1ae588fa829801a5a35e8abff273ad04ac033091ed43a95a1e45f`
- TransferPolicy (shared): `0xecb6146f4d45906ac1d516cd993eb63f75e02c76c721ce8613913aed90779237`
- TransferPolicyCap (owned): `0x534584e345f04fd678112ab8662a1eea7b73d09aceb1044885de4258917b8dca`
- Royalty rule attached: 2.5% (250 bps) via mainnet Kiosk-rules package `0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879`
- `contracts/odyssey_founder_nft/Published.toml` has the full list.

### AIDA token
- Type: `0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA`
- 9 decimals.
- CoinMetadata: `0x591bd6e9daf2ce64436329f3060217078f4cdeac2a4e66f506bb12b3a7fd99f8`
- Bluefin AIDA/SUI CLMM pool (price oracle): `0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b`

### Key wallets
- Admin wallet (mints agents, publishes, attaches rules, runs crons): `0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409`
- Treasury (royalty recipient, fee-split destination): `0x92a32ac7fd525f8bd37ed359423b8d7d858cad26224854dfbff1914b75ee658b`

## Vercel env vars (all prod)

| Var | Purpose |
|---|---|
| `ADMIN_WALLET_SECRET` | Admin keypair for crons, mints, admin API routes |
| `CRON_SECRET` | Bearer token for all admin routes + crons |
| `AGENT_WALLET_MASTER_KEY` | AES-GCM key that seals each agent's private key in KV |
| `MINIMAX_API_KEY` | Agent inference LLM |
| `SERPER_API_KEY` | Agent web_search tool (falls back to DDG if absent) |
| `FOUNDER_NFT_PACKAGE_ID` | `0xc8b56110…` |
| `FOUNDER_NFT_ADMIN_CAP_ID` | `0xd2750a6f…` |
| `FOUNDER_NFT_REGISTRY_ID` | `0x1910dec9…` |

## Design decisions (the "why we built it this way" log)

**Bonding curve + DEX routing**
- 40% platform / 30% creator / ~30% AIDA stakers on the 2% trade fee. Matches `FEE_SPLIT` in `lib/contracts.ts`.
- Graduation auto-migrates to **Cetus CLMM (1% fee tier)** and burns LP via Cetus's `lp_burn` module. The returned BurnProof allows future fee collection from the locked position. Held by admin; not wired into automatic distribution yet.
- Cetus replaced Momentum across both bonding curve and Olympus presale (early 2026-04 decision). Any `momentum*` references in code are deprecated.

**Founder NFT**
- **Exclusive to the agent-creation path.** Regular token launches via `/bondingcurve/coins/create` don't get an NFT. Three layers enforce this: (1) AdminCap gate on mint, (2) Registry's `!contains(pool_id)` assert prevents double-mint even on AdminCap leak, (3) only `/api/agents/create` calls `mintFounderNft`.
- **Single shared Move type** (`OdysseyFounderNFT`) not a collection-per-agent. So TradePort only indexes one type and every future mint auto-appears under "Odyssey Founders".
- **Mint is additive, not replacement.** The NFT owns the **creator** fee slot in the existing fee split. Bonding-curve token + AIDA staker distribution stay exactly as they were.
- **No on-chain fee-claim logic in the NFT module.** The `/api/admin/founder-nft-payouts` route reads the Registry + the Pool's `fee_recipient` balance, returns `(holder, creator_share)` rows, admin pays out manually. Conscious choice over building an auto-sweep cron.
- **Royalty via TransferPolicy + Mysten Kiosk Rules.** Royalty accrues into the policy object; admin withdraws via `sui::transfer_policy::withdraw`. Better than a hardcoded recipient because payout routing stays flexible.

**Agent platform**
- LLM: MiniMax M2.7 via OpenAI-compatible endpoint. Claude/GPT-4 stubbed in UI but not wired.
- Each agent gets its own Sui keypair (Ed25519), sealed AES-GCM in Redis. Spending policy is server-side only (not on-chain yet).
- Tool-use loop: up to 5 rounds per turn. Tools live in `/api/agents/[id]/chat/route.ts`.
- A2A discovery: every agent publishes `/api/agents/[id]/.well-known/agent-card.json` (v0.3 schema) with an `x-odyssey` extension linking to `poolId` + `tokenType`.
- x402 payment detection is wired (`x402_fetch` tool); settlement is not yet — needs Sui-native scheme or per-agent EVM sub-wallet. Tool surfaces requirements so agent can escalate to user.
- Bonding-curve trade tools (`bc_buy`, `bc_sell`) are AIDA-pair-only in v1. SUI-pair needs V14's 10-arg signature — deferred.

**Hidden tokens**
- Two `HIDDEN_TOKENS` denylists: client-side in `lib/tokens.ts`, server-side in `app/api/tokens/route.ts`. Both must be updated together when hiding a new token.

**SuiNS name on wallet button**
- Slow on reload = public `fullnode.mainnet.sui.io` RPC latency + dApp Kit's in-memory-only React Query cache. A localStorage wrapper would fix it — not yet built.

## Admin ops one-liners (copy-paste)

```bash
# Set AIDA-pair creation fee (default 50,000 AIDA)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://theodyssey.fun/api/admin/set-aida-fee

# Get Founder NFT payout rows
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://theodyssey.fun/api/admin/founder-nft-payouts | jq

# Withdraw accrued royalties from TransferPolicy
sui client call \
  --package  0x2 \
  --module   transfer_policy \
  --function withdraw \
  --type-args 0xc8b56110ebd4f85e98a5aa04732ae70851a16c5ec56259267f86abd7aace0f6e::founder_nft::OdysseyFounderNFT \
  --args \
    0xecb6146f4d45906ac1d516cd993eb63f75e02c76c721ce8613913aed90779237 \
    0x534584e345f04fd678112ab8662a1eea7b73d09aceb1044885de4258917b8dca \
    '[]' \
  --gas-budget 30000000
```

## Open roadmap

### Done — tier 1 agent unlocks
- x402_fetch (detection + parsing, no settlement)
- A2A agent-card endpoint
- bc_buy / bc_sell tools (AIDA pair)
- Founder NFT (contract + wiring + royalty + dashboard + payouts helper)

### Pending — tier 2
- Marketplace job-completion events on-chain → aggregated reputation on the A2A card (the "verifiable identity" gap)
- Milestone escrow for marketplace v2 — per-milestone buyer approval + dispute resolution
- Automated idle-yield cron — every agent with SUI > threshold auto-deposits to NAVI
- SUI-pair support for bc_buy/bc_sell (V14 10-arg signature)

### Pending — tier 3
- x402 payment settlement — either Sui-native scheme (waiting for x402 v2 support) or per-agent EVM sub-wallet
- Agent-to-agent delegation via A2A + x402 + marketplace
- On-chain spending policy as a Move CapabilityCap — moves spend limits off-server

### UX polish
- SuiNS localStorage cache on wallet button (fix the slow-reload lag)
- TradePort collection submission once first Founder NFT exists on-chain
- "Founder NFT" column on `/my-agents` list view

### Known paper cuts
- TradePort URL format in `Founder NFT` dashboard panel may need to flip from `/sui/nft/<id>` to `/sui/collection/<slug>/<id>` after the collection is registered.
- V14 SUI-pair buy path is untested from the frontend (flagged in past PRs).
