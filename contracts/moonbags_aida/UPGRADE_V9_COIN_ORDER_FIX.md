# moonbags_aida V9 — Cetus coin-order fix (upgrade, not republish)

## What changed

One internal function — `init_cetus_aida_pool_inner` — and one new private
helper — `token_gt_aida<Token>()`. No struct layouts touched, no public
function signatures change, no shared objects need re-init. Standard
`sui client upgrade` on top of v8.

## Why

Cetus's `factory::new_pool_key` (factory.move:7) requires
`CoinTypeA > CoinTypeB` in canonical-type-name string order, else aborts
with code 6. v8's `init_cetus_aida_pool_inner` hardcoded
`pool_creator::create_pool_v2<Token, AIDA>` regardless of which side was
lex-bigger. That meant:

| Token | Token addr | vs AIDA addr (`0xcee2…`) | v8 result |
|---|---|---|---|
| GRILLZ | `0x1a39…` | `1a` < `ce` → Token < AIDA | abort 6 (silent) |
| PEPEG | `0xf44b…` | `f4` > `ce` → Token > AIDA | migrates ✓ |
| AXBT | `0x03e9…` | `03` < `ce` → Token < AIDA | abort 6 (silent) |

About half the address space (any token whose canonical type-name string
sorts below AIDA's) silently failed to migrate after graduation. The
bonding curve completed, the admin wallet received both coins, but the
Cetus init aborted and the cron's exception was swallowed by the
per-pool catch in `route.ts`.

## What v9 does

`init_cetus_aida_pool_inner` now branches on
`token_gt_aida<Token>()`:

- **Token > AIDA** (e.g. PEPEG): unchanged — `create_pool_v2<Token, AIDA>`,
  same sqrt_price formula, same `fix_amount_a = true`. Existing migrated
  pools see no behavioural difference.
- **Token < AIDA** (e.g. AXBT, GRILLZ): swapped — `create_pool_v2<AIDA, Token>`
  with arguments + metadata reordered, sqrt_price numerator/denominator
  inverted (`token_amount / aida_amount` instead of `aida / token`), and
  `fix_amount_a = false` (token side is now coin B but we still want it
  exact, so the flag flips with the role).

Both branches end at the same `lp_burn::burn_lp_v2` + `BURN_PROOF_FIELD`
dynamic-field write, so the cron's idempotency check
(`isAlreadyMigrated` in `route.ts:161`) keeps working for both.

## Touchpoints (single-fn change covers everything)

`init_cetus_aida_pool_inner` is called from three places — fixing it once
covers all of them:

| Caller | Path | Notes |
|---|---|---|
| `init_cetus_aida_pool<Token>` | legacy v1 entry | line 1225 |
| `init_cetus_aida_pool_v2<Token>` | what the cron + admin endpoint call | line 1257 |
| `transfer_pool_inline<Token>` | V5 inline-migration buy entries | line 1572 |

The V5 inline path (`buy_exact_in_with_lock_inline` + the `_returns_`
variant) flows through `transfer_pool_inline` → `init_cetus_aida_pool_inner`,
so future low-address-AIDA-pair tokens launched via the inline graduation
flow will pick up the fix automatically.

## Publish steps

1. Build:
   ```
   cd contracts/moonbags_aida
   sui move build
   ```
2. Upgrade against the existing v8 upgrade chain (admin wallet holds the
   `UpgradeCap`):
   ```
   sui client upgrade \
     --upgrade-capability <UPGRADE_CAP_ID> \
     --gas-budget 500000000
   ```
3. Note the new package id from the output (`Published Objects` →
   `PackageID`).
4. Update the TS-side constant — `frontend/lib/contracts_aida.ts`,
   `MOONBAGS_AIDA_CONTRACT.packageId`. The Configuration / StakeConfig /
   LockConfig object ids stay the same (Sui upgrades preserve shared
   state, and `init_cetus_aida_pool_v2` takes `&mut Configuration` which
   the upgraded code can still mutate).
5. Commit, merge to main, Vercel auto-deploys with the new id baked in.

## Backfilling AXBT (and any other tokens stuck pre-v9)

After step 5, any AIDA-paired token that's `is_completed = true` but
missing a `burn_proof` dynamic field on its bonding pool can be migrated
in one call against the existing admin endpoint
(`/api/admin/migrate-pool/route.ts`):

```
curl -X POST https://www.theodyssey.fun/api/admin/migrate-pool \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"tokenType":"<full coin type, e.g. 0x03e9…::axbt::AXBT>"}'
```

The endpoint:
- Looks up the bonding pool from `Configuration` dynamic fields,
- Asserts it isn't already migrated (skips if `burn_proof` exists),
- Picks the largest admin-owned coin of each side,
- Calls `init_cetus_aida_pool_v2` (whole-coin mode; Cetus rebalances and
  refunds dust),
- Returns the digest.

Idempotent — safe to retry.

## Test plan

- [ ] `sui move build` against v9 source — must compile cleanly with no
      new warnings on the changed function.
- [ ] Local dry-run via `sui client dry-run` of an upgrade against the
      current v8 cap — confirm no struct compatibility errors.
- [ ] Post-publish: hit the admin endpoint with AXBT's coin type;
      confirm response is `{ status: "migrated", digest: … }`.
- [ ] Verify `burn_proof` dynamic field is now present on AXBT's bonding
      pool object on SuiVision.
- [ ] Confirm the resulting Cetus pool has both AXBT and AIDA reserves
      and the LP position is owned by the burn-proof object (i.e. burned).
- [ ] Run the cron manually after AXBT migrates; expect AXBT to show
      `status: "already-migrated"` in the results.
- [ ] Smoke test the *unchanged* high-address path — graduate a token
      whose address sorts above AIDA's (or replay one that already
      migrated cleanly under v8) and confirm v9 still routes it through
      the original `<Token, AIDA>` branch with byte-identical outcomes.

## Out of scope

- This patch does NOT address the cron's silent error swallowing. When
  Cetus aborts mid-migration today, the per-pool `catch` in
  `runLoop`/`migrate` returns `{ status: 'error' }` for that one pool
  but the cron run reports overall success and the failure isn't
  surfaced anywhere user-visible. Worth a follow-up: add structured
  logging + an error counter that surfaces in the JSON response (and
  ideally Vercel function logs).
- The cron still runs daily (`0 0 * * *`). Bumping to `*/15 * * * *`
  would make graduations self-heal in <15min. Trivial change but
  separate concern.
