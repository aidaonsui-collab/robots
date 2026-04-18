/// Minimal test coin for Momentum CLMM probe.
/// 6 decimals, 1B total supply minted to publisher on init.
module test_coin::probe {
    use sui::coin::{Self, TreasuryCap};

    public struct PROBE has drop {}

    fun init(witness: PROBE, ctx: &mut TxContext) {
        let (mut treasury_cap, metadata) = coin::create_currency(
            witness,
            6,                          // decimals
            b"PROBE",                   // symbol
            b"Probe Test Coin",         // name
            b"Momentum CLMM test coin", // description
            option::none(),             // icon url
            ctx,
        );
        // Mint 1B PROBE (1_000_000_000 * 10^6 = 1_000_000_000_000_000)
        let minted = coin::mint(&mut treasury_cap, 1_000_000_000_000_000, ctx);
        transfer::public_transfer(minted, ctx.sender());
        transfer::public_transfer(treasury_cap, ctx.sender());
        transfer::public_freeze_object(metadata);
    }
}
