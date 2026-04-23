# moonbags_aida V4 — Cetus auto-migration (upgrade, not republish)

## What changed

V3 ended a bonding curve by dumping `real_token_reserves + real_sui_reserves`
to the admin wallet (`BONDING_DEPLOYER = 0x2957…7409`) via `transfer_pool`.
V4 adds one new entry function — `init_cetus_aida_pool` — that accepts those
dumped coins back in, creates a Coin<Token, AIDA> Cetus pool with full-range
liquidity, burns the LP with `lp_burn`, and stores the burn proof on the
bonding pool as a `BURN_PROOF_FIELD` dynamic field.

Nothing else was touched. No struct layouts change, no existing function
signatures change — this is a pure Move upgrade on top of the live V3
package `0x69079609…`, not a fresh republish.

## Why upgrade rather than full v4 republish with `bonding_dex`

Mirroring the SUI fork's "buy tx that fills the curve creates the Cetus
pool in the same tx" pattern would require threading Cetus objects and
`metadata_aida` through every AIDA buy/create entry — ~8 signatures, a
breaking frontend change, and a fresh package with a new Configuration /
StakeConfig / LockConfig set. That's the right long-term shape but not
what a test migration needs. This upgrade keeps the cron-based flow:

1. User buy fills the curve → `transfer_pool` dumps → `PoolMigratingEvent` fires.
2. Cron (or admin, manually) picks up the event and calls `init_cetus_aida_pool`
   within seconds using the coins that just landed in the admin wallet.

End-to-end delay: usually < 10s. Cetus pool exists, LP is burned, no
manual DEX babysitting.

## Steps

```bash
# 1. Sanity-build locally
cd contracts/moonbags_aida
sui move build

# 2. Dry-run the upgrade to surface any ABI/compat errors cheaply
#    Replace <UPGRADE_CAP> with the UpgradeCap object ID from the V3 publish
sui client upgrade \
  --upgrade-capability <UPGRADE_CAP> \
  --gas-budget 500000000 \
  --dry-run

# 3. Real upgrade
sui client upgrade \
  --upgrade-capability <UPGRADE_CAP> \
  --gas-budget 500000000

# 4. Roll Configuration.version forward so `assert_version` lets new
#    callers through (optional — V4 keeps `version <= VERSION` semantics
#    so this is belt-and-suspenders).
sui client call \
  --package <NEW_V4_PACKAGE_ID> \
  --module moonbags_aida --function migrate_version \
  --args <AdminCap> 0xb9d1ca5653dda324f219ee6beef1114d8ba2a2f48af05c311d553eb27bcdb820
```

**Capture from the upgrade output:** the new versioned `packageId` that
Sui assigns to the upgraded module. That's the address you pass to
`sui client call` when invoking `init_cetus_aida_pool`. Shared objects
(`Configuration`, `StakeConfig`, `TokenLockConfig`, `ThresholdConfig`)
stay at their existing V3 addresses — do not re-initialize them.

## How to call `init_cetus_aida_pool` after a graduation

Arguments (all 9 excluding ctx):

| # | Name | Where it comes from |
|---|---|---|
| 0 | `admin: address` | Typically the signer — `0x2957…7409` |
| 1 | `coin_aida: Coin<AIDA>` | The AIDA that `transfer_pool` dumped to the admin wallet |
| 2 | `coin_token: Coin<Token>` | The Token that `transfer_pool` dumped to the admin wallet |
| 3 | `pool: &mut Pool<Token>` | Accessed via `dynamic_object_field` on the v3 Configuration, keyed by the token's type address |
| 4 | `cetus_burn_manager: &mut BurnManager` | `0x1d94aa32…f845` (mainnet) |
| 5 | `cetus_pools: &mut Pools` | `0xf699e7f2…d198d0` (mainnet) |
| 6 | `cetus_config: &mut GlobalConfig` | `0xdaa46292…a3d8f` (mainnet) |
| 7 | `metadata_aida: &CoinMetadata<AIDA>` | `0x591bd6e9…fd99f8` (mainnet singleton) |
| 8 | `metadata_token: &CoinMetadata<Token>` | Frozen at `create_and_lock_first_buy_with_fee` time — look up via `suix_getCoinMetadata` for the token's coin type |
| 9 | `clock: &Clock` | `0x6` |

The function asserts `pool.is_completed`, so calling it before the curve
fills will abort. Typical cron flow:

```typescript
// Pseudocode — listen for PoolMigratingEvent, then:
const tx = new Transaction()
tx.moveCall({
  target: `${V4_PACKAGE}::moonbags::init_cetus_aida_pool`,
  typeArguments: [tokenCoinType],
  arguments: [
    tx.pure.address(ADMIN_ADDR),
    tx.object(adminsAidaCoinObjId),       // the ~threshold AIDA just received
    tx.object(adminsTokenCoinObjId),       // the remain+real token coin just received
    tx.object(bondingPoolObjId),
    tx.object(CETUS.burnManager),
    tx.object(CETUS.pools),
    tx.object(CETUS.globalConfig),
    tx.object(AIDA_METADATA_ID),
    tx.object(tokenMetadataObjId),
    tx.object(SUI_CLOCK),
  ],
})
```

A production cron would look up `bondingPoolObjId` from the
`pool_id` field on `PoolMigratingEvent` (the event emits `token_address`;
derive the pool via `suix_getDynamicFieldObject` on the V3 Configuration).

## Risk checklist

- [ ] `sui move build` clean — no unresolved Cetus symbols (Move.toml already
      lists `CetusClmm` + `LpBurn` as deps; no change needed there).
- [ ] `sui client upgrade --dry-run` reports only `Added new function
      `init_cetus_aida_pool`` as the diff vs v3.
- [ ] First mainnet graduation after upgrade creates the Cetus pool within
      the expected ~5s cron window; `BURN_PROOF_FIELD` populated on the
      pool object confirms LP is locked.
- [ ] Confirm Cetus object IDs on mainnet are still current — `BurnManager`
      and `Pools` upgrade periodically. If Cetus republishes, update the
      addresses passed to `init_cetus_aida_pool`, not the Move code.
