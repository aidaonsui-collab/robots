module cetus_redeem::errors {
    public fun already_redeemed(): u64 { 8 }
    public fun amount_overflow(): u64 { 3 }
    public fun balance_not_enough(): u64 { 9 }
    public fun invalid_version(): u64 { 1 }
    public fun lock_time_not_end(): u64 { 7 }
    public fun not_attacked_position(): u64 { 12 }
    public fun percentage_not_equal(): u64 { 4 }
    public fun period_illegal(): u64 { 6 }
    public fun pool_not_match(): u64 { 10 }
    public fun position_not_match(): u64 { 11 }
    public fun release_time_error(): u64 { 2 }
    public fun version_deprecated(): u64 { 0 }
    public fun vesting_paused(): u64 { 5 }
    public fun vesting_period_not_match(): u64 { 13 }
}