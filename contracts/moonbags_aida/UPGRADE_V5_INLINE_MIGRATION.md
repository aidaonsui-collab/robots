# moonbags_aida V5 — Inline Migration (draft / ready for review)

## What this upgrade adds

Three new functions in `moonbags_aida::moonbags`, additive — nothing
existing is modified. Struct layouts unchanged, so this is a standard
`sui client upgrade` on the existing V2 upgrade chain rooted at
`0x593a2e87…`. No shared objects need re-initialization.

| Symbol | Kind | Purpose |
|---|---|---|
| `buy_exact_in_with_lock_inline<Token>` | `public entry` | New buy entry that takes Cetus args; graduates inline |
| `buy_exact_in_returns_with_lock_inline<Token>` | `public fun` | Returns variant; mirrors the public returns buy fn |
| `transfer_pool_inline<Token>` | private `fun` | Internal — drains pool + calls `init_cetus_aida_pool_inner` |

The old `buy_exact_in_with_lock` / `buy_exact_in_returns_with_lock` stay
untouched, so any caller (old frontend, agents, scripts) that doesn't
pass Cetus args keeps working through the existing dump-to-admin path
plus the cron.

## Why this matters

Today's AIDA graduation is a multi-system dance:

```
buy tx  ──► transfer_pool (dump to admin) ──► PoolMigratingEvent
                                                    │
Vercel cron (every 30s) ◄──── suix_queryEvents ─────┘
        │
        └──► init_cetus_aida_pool_v2 (admin keypair signs)
```

Every hop is a failure surface: cron cursor state, RPC indexer lag,
KV availability, admin coin discovery, Cetus state freshness, Vercel
deploy timing. We saw all of them break this morning on GRILLZ.

After this upgrade, the same graduation is:

```
buy tx (user-signed) ──► transfer_pool_inline ──► init_cetus_aida_pool_inner
                                  │                        │
                                  └── PoolMigratingEvent ──┘ burn_proof
                                       (still emitted for analytics)
```

One tx, one signer, atomic. If Cetus aborts, the buy reverts. If the
curve doesn't fill, nothing happens. No external worker, no partial
state.

## How to apply the patch

```bash
cd ~/odyssey/robots                         # your repo root
git checkout claude/review-robots-repo-zpsYo
git pull origin claude/review-robots-repo-zpsYo
git apply contracts/moonbags_aida/inline_migration_v5.patch
git diff --stat contracts/moonbags_aida/sources/moonbags_aida.move
# one file changed, 229 insertions(+)
```

If `git apply` fails because the base file drifted, use a 3-way merge:

```bash
git apply --3way contracts/moonbags_aida/inline_migration_v5.patch
```

## How to publish the upgrade

```bash
cd contracts/moonbags_aida

# 1. Build locally — should produce three added functions + no struct changes
sui move build

# 2. Dry-run the upgrade. Expected diff: three added functions, no
#    existing signatures or struct layouts changed.
sui client upgrade \
  --upgrade-capability <UPGRADE_CAP_ID> \
  --gas-budget 500000000 \
  --dry-run

# 3. Real upgrade
sui client upgrade \
  --upgrade-capability <UPGRADE_CAP_ID> \
  --gas-budget 500000000

# 4. Bump Configuration.version so `assert_version` accepts V5 callers.
#    Optional if you left the assert as `<= VERSION` — V5 matches V5 —
#    but defensive to run once after the upgrade.
sui client call \
  --package <NEW_V5_PACKAGE_ID> \
  --module moonbags --function migrate_version \
  --args <ADMIN_CAP_ID> 0x1b08a4a16024a7456e3c42449daec1dc8cbe130e24d6a6c37482e4fd2293b60f
```

**Capture from the upgrade output:** the new versioned `packageId`. Put
it in `frontend/lib/contracts_aida.ts` as
`MOONBAGS_AIDA_CONTRACT_V2.packageId` (or add a new `_V5` constant if
you want to stage the cutover).

## Frontend wiring (separate PR)

Not included here. The rough shape:

1. In `frontend/app/bondingcurve/coins/[slug]/page.tsx` (or wherever
   the buy PTB is built), switch the move-call target from
   `buy_exact_in_with_lock` to `buy_exact_in_with_lock_inline`.
2. Append five new object args to the PTB: `CETUS_CONTRACT.burnManager`,
   `CETUS_CONTRACT.pools`, `CETUS_CONTRACT.globalConfig`,
   `AIDA_METADATA_ID`, and the token's `CoinMetadata<Token>` object id
   (`suix_getCoinMetadata` → `data.id`).
3. Keep the old entry as a fallback for a few deploys — set a feature
   flag so you can roll back if something goes sideways.

## Safety properties

- **Struct layouts unchanged** → no existing Configuration / Pool /
  StakeConfig / LockConfig / ThresholdConfig / AdminCap needs
  re-initialization. All existing pools continue to work.
- **Old entries untouched** → tokens launched before the frontend cuts
  over still complete graduation via the old dump-path + cron. No
  forced migration.
- **Event shape preserved** → `transfer_pool_inline` still emits
  `PoolCompletedEventV2` + `PoolMigratingEvent` with the same fields
  and hardcoded `bonding_dex = 0`. Analytics, the cron (which remains
  as insurance), and any subscriber keep observing graduations the
  same way.
- **`init_cetus_aida_pool_inner` unchanged** → same tick math, same
  Q64 sqrt price, same `fix_amount_a`, same burn_proof dynamic field
  write, same refund behaviour. The inline path reuses the exact
  same function that `init_cetus_aida_pool_v2` uses today.

## What to test after publish

- [ ] Launch a test token with a small threshold (e.g., 10K AIDA for
      parity with today's GRILLZ test).
- [ ] Buy through the curve until one buy would drain the last tokens.
      The graduating buy should be ~threshold-sized.
- [ ] Confirm that buy tx:
      - succeeds as a single tx,
      - shows one `TradedEventV2`, one `PoolCompletedEventV2`, one
        `PoolMigratingEvent`,
      - creates a Cetus CLMM pool (visible in Cetus's factory),
      - writes `burn_proof` dynamic field on the bonding pool,
      - refunds any single-sided-liquidity dust to admin.
- [ ] Confirm the cron's next tick sees the `PoolCompletedEventV2`
      and returns `already-migrated` via the `burn_proof` idempotency
      check — it should not try to re-migrate.
- [ ] A regular non-graduating buy on the same (fresh) token should
      execute normally and pass the Cetus refs through untouched.

## What's explicitly NOT in this upgrade

- **First-buy inline variant** (`create_and_lock_first_buy_with_fee_inline`)
  — deferred. A launch-plus-graduating-first-buy is rare in practice
  (threshold-sized initial buy). Existing cron fallback + the
  `/api/admin/migrate-pool` admin route cover that gap until a follow-up
  upgrade lands.

- **Cron retirement.** Leaving `api/cron/cetus-migrate-aida` in place
  as insurance. Once a few graduations flow through the inline path
  cleanly, a future PR can delete the cron (and its Vercel KV cursors).

- **Frontend migration.** Handled in a follow-up PR once the contract
  upgrade is published and its new `packageId` is known.

## Rollback plan

If the inline path misbehaves post-publish: keep the frontend on the
old `buy_exact_in_with_lock` entries. That path is untouched by this
upgrade and will continue to work exactly as it does today. The inline
entries then sit dormant with no callers. No on-chain rollback
required.
