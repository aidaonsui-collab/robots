module cetus_redeem::versioned {
    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;
    use sui::transfer;
    
    use cetus_redeem::admin_cap::AdminCap;
    use cetus_redeem::errors;
    
    struct Versioned has store, key {
        id: UID,
        version: u64,
    }
    
    public fun check_version(_versioned: &Versioned) {
        abort 0
    }
    
    public fun emergency_pause(_versioned: &mut Versioned, _: &AdminCap) {
        abort 0
    }
    
    public fun emergency_restore(_versioned: &mut Versioned, _: &AdminCap) {
        abort 0
    }
    
    fun init(_ctx: &mut TxContext) {
        abort 0
    }
    
    public fun upgrade(_versioned: &mut Versioned, _: &AdminCap) {
        abort 0
    }
    
    // decompiled from Move bytecode v6
}
 