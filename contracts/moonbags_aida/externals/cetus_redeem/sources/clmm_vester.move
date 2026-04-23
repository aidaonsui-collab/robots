module cetus_redeem::clmm_vester {
    use sui::object::{UID, ID};
    use sui::balance::Balance;
    use sui::table::Table;
    use sui::clock::Clock;
    use sui::coin::Coin;
    use sui::tx_context::TxContext;
    use sui::event;
    use std::type_name::TypeName;
    use std::vector;
    
    use cetus::cetus::CETUS;
    use cetus_clmm::pool::Pool;
    use cetus_clmm::position::{Position, pool_id};
    // use cetus_clmm::position_snapshot::{tick_range, current_sqrt_price, value_cut, liquidity, remove_percent};
    use cetus_clmm::clmm_math;
    use cetus_clmm::tick_math;
    
    use cetus_redeem::versioned::{Versioned, check_version};
    use cetus_redeem::admin_cap::AdminCap;
    use cetus_redeem::errors;

    struct ClmmVester has key {
        id: UID,
        balance: Balance<CETUS>,
        global_vesting_periods: vector<GlobalVestingPeriod>,
        positions: Table<ID, PositionVesting>,
        total_value: u64,
        total_cetus_amount: u64,
        redeemed_amount: u64,
        start_time: u64,
    }
    
    struct GlobalVestingPeriod has copy, drop, store {
        period: u16,
        release_time: u64,
        percentage: u64,
        redeemed_amount: u64,
    }
    
    struct PositionVesting has copy, drop, store {
        position_id: ID,
        cetus_amount: u64,
        redeemed_amount: u64,
        coin_a: TypeName,
        coin_b: TypeName,
        impaired_a: u64,
        impaired_b: u64,
        period_details: vector<PeriodDetail>,
        is_paused: bool,
    }
    
    struct PeriodDetail has copy, drop, store {
        period: u64,
        cetus_amount: u64,
        is_redeemed: bool,
    }
    
    struct CreateEvent has copy, drop, store {
        clmm_vester_id: ID,
        total_value: u64,
        total_cetus_amount: u64,
        start_time: u64,
        coin_type: TypeName,
    }
    
    struct DepositEvent has copy, drop, store {
        clmm_vester_id: ID,
        amount: u64,
    }
    
    struct PauseEvent has copy, drop, store {
        clmm_vester_id: ID,
        position_id: ID,
    }
    
    struct RedeemEvent has copy, drop, store {
        clmm_vester_id: ID,
        position_id: ID,
        period: u16,
        amount: u64,
    }
    
    struct GetPositionsVestingEvent has copy, drop, store {
        position_vestings: vector<PositionVesting>,
    }
    
    public fun borrow_position_vesting(arg0: &ClmmVester, arg1: ID) : PositionVesting {
        abort 0
    }
    
    public fun calculate_cut_liquidity(arg0: u128, arg1: u64) : u128 {
        abort 0
    }
    
    public fun create(arg0: &Versioned, arg1: &AdminCap, arg2: vector<u64>, arg3: vector<u64>, arg4: u64, arg5: u64, arg6: &mut TxContext) {
        abort 0
    }
    
    public fun deposit(arg0: &Versioned, arg1: &mut ClmmVester, arg2: &mut Coin<CETUS>, arg3: u64, arg4: &mut TxContext) {
        abort 0
    }
    
    public fun detail_period(arg0: &PeriodDetail) : u64 {
        arg0.period
    }
    
    fun gen_position_vesting<T0, T1>(arg0: &ClmmVester, arg1: &Pool<T0, T1>, arg2: ID) : PositionVesting {
        abort 0
    }
    
    public fun get_position_vesting<T0, T1>(arg0: &ClmmVester, arg1: &Pool<T0, T1>, arg2: ID) : PositionVesting {
        abort 0
    }
    
    public fun get_positions_vesting<T0, T1>(arg0: &ClmmVester, arg1: &Pool<T0, T1>, arg2: vector<ID>) : vector<PositionVesting> {
        abort 0
    }
    
    public fun global_vesting_periods(arg0: &ClmmVester) : vector<GlobalVestingPeriod> {
        arg0.global_vesting_periods
    }
    
    public fun impaired_ab(arg0: &PositionVesting) : (u64, u64) {
        (arg0.impaired_a, arg0.impaired_b)
    }
    
    fun init_position_vesting<T0, T1>(arg0: &mut ClmmVester, arg1: &Pool<T0, T1>, arg2: ID) {
        abort 0
    }
    
    public fun is_paused(arg0: &PositionVesting) : bool {
        arg0.is_paused
    }
    
    public fun is_redeemed(arg0: &PeriodDetail) : bool {
        arg0.is_redeemed
    }
    
    public entry fun pause<T0, T1>(arg0: &mut ClmmVester, arg1: &Versioned, arg2: &AdminCap, arg3: &Pool<T0, T1>, arg4: ID) {
        abort 0
    }
    
    public fun percentage(arg0: &GlobalVestingPeriod) : u64 {
        arg0.percentage
    }
    
    public fun period(arg0: &GlobalVestingPeriod) : u16 {
        arg0.period
    }
    
    public fun period_cetus_amount(arg0: &PeriodDetail) : u64 {
        arg0.cetus_amount
    }
    
    public fun position_cetus_amount(arg0: &PositionVesting) : u64 {
        arg0.cetus_amount
    }
    
    public fun position_id(arg0: &PositionVesting) : ID {
        abort 0
    }
    
    public fun position_is_paused(arg0: &PositionVesting) : bool {
        arg0.is_paused
    }
    
    public fun position_period_details(arg0: &PositionVesting) : vector<PeriodDetail> {
        arg0.period_details
    }
    
    public fun position_redeemed_amount(arg0: &PositionVesting) : u64 {
        arg0.redeemed_amount
    }
    
    public fun redeem<T0, T1>(arg0: &Versioned, arg1: &mut ClmmVester, arg2: &Pool<T0, T1>, arg3: &mut Position, arg4: u16, arg5: &Clock) : Balance<CETUS> {
        abort 0
    }
    
    public fun release_time(arg0: &GlobalVestingPeriod) : u64 {
        arg0.release_time
    }
    
    public fun start_time(arg0: &ClmmVester) : u64 {
        arg0.start_time
    }
    
    public fun total_cetus_amount(arg0: &ClmmVester) : u64 {
        arg0.total_cetus_amount
    }
    
    public fun total_value(arg0: &ClmmVester) : u64 {
        arg0.total_value
    }
    
    // decompiled from Move bytecode v6
}
 