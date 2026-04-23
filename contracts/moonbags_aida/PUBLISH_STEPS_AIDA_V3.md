# Publish runbook — moonbags_aida v3 (Cetus auto-migration for AIDA pairs)

**Goal:** republish `moonbags_aida` so AIDA-paired tokens (like NUT) can
auto-migrate to Cetus on bonding-curve completion instead of dumping to
the admin wallet. This is **phase 2** of the Cetus/Turbos DEX work —
moonbags-contracts-sui v13 already ships this for SUI pairs; now the
AIDA fork needs the same.

This is a **fresh publish** (not Move upgrade) — struct layouts change
(`bonding_dex: u8` on `Pool`/events, `COIN_METADATA_FIELD` dynamic
field). Existing AIDA-pair tokens on `0x593a2e…` (CURRENT) and
`0x2156ce…` (PREV) keep their current admin-dump migration path; only
NEW tokens minted under v3 get auto-Cetus.

---

## What's already done on branch

The `robots` repo already has:

1. **`contracts/moonbags_aida/externals/`** — Cetus CLMM, LP burn,
   Turbos CLMM, integer-mate, move-stl, token, cetus_redeem all copied
   over from `moonbags-contracts-sui/externals/`. Match versions
   exactly — don't swap.

2. **`contracts/moonbags_aida/Move.toml`** — updated to depend on
   `CetusClmm`, `LpBurn`, `TurbosCLMM` (local paths).

**Sanity check before starting:**
```bash
cd ~/dev/robots/contracts/moonbags_aida
git pull
ls externals/               # should list: cetus_clmm cetus_redeem integer-mate lp_burn move-stl token turbos_clmm
cat Move.toml | grep -E "Cetus|Turbos|LpBurn"
sui move build              # should pass against current AIDA source
```

If `sui move build` passes cleanly with no output, you're ready.

---

## What you need to add to `sources/moonbags_aida.move`

This is where the Move work lives. All six edits below mirror what
`moonbags-contracts-sui/sources/moonbags.move` already does for the SUI
pair — **reference it line-by-line as you go**:

```bash
# Keep this file open in a second terminal for side-by-side comparison
less ~/dev/moonbags-contracts-sui/sources/moonbags.move
```

The changes swap every `Coin<SUI>` → `Coin<AIDA>`, `metadata_sui` →
`metadata_aida`, and the Cetus type-parameter order stays `<Token, AIDA>`
instead of `<Token, SUI>`.

### Edit 1 — add imports (after line 18 in `moonbags_aida.move`)

After `use moonbags_aida::moonbags_token_lock::...`, add:

```move
// Cetus CLMM auto-migration (mirrors moonbags.move:20-30).
use cetus_clmm::factory::Pools;
use cetus_clmm::pool_creator::{Self};
use cetus_clmm::config::GlobalConfig;
use cetus_clmm::pool::{Pool as CetusPool};
use lp_burn::lp_burn::{Self, BurnManager};
// Turbos placeholders (admin-dump fallback until init_turbos_aida_pool ships)
use turbos_clmm::position_manager::{Positions as TurbosPositions};
use turbos_clmm::pool::{Pool as TurbosPool, Versioned as TurbosVersioned};
use turbos_clmm::position_nft::TurbosPositionNFT;
```

### Edit 2 — add constants (after line 43, the existing "Dynamic Fields" block)

```move
const BONDING_DEX_FIELD: vector<u8> = b"migrate_dex";
const BURN_PROOF_FIELD: vector<u8> = b"cetus_burn_proof";
const COIN_METADATA_FIELD: vector<u8> = b"coin_metadata";

// === DEX selector ===
const CETUS_DEX: u8 = 0;
const TURBOS_DEX: u8 = 1;
const BONDING_SUPPORT_DEXES: vector<u8> = vector[CETUS_DEX, TURBOS_DEX];
```

### Edit 3 — thread `bonding_dex: u8` into `create_with_fee` (line ~316)

Find the `public entry fun create_with_fee<Token>(...)` signature and
add `bonding_dex: u8` as a parameter **right after `pool_creation_fee`**
(same position as the SUI fork at `moonbags.move:346`). Then inside the
function body, **before** the `emit<CreatedEventV2>(...)` call:

```move
// Persist the DEX selection on the pool so the graduation path can read it.
assert!(vector::contains(&BONDING_SUPPORT_DEXES, &bonding_dex), EInvalidInput);
dynamic_field::add(&mut pool.id, BONDING_DEX_FIELD, bonding_dex);

// Store metadata_token on the pool instead of freezing it — we need it
// later for Cetus pool_creator::create_pool_v2 at graduation. It gets
// frozen at graduation time inside transfer_pool.
dynamic_object_field::add(&mut pool.id, COIN_METADATA_FIELD, metadata_token);
```

And **remove** the existing `transfer::public_freeze_object(metadata_token)` call at line 389 — metadata is now frozen inside `transfer_pool` instead.

Also in the `CreatedEventV2` emit, change the hardcoded `bonding_dex: 0` to `bonding_dex: bonding_dex`.

### Edit 4 — same thread on `create_and_lock_first_buy_with_fee` (line ~609)

Mirror Edit 3 on the second create function. Same parameter
placement, same assert + dynamic field add, same metadata rewire,
same event field update.

### Edit 5 — add `init_cetus_aida_pool` (new function, paste anywhere after `transfer_pool`)

This is the core Cetus integration. Copy-paste from
`moonbags.move:1246` and do the SUI→AIDA swap:

```move
/* Mirror of moonbags::moonbags::init_cetus_pool, quote coin is AIDA.
   Tick math (-443636 to 443600, spacing 200, Q64 sqrt price) is identical
   to the SUI fork because Cetus tick layout is pool-agnostic. */
public entry fun init_cetus_aida_pool<Token>(
    admin: address,
    coin_aida: Coin<AIDA>,
    coin_token: Coin<Token>,
    pool: &mut Pool<Token>,
    cetus_burn_manager: &mut BurnManager,
    cetus_pools: &mut Pools,
    cetus_config: &mut GlobalConfig,
    metadata_aida: &CoinMetadata<AIDA>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let token_amount = coin::value<Token>(&coin_token) as u256;
    let aida_amount  = coin::value<AIDA>(&coin_aida)  as u256;
    let metadata_token = dynamic_object_field::borrow(&pool.id, COIN_METADATA_FIELD);

    let icon_url = if (coin::get_icon_url<Token>(metadata_token).is_some()) {
        coin::get_icon_url<Token>(metadata_token).extract().inner_url().to_string()
    } else {
        string::utf8(b"")
    };

    let (position, coin_token, coin_aida) = pool_creator::create_pool_v2<Token, AIDA>(
        cetus_config, cetus_pools, 200,
        sqrt(340282366920938463463374607431768211456 * aida_amount / token_amount),
        icon_url, 4294523696, 443600,
        coin_token, coin_aida, metadata_token, metadata_aida,
        true, clock, ctx
    );
    let burn_proof = lp_burn::burn_lp_v2(cetus_burn_manager, position, ctx);
    dynamic_object_field::add(&mut pool.id, BURN_PROOF_FIELD, burn_proof);
    transfer::public_transfer<Coin<Token>>(coin_token, admin);
    transfer::public_transfer<Coin<AIDA>>(coin_aida, admin);
}
```

