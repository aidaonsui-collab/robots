# Momentum DEX Testnet Probe

Self-contained, read-only scripts that answer one question:
**is Momentum (MMT) CLMM usable on Sui testnet?**

Neither script spends gas, needs a wallet, or mutates any state. Run them
in order, paste the output into the chat, and we can decide whether to
scope a real graduation/migration integration.

## Round 1 — `verify.mjs`

Confirms the basic infrastructure exists:

1. `MmtSDK.NEW({ network: 'testnet' })` initializes without throwing
2. SDK exposes a package ID (auto-detected by probing common field names)
3. SDK exposes a GlobalConfig object ID
4. Both objects actually exist on Sui testnet via `sui_getObject`
5. SDK can list pools (probes a handful of common method names)

## Round 2 — `verify-2-build-tx.mjs`

Confirms we can actually build a `create_pool` transaction against the
testnet package:

1. Deep-introspects every method on `poolModule`, `positionModule`,
   `rpcModule`, `routeModule`, and `aggregatorModule`
2. Hunts for create-pool entry points by name
3. Tries to build (NOT submit) a `create_pool` transaction with several
   common arg shapes — full error messages, no truncation
4. Reports whether at least one shape produced a valid PTB

If anything fails, the dumps in both scripts show the raw SDK shape so we
can read the actual field/method names and adjust on the next round.

## Round 3 — `verify-3.mjs`

Switches to RPC-based Move introspection (`getNormalizedMoveFunction` /
`getNormalizedMoveModulesByPackage`) and uses the **positional** form of
`createPool(txb, fee_rate, price, coinX, coinY, decX, decY, useMvr)` that
the SDK actually exposes. Confirms `useMvr=false` is the production-safe
toggle and that a 600B `create_pool` PTB builds against the live testnet
package.

Requires `@mysten/sui` ≥ 1.30 (for `Transaction.addSerializationPlugin`).

## Round 4 — `verify-4.mjs`

Locks down the rest of the API surface needed for a full graduation flow:

1. Dumps every function in `create_pool`, `liquidity`, and `position`
   modules with full Move signatures (visibility, type params, params,
   return) — these are the modules where the public entry points actually
   live (round 3 showed `pool::add_liquidity` / `pool::collect_fee` are
   friend-visible internals, not callable from a PTB)
2. Tries SDK build paths for `openPosition`, `addLiquidity`,
   `addLiquiditySingleSided`, and `collectFee` with `useMvr=false`
3. Composes a single PTB doing `createPool → openPosition → addLiquidity`
   to validate the SDK can chain calls without internal explosions

If Part A's signatures + Parts B/C build cleanly, day-1 code can be
written with no further guessing.

## Run it

```bash
cd scripts/momentum-testnet-probe
npm install
node verify.mjs
node verify-2-build-tx.mjs
node verify-3.mjs
node verify-4.mjs
```

Capture the **full** output of each — don't trim. The method dumps and
error messages are exactly what we'll use to fix anything that breaks.

## Exit codes

- `0` — all checks passed, safe to proceed
- `2` — some checks failed (script still completes and dumps diagnostics)
- `1` — fatal: SDK couldn't even initialize
