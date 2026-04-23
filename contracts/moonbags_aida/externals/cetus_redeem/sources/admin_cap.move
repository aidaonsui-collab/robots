module cetus_redeem::admin_cap {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    
    struct AdminCap has store, key {
        id: UID,
    }
    
    fun init(ctx: &mut TxContext) {
        abort 0
    }
    
    // decompiled from Move bytecode v6
}
 