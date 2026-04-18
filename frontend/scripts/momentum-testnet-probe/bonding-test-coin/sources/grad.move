/// Bonding-curve-compatible test coin for graduation E2E.
/// - 6 decimals (matches bonding curve Configuration)
/// - Zero supply at init (required by create_with_fee)
/// - Metadata transferred as owned object (not frozen — bonding curve stores it)
module bonding_test_coin::grad {
    use sui::coin;

    public struct GRAD has drop {}

    fun init(witness: GRAD, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency<GRAD>(
            witness,
            6,
            b"GRAD",
            b"Graduation Test",
            b"Testnet graduation E2E test coin",
            option::none(),
            ctx
        );
        transfer::public_transfer(treasury_cap, ctx.sender());
        transfer::public_transfer(metadata, ctx.sender());
    }
}
