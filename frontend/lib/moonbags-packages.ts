// ─────────────────────────────────────────────────────────────────────────
// Every Moonbags package id whose `CreatedEventV2` / `TradedEventV2` events
// the catalog functions in `tokens.ts` need to fan out across.
//
// Sui anchors event type signatures to a publish chain's *original-id*. So
// any package that's a fresh mainnet publish (not an upgrade) emits events
// under its own id. Upgrades stay under the chain's original id forever.
//
// Result: every fresh publish is a separate event namespace and must be
// listed here. Missing one = those tokens, trades, volume, and rewards
// disappear from the homepage / token detail pages / stats / cron payouts.
//
// This module is split out from `tokens.ts` so adding a new publish is a
// one-line change instead of an edit to a 28 KB file (which keeps timing
// out on stream uploads — see the V13/V14 omission that this commit fixes).
// ─────────────────────────────────────────────────────────────────────────

import { MOONBAGS_CONTRACT_V12 } from './contracts'

// Legacy origin of the Moonbags upgrade chain — events from any version
// in the chain (v5..v10) all show up under this package's event types.
export const ORIGIN_PACKAGE = '0x3c64691e02bcbb3e5ee685ffb2dd862156da0ed170628403b2753523f4f09ffd'

// V11 — fresh publish (not an upgrade of the legacy chain), so events
// live under its own id even though it now routes to the V12_PREV bundle.
export const V11_PACKAGE = '0xc87ab979e0f729549aceddc0be30ec6b14b9b244d0f029006241af3ce2455813'

// V12 has two live publishes:
//   - 2026-04-16 (PREV, no admin-settable fee)
//   - 2026-04-21 (CURRENT, admin-settable fee via Configuration field)
// Both still emit events because pools created under either publish
// continue trading. MOONBAGS_CONTRACT_V12.packageId tracks the *current*
// publish; the previous one is listed explicitly so its events still
// fan out to the UI.
export const V12_PACKAGE         = MOONBAGS_CONTRACT_V12.packageId
export const V12_PACKAGE_PREV    = '0x95bb61b03a5d476c2621b2b3f512e8fd5f0976260ce4e8d0d9a79ca64b658f4e'

// V13 — 2026-04-23 publish, first one to ship `bonding_dex: u8` +
// `init_cetus_pool` auto-migration. Fresh publish (not an upgrade of
// V12), so its events live under this id and were previously missing
// from EVENT_SOURCE_PACKAGES. Result: every V13-launched token, every
// V13 trade, and every V13 fee-distribution event was invisible to the
// homepage stats and the token-detail page.
export const V13_PACKAGE         = '0x46c9e43fd8407b7c28dcc4b96e871324cf47404630907d3333303c62497cda85'

// V14 — 2026-04-23 republish, current default for every new SUI-pair
// launch (`MOONBAGS_CONTRACT = MOONBAGS_CONTRACT_V14` in contracts.ts).
// Adds `setter_pool_creation_fee` so the launch fee is admin-mutable
// without a republish. Same fresh-publish event-namespace story as V13;
// previously missing from this list. Bug impact: every new SUI launch
// from 2026-04-23 forward was off-the-grid for catalog views.
export const V14_PACKAGE         = '0xd58106acf43da3ed75dbe6eef4603207a701ea6df659ed07c005bb517cfcc995'

// AIDA-paired fork. Same two-publish story as V12 — keep both ids.
//   - PREV (`0x2156ceed…`) — original 2026-04-18 publish.
//   - CURRENT (`0x593a2e87…`) — original-id of the V2 publish chain.
//     V2 was upgraded on 2026-04-23 to add `init_cetus_aida_pool` (new
//     versioned id `0x7555b1da…`), but Sui anchors event types to the
//     publish chain's original-id, so events from upgraded V2 still
//     emit under `0x593a2e87…`. Don't add the upgraded id here — it
//     would return zero events.
export const AIDA_PACKAGE          = '0x2156ceed0866b899840871add0efdae25799b2b22df1563922b5b01c011975a8'
export const AIDA_PACKAGE_CURRENT  = '0x593a2e87f393dcb14e0f8c88d587c04e9bc98295e13212e8992343377bf7f313'

// Every package that emits Moonbags events. Order doesn't matter
// functionally (callers Promise.all over it) but keep newest-first so
// it's easy to see at a glance whether the latest publish is wired up.
export const EVENT_SOURCE_PACKAGES = [
  V14_PACKAGE,
  V13_PACKAGE,
  V12_PACKAGE,
  V12_PACKAGE_PREV,
  V11_PACKAGE,
  ORIGIN_PACKAGE,
  AIDA_PACKAGE_CURRENT,
  AIDA_PACKAGE,
] as const
