module aida::aida {
    use sui::coin;
    use sui::tx_context;
    use std::option;
    use sui::transfer;
    use sui::tx_context::TxContext;

    // AIDA coin — matched to the on-chain deployed version
    public struct AIDA has drop {}

    // Init function for the coin
    fun init(witness: AIDA, ctx: &mut TxContext) {
        let (treasury, metadata) = coin::create_currency(
            AIDA {},
            9,  // decimals
            b"AIDA",
            b"Aida",
            b"Aida token on Odyssey",
            option::none(),
            ctx
        );
        transfer::public_freeze_object(metadata);
        transfer::public_transfer(treasury, tx_context::sender(ctx));
    }
}