**Also copy the `sqrt` helper** from `moonbags.move:1538` into the
bottom of the module (it takes `u256` → `u128` via Newton's method).

### Edit 6 — branch `transfer_pool` on `bonding_dex` (line ~945)

Current `transfer_pool` dumps everything to admin. Replace its body (after
the PoolMigratingEvent emit) with:

```move
let bonding_dex_exists = dynamic_field::exists_<vector<u8>>(&pool.id, BONDING_DEX_FIELD);
let bonding_dex = if (bonding_dex_exists) {
    *dynamic_field::borrow<vector<u8>, u8>(&pool.id, BONDING_DEX_FIELD)
} else {
    TURBOS_DEX  // pre-v3 pools (can't reach this branch post-v3, defensive)
};

if (bonding_dex == CETUS_DEX) {
    // AIDA-pair Cetus auto-migration
    let metadata_aida = /* NEED: pass or fetch mainnet CoinMetadata<AIDA> — see note */;
    init_cetus_aida_pool<Token>(
        admin, coin_sui /*aida*/, coin_token,
        pool, cetus_burn_manager, cetus_pools, cetus_global_config,
        metadata_aida, clock, ctx
    );
} else {
    // TURBOS_DEX — admin-dump fallback (same as current behavior)
    transfer::public_transfer<Coin<Token>>(coin_token, admin);
    transfer::public_transfer<Coin<AIDA>>(coin_sui, admin);
};

// Freeze metadata_token now that migration is done
let metadata_token = dynamic_object_field::remove<vector<u8>, CoinMetadata<Token>>(&mut pool.id, COIN_METADATA_FIELD);
transfer::public_freeze_object(metadata_token);

// Update PoolMigratingEvent emit from `bonding_dex: 0` to `bonding_dex: bonding_dex`
```

**IMPORTANT caveat on `transfer_pool` signature:** Currently it only
takes `admin: address, pool, clock, ctx`. To call `init_cetus_aida_pool`
it needs to receive `cetus_burn_manager`, `cetus_pools`,
`cetus_global_config`, `metadata_aida` as additional parameters from
its caller. That caller is likely `buy_token<Token>` or wherever
`transfer_pool` is called when the curve fills — you'll need to thread
those args up through that call chain. Mirror what `moonbags.move`
does at `:1077` — its `fill_curve_and_migrate` helper takes them all.

### Mainnet AIDA metadata ID

The `metadata_aida: &CoinMetadata<AIDA>` argument comes from mainnet.
Query it so you have the ID before you start:

```bash
sui client objects --json | jq '.[] | select(.objectType | contains("CoinMetadata") and contains("aida"))'
# OR
sui client object 0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892 --json | grep -A 2 metadata
```

Capture the `CoinMetadata<AIDA>` object ID — it's a well-known singleton
on mainnet. You'll plug it into the frontend tx builder.

---

## Publish steps (after Move changes build clean)

```bash
cd ~/dev/robots/contracts/moonbags_aida

# 1. Confirm it builds
sui move build

# 2. Switch to mainnet + confirm wallet
sui client switch --env mainnet
sui client active-address    # the admin wallet that'll own the new AdminCap
sui client gas               # need ~10 SUI

# 3. Dry-run
sui client publish --gas-budget 500000000 --dry-run

# 4. Real publish
sui client publish --gas-budget 500000000
```

## What to capture

| Variable | How to find it in the output |
|---|---|
| `packageId` | "Published to: 0x…" line |
| `Configuration` (AIDA fork's own) | type `<pkg>::moonbags::Configuration` |
| `stakeConfig` | type `<pkg>::moonbags_stake::Configuration` |
| `lockConfig` | type `<pkg>::moonbags_token_lock::TokenLockConfig` |
| `thresholdConfig` | type `<pkg>::moonbags::ThresholdConfig` |
| `AdminCap` | type `<pkg>::moonbags::AdminCap` |
| `metadataAida` | Mainnet `CoinMetadata<AIDA>` object ID (step above) |

## Step — initialize ThresholdConfig

```bash
sui client call \
  --package <NEW_PKG_ID> \
  --module moonbags \
  --function create_threshold_config \
  --args <AdminCap_objectId> 2000000000000 \
  --gas-budget 10000000
```

(2000000000000 MIST = 2000 AIDA. Adjust if AIDA-paired thresholds
should differ from SUI-paired defaults.)

---

## Frontend wiring — don't edit, send me the IDs

Once the publish succeeds, **send me these values in a single message**
and I'll handle the frontend updates:

- `packageId`
- `Configuration`
- `stakeConfig`
- `lockConfig`
- `thresholdConfig`
- `AdminCap`
- Any other shared objects the Move init creates
- `metadataAida` (the `CoinMetadata<AIDA>` object ID you captured)

I'll then:
- Add `MOONBAGS_AIDA_CONTRACT_V3` to `robots/frontend/lib/contracts_aida.ts`
- Flip the default to V3 so new AIDA-pair creations route to it
- Un-hide the Cetus/Turbos radio selector on the create form for AIDA pairs
- Add a V3 branch to the DEX-aware tx block (mirror of the V13 branch for SUI pairs, but with `metadataAida` object and `<Token, AIDA>` type args)

Existing tokens on `0x593a2e…` and `0x2156ce…` continue to use the
admin-dump path via `getMoonbagsContractForPackage()` routing — they're
unaffected.

---

## Rollback

If the publish has a bug:
- Don't update `contracts_aida.ts`
- The old AIDA fork packages keep working unchanged
- Fix the Move bug, re-publish, send me the new IDs

The v3 package sits on-chain with zero pools under it until you point
the frontend at it.

## What NOT to do

- ❌ Don't `sui client upgrade` — fresh publish only (struct layout changed)
- ❌ Don't re-use v2's shared objects — the new `bonding_dex` dynamic field + `COIN_METADATA_FIELD` require fresh ones
- ❌ Don't modify `externals/` — the Cetus tick math depends on those exact versions

## Phase 2b (not in this publish)

`init_turbos_aida_pool` is still stubbed — Turbos falls back to
admin-dump on AIDA pairs. Same work as moonbags.move's `init_cetus_pool`
but targeting Turbos' `position_manager`. Do it after v3 is verified
working for Cetus. Runbook section to be written then.

## Presale

`theodyssey2/contracts/presale/sources/presale.move:680` still dumps to
admin. Separate work — not part of this publish. It'll be
`PUBLISH_STEPS_PRESALE_V2.md`, same playbook adapted for the presale
contract (which emits `PresaleMigratingEvent`). Skip until v3 is solid.
