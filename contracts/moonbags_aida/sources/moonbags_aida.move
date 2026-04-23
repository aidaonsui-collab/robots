#[allow(lint(self_transfer), implicit_const_copy)]
module moonbags_aida::moonbags {
    use std::ascii::{Self, String};
    use std::string;
    use std::type_name;
    use std::u64::min;

    use sui::coin::{Self, Coin, CoinMetadata};
    use 0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA;
    use sui::dynamic_object_field;
    use sui::dynamic_field;
    use sui::event::emit;
    use sui::clock::{Clock, Self};

    use moonbags_aida::curves;
    use moonbags_aida::utils;
    use moonbags_aida::moonbags_stake::{Self, Configuration as StakeConfig};
    use moonbags_aida::moonbags_token_lock::{Self, Configuration as TokenLockConfig};

    // V4 upgrade (2026-04-23): Cetus auto-migration deps. Added via upgrade on
    // top of the live V3 package — no struct layout changes, so all existing
    // pools / shared objects carry over unchanged. Admin (or a cron watching
    // PoolMigratingEvent) calls `init_cetus_aida_pool` after each graduation
    // to create the Coin<Token, AIDA> Cetus pool and burn the LP position.
    use cetus_clmm::factory::Pools;
    use cetus_clmm::pool_creator;
    use cetus_clmm::config::GlobalConfig;
    use lp_burn::lp_burn::{Self, BurnManager};

    // === Constants Config ===
    const DEFAULT_THRESHOLD: u64 = 2000000000000; // 2000 SUI
    const MINIMUM_THRESHOLD: u64 = 1000000000000; // 1000 SUI minimum
    const VERSION: u64 = 5;
    const FEE_DENOMINATOR: u64 = 10000;
    const DISTRIBUTE_FEE_LOCK_DURATION_MS: u64 = 300_000; // 5 minutes
    // Deprecated — fee now lives on `Configuration.pool_creation_fee`,
    // mutable via `setter_pool_creation_fee`. Kept to preserve ABI and as
    // a sentinel default for any caller still reading it from storage.
    #[allow(unused_const)]
    const POOL_CREATION_FEE: u64 = 10_000_000; // 0.01 SUI (legacy)
    const MIGRATION_FEE: u64 = 50_000_000_000; // 50 SUI sent to treasury on graduation

    // === Constants Addresses ===
    // Odyssey admin wallet — receives graduated pool funds for manual DEX pool creation
    const BONDING_DEPLOYER: address = @0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409;
    const PLATFORM_TOKEN_BUYER: address = @0x2957f0f19ee92eb5283bf1aa6ce7a3742ea7bc79bc9d1dc907fbbf7a11567409;

    // === Constants Dynamic Fields ===
    const VIRTUAL_TOKEN_RESERVES_FIELD: vector<u8> = b"virtual_token_reserves";
    const DISTRIBUTE_FEE_LOCK_TIME_FIELD: vector<u8> = b"fee_lock_time";
    const POOL_CREATION_TIMESTAMP_FIELD: vector<u8> = b"pool_creation_timestamp";
    const BUY_BLOCK_DURATION_FIELD: vector<u8> = b"buy_block_duration";
    const LOCK_BUY_DURATION_FIELD: vector<u8> = b"lock_buy_duration";
    // V4: stores the Cetus LP burn proof on the completed bonding pool so
    // anyone can verify liquidity was locked.
    const BURN_PROOF_FIELD: vector<u8> = b"burn_proof";

    const EInvalidInput: u64 = 1;
    const ENotEnoughThreshold: u64 = 2;
    const EWrongVersion: u64 = 3;
    const ECompletedPool: u64 = 4;
    const EInsufficientInput: u64 = 5;
    const EExistTokenSupply: u64 = 6;
    const EPoolNotComplete: u64 = 7;
    #[allow(unused)]
    const ENotUpgrade: u64 = 8;
    const EInvalidWithdrawPool: u64 = 9;
    const EInvalidWithdrawAmount: u64 = 10;
    const EInvalidDistributeFeeTime: u64 = 11;

    public struct AdminCap has key {
        id: UID,
    }

    public struct Configuration has store, key {
        id: UID,
        version: u64,
        admin: address,
        treasury: address,
        fee_platform_recipient: address,
        platform_fee: u64,
        initial_virtual_token_reserves: u64,
        remain_token_reserves: u64,
        token_decimals: u8,
        init_platform_fee_withdraw: u16,
        init_creator_fee_withdraw: u16,
        init_stake_fee_withdraw: u16,
        init_platform_stake_fee_withdraw: u16,
        token_platform_type_name: String,
        // Mutable via `setter_pool_creation_fee`. Replaces the old compiled
        // `POOL_CREATION_FEE` constant so the admin can retune the launch
        // price without a republish. Stored in the pair coin's mist (9d).
        pool_creation_fee: u64,
    }

    public struct ThresholdConfig has store, key {
        id: UID,
        threshold: u64,
    }

    #[allow(lint(coin_field))]
    public struct Pool<phantom Token> has store, key {
        id: UID,
        real_sui_reserves: Coin<AIDA>,
        real_token_reserves: Coin<Token>,
        virtual_token_reserves: u64,
        virtual_sui_reserves: u64,
        remain_token_reserves: Coin<Token>,
        fee_recipient: Coin<AIDA>,
        is_completed: bool,
        platform_fee_withdraw: u16,
        creator_fee_withdraw: u16,
        stake_fee_withdraw: u16,
        platform_stake_fee_withdraw: u16,
        threshold: u64,
    }

    #[allow(unused)]
    public struct ConfigChangedEvent has copy, drop, store {
        old_platform_fee: u64,
        new_platform_fee: u64,
        old_initial_virtual_token_reserves: u64,
        new_initial_virtual_token_reserves: u64,
        old_remain_token_reserves: u64,
        new_remain_token_reserves: u64,
        old_token_decimals: u8,
        new_token_decimals: u8,
        old_init_platform_fee_withdraw: u16,
        new_init_platform_fee_withdraw: u16,
        old_init_creator_fee_withdraw: u16,
        new_init_creator_fee_withdraw: u16,
        old_init_stake_fee_withdraw: u16,
        new_init_stake_fee_withdraw: u16,
        old_init_platform_stake_fee_withdraw: u16,
        new_init_platform_stake_fee_withdraw: u16,
        old_token_platform_type_name: String,
        new_token_platform_type_name: String,
        ts: u64,
    }

    #[allow(unused)]
    public struct CreatedEvent has copy, drop, store {
        name: String,
        symbol: String,
        uri: String,
        description: String,
        twitter: String,
        telegram: String,
        website: String,
        token_address: String,
        bonding_curve: String,
        pool_id: ID,
        created_by: address,
        virtual_sui_reserves: u64,
        virtual_token_reserves: u64,
        real_sui_reserves: u64,
        real_token_reserves: u64,
        platform_fee_withdraw: u16,
        creator_fee_withdraw: u16,
        stake_fee_withdraw: u16,
        platform_stake_fee_withdraw: u16,
        threshold: u64,
        ts: u64,
    }

    #[allow(unused)]
    public struct OwnershipTransferredEvent has copy, drop, store {
        old_admin: address,
        new_admin: address,
        ts: u64,
    }

    #[allow(unused)]
    public struct PoolCompletedEvent has copy, drop, store {
        token_address: String,
        lp: String,
        ts: u64,
    }

    #[allow(unused)]
    public struct TradedEvent has copy, drop, store {
        is_buy: bool,
        user: address,
        token_address: String,
        sui_amount: u64,
        token_amount: u64,
        virtual_sui_reserves: u64,
        virtual_token_reserves: u64,
        real_sui_reserves: u64,
        real_token_reserves: u64,
        pool_id: ID,
        fee: u64,
        ts: u64,
    }

    public struct ConfigChangedEventV2 has copy, drop, store {
        old_platform_fee: u64,
        new_platform_fee: u64,
        old_initial_virtual_token_reserves: u64,
        new_initial_virtual_token_reserves: u64,
        old_remain_token_reserves: u64,
        new_remain_token_reserves: u64,
        old_token_decimals: u8,
        new_token_decimals: u8,
        old_init_platform_fee_withdraw: u16,
        new_init_platform_fee_withdraw: u16,
        old_init_creator_fee_withdraw: u16,
        new_init_creator_fee_withdraw: u16,
        old_init_stake_fee_withdraw: u16,
        new_init_stake_fee_withdraw: u16,
        old_init_platform_stake_fee_withdraw: u16,
        new_init_platform_stake_fee_withdraw: u16,
        old_token_platform_type_name: String,
        new_token_platform_type_name: String,
        ts: u64,
    }

    public struct CreatedEventV2 has copy, drop, store {
        name: String,
        symbol: String,
        uri: String,
        description: String,
        twitter: String,
        telegram: String,
        website: String,
        token_address: String,
        bonding_curve: String,
        pool_id: ID,
        created_by: address,
        virtual_sui_reserves: u64,
        virtual_token_reserves: u64,
        real_sui_reserves: u64,
        real_token_reserves: u64,
        platform_fee_withdraw: u16,
        creator_fee_withdraw: u16,
        stake_fee_withdraw: u16,
        platform_stake_fee_withdraw: u16,
        threshold: u64,
        bonding_dex: u8,
        ts: u64,
    }

    public struct OwnershipTransferredEventV2 has copy, drop, store {
        old_admin: address,
        new_admin: address,
        ts: u64,
    }

    public struct PoolCompletedEventV2 has copy, drop, store {
        token_address: String,
        lp: String,
        ts: u64,
    }

    public struct PoolMigratingEvent has copy, drop, store {
        token_address: String,
        sui_amount: u64,
        token_amount: u64,
        bonding_dex: u8,
        ts: u64,
    }

    public struct TradedEventV2 has copy, drop, store {
        is_buy: bool,
        user: address,
        token_address: String,
        sui_amount: u64,
        token_amount: u64,
        virtual_sui_reserves: u64,
        virtual_token_reserves: u64,
        real_sui_reserves: u64,
        real_token_reserves: u64,
        pool_id: ID,
        fee: u64,
        ts: u64,
    }

    fun init(ctx: &mut TxContext) {
        let admin = AdminCap {
            id: object::new(ctx),
        };

        let mut configuration = Configuration {
            id: object::new(ctx),
            version: VERSION,
            admin: ctx.sender(),
            treasury: @0x92a32ac7fd525f8bd37ed359423b8d7d858cad26224854dfbff1914b75ee658b,
            fee_platform_recipient: @0x92a32ac7fd525f8bd37ed359423b8d7d858cad26224854dfbff1914b75ee658b,
            platform_fee: 200, // 2%
            initial_virtual_token_reserves: 1066666667000000,      // I = ~1.067B tokens
            remain_token_reserves: 4266666668000000,               // R = 4 * I (matches Moonbags depth)
            token_decimals: 6,
            init_platform_fee_withdraw: 4000,                      // 40% platform/treasury
            init_creator_fee_withdraw: 3000,                       // 30% creator
            init_stake_fee_withdraw: 1,                            // ~0% meme stakers (must be >0)
            init_platform_stake_fee_withdraw: 2999,                // ~30% AIDA stakers
            token_platform_type_name: b"cee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA".to_ascii_string(),
            pool_creation_fee: 5_000_000_000,                      // 5 AIDA at launch; admin can retune
        };
        
        dynamic_field::add(&mut configuration.id, BUY_BLOCK_DURATION_FIELD, 1000);
        dynamic_field::add(&mut configuration.id, LOCK_BUY_DURATION_FIELD, 0);

        transfer::public_share_object<Configuration>(configuration);

        transfer::transfer(admin, ctx.sender());
    }

    public entry fun create_with_fee<Token>(
        configuration: &mut Configuration,
        stake_config: &mut StakeConfig,
        mut treasury_cap: coin::TreasuryCap<Token>,
        metadata_token: CoinMetadata<Token>,
        mut pool_creation_fee: Coin<AIDA>,
        threshold: u64,
        clock: &Clock,
        name: String,
        symbol: String,
        uri: String,
        description: String,
        twitter: String,
        telegram: String,
        website: String,
        ctx: &mut TxContext
    ) {
        assert!(ascii::length(&uri) <= 300, EInvalidInput);
        assert!(ascii::length(&description) <= 1000, EInvalidInput);
        assert!(ascii::length(&twitter) <= 500, EInvalidInput);
        assert!(ascii::length(&telegram) <= 500, EInvalidInput);
        assert!(ascii::length(&website) <= 500, EInvalidInput);
        assert!(coin::value<AIDA>(&pool_creation_fee) >= configuration.pool_creation_fee, EInvalidInput);

        assert_version(configuration.version);
        assert!(coin::total_supply<Token>(&treasury_cap) == 0, EExistTokenSupply);

        let threshold = if (threshold == 0) { DEFAULT_THRESHOLD } else { threshold };
        assert!(threshold >= MINIMUM_THRESHOLD, EInvalidInput);

        let initial_virtual_sui_reserves = calculate_init_sui_reserves(configuration, threshold);

        // R² / (R - I) where R = remain, I = initial
        let actual_virtual_token_reserves = utils::as_u64(
            utils::div(
                utils::mul(
                    utils::from_u64(configuration.remain_token_reserves),
                    utils::from_u64(configuration.remain_token_reserves)
                ),
                utils::from_u64(configuration.remain_token_reserves - configuration.initial_virtual_token_reserves)
            )
        );

        let mut pool = Pool<Token>{
            id                          : object::new(ctx),
            real_sui_reserves           : coin::zero<AIDA>(ctx),
            real_token_reserves         : coin::mint<Token>(&mut treasury_cap, configuration.remain_token_reserves, ctx),
            virtual_token_reserves      : actual_virtual_token_reserves,
            virtual_sui_reserves        : initial_virtual_sui_reserves,
            remain_token_reserves       : coin::mint<Token>(&mut treasury_cap, configuration.remain_token_reserves, ctx),
            fee_recipient               : coin::zero<AIDA>(ctx),
            is_completed                : false,
            platform_fee_withdraw       : configuration.init_platform_fee_withdraw,
            creator_fee_withdraw        : configuration.init_creator_fee_withdraw,
            stake_fee_withdraw          : configuration.init_stake_fee_withdraw,
            platform_stake_fee_withdraw : configuration.init_platform_stake_fee_withdraw,
            threshold                   : threshold,
        };

        // R * I / (R - I)
        let virtual_remain_token_reserves = utils::as_u64(
            utils::div(
                utils::mul(
                    utils::from_u64(configuration.remain_token_reserves),
                    utils::from_u64(configuration.initial_virtual_token_reserves)
                ),
                utils::from_u64(configuration.remain_token_reserves - configuration.initial_virtual_token_reserves)
            )
        );
        dynamic_field::add(&mut pool.id, VIRTUAL_TOKEN_RESERVES_FIELD, virtual_remain_token_reserves);
        // Freeze metadata immediately so explorers (SuiVision, SuiScan, wallets) can
        // display the token image and name before DEX graduation — same behaviour as
        // the original Moonbags contract.
        transfer::public_freeze_object(metadata_token);

        let unlock_timestamp_ms = clock::timestamp_ms(clock) + DISTRIBUTE_FEE_LOCK_DURATION_MS;
        dynamic_field::add(&mut pool.id, DISTRIBUTE_FEE_LOCK_TIME_FIELD, unlock_timestamp_ms);

        let pool_creation_timestamp_ms = clock::timestamp_ms(clock);
        dynamic_field::add(&mut pool.id, POOL_CREATION_TIMESTAMP_FIELD, pool_creation_timestamp_ms);

        transfer::public_transfer<coin::TreasuryCap<Token>>(treasury_cap, @0x0);

        let token_address = type_name::get<Token>();
        let pool_address = type_name::get<Pool<Token>>();

        let created_event = CreatedEventV2 {
            name                        : name,
            symbol                      : symbol,
            uri                         : uri,
            description                 : description,
            twitter                     : twitter,
            telegram                    : telegram,
            website                     : website,
            token_address               : type_name::into_string(token_address),
            bonding_curve               : type_name::get_module(&pool_address),
            pool_id                     : object::id<Pool<Token>>(&pool),
            created_by                  : ctx.sender(),
            virtual_sui_reserves        : pool.virtual_sui_reserves,
            virtual_token_reserves      : pool.virtual_token_reserves,
            real_sui_reserves           : coin::value<AIDA>(&pool.real_sui_reserves),
            real_token_reserves         : coin::value<Token>(&pool.real_token_reserves),
            platform_fee_withdraw       : pool.platform_fee_withdraw,
            creator_fee_withdraw        : pool.creator_fee_withdraw,
            stake_fee_withdraw          : pool.stake_fee_withdraw,
            platform_stake_fee_withdraw : pool.platform_stake_fee_withdraw,
            bonding_dex                 : 0,
            threshold                   : threshold,
            ts                          : clock::timestamp_ms(clock),
        };
        dynamic_object_field::add<String, Pool<Token>>(&mut configuration.id, type_name::get_address(&token_address), pool);
        emit<CreatedEventV2>(created_event);

        moonbags_stake::initialize_staking_pool<Token>(stake_config, clock, ctx);
        moonbags_stake::initialize_creator_pool<Token>(stake_config, ctx.sender(), clock, ctx);

        let collect_creation_fee = coin::split(&mut pool_creation_fee, configuration.pool_creation_fee, ctx);
        transfer::public_transfer(collect_creation_fee, configuration.fee_platform_recipient);
        transfer::public_transfer(pool_creation_fee, ctx.sender());
    }

    fun swap<Token>(pool: &mut Pool<Token>, coin_token: Coin<Token>, coin_sui: Coin<AIDA>, amount_token_out: u64, amount_sui_out: u64, ctx: &mut TxContext) : (Coin<Token>, Coin<AIDA>) {
        let before_virtual_token_reserves = pool.virtual_token_reserves;
        let before_virtual_sui_reserves = pool.virtual_sui_reserves;

        assert!(coin::value<Token>(&coin_token) > 0 || coin::value<AIDA>(&coin_sui) > 0, EInvalidInput);

        pool.virtual_token_reserves = pool.virtual_token_reserves + coin::value<Token>(&coin_token);
        pool.virtual_sui_reserves = pool.virtual_sui_reserves + coin::value<AIDA>(&coin_sui);

        if (coin::value<Token>(&coin_token) > 0) {
            pool.virtual_token_reserves = pool.virtual_token_reserves - amount_token_out;
        };
        if (coin::value<AIDA>(&coin_sui) > 0) {
            pool.virtual_sui_reserves = pool.virtual_sui_reserves - amount_sui_out;
        };

        assert_lp_value_is_increased_or_not_changed(before_virtual_token_reserves, before_virtual_sui_reserves, pool.virtual_token_reserves, pool.virtual_sui_reserves);

        coin::join<Token>(&mut pool.real_token_reserves, coin_token);
        coin::join<AIDA>(&mut pool.real_sui_reserves, coin_sui);

        (coin::split<Token>(&mut pool.real_token_reserves, amount_token_out, ctx), coin::split<AIDA>(&mut pool.real_sui_reserves, amount_sui_out, ctx))
    }

    public fun assert_pool_not_completed<Token>(configuration: &Configuration) {
        let token_address = type_name::get<Token>();
        assert!(dynamic_object_field::borrow<String, Pool<Token>>(&configuration.id, type_name::get_address(&token_address)).is_completed, EPoolNotComplete);
    }

    fun assert_lp_value_is_increased_or_not_changed(before_token_reserves: u64, before_sui_reserves: u64, after_token_reserves: u64, after_sui_reserves: u64) {
        assert!((before_token_reserves as u128) * (before_sui_reserves as u128) <= (after_token_reserves as u128) * (after_sui_reserves as u128), EInvalidInput);
    }

    fun assert_version(version: u64) {
        assert!(version <= VERSION, EWrongVersion);
    }

    public entry fun buy_exact_in_with_lock<Token>(configuration: &mut Configuration, token_lock_config: &TokenLockConfig, coin_sui: Coin<AIDA>, amount_in: u64, amount_out_min: u64, clock: &Clock, ctx: &mut TxContext) {
        let (coin_sui_out, coin_token_out) = buy_exact_in_returns_with_lock<Token>(configuration, token_lock_config, coin_sui, amount_in, amount_out_min, clock, ctx);
        transfer::public_transfer<Coin<AIDA>>(coin_sui_out, ctx.sender());
        transfer::public_transfer<Coin<Token>>(coin_token_out, ctx.sender());
    }

    fun buy_direct<Token>(admin: address, mut coin_sui: Coin<AIDA>, pool: &mut Pool<Token>, amount_out: u64, platform_fee: u64, token_lock_config: &TokenLockConfig, locking_time_ms: u64, clock: &Clock, ctx: &mut TxContext) {
        assert!(!pool.is_completed, ECompletedPool);
        assert!(amount_out > 0, EInvalidInput);

        let amount_sui_in = coin::value<AIDA>(&coin_sui);
        let virtual_remain_token_reserves = get_virtual_remain_token_reserves(pool);
        let token_reserves_in_pool = pool.virtual_token_reserves - virtual_remain_token_reserves;
        let actual_amount_out = min(amount_out, token_reserves_in_pool);

        let amount_in_swap = curves::calculate_add_liquidity_cost(pool.virtual_sui_reserves, pool.virtual_token_reserves, actual_amount_out) + 1;
        let fee = utils::as_u64(utils::div(utils::mul(utils::from_u64(amount_in_swap), utils::from_u64(platform_fee)), utils::from_u64(FEE_DENOMINATOR)));
        assert!(amount_sui_in >= amount_in_swap + fee, EInsufficientInput);

        coin::join(&mut pool.fee_recipient, coin::split<AIDA>(&mut coin_sui, fee, ctx));

        let (coin_token_out, coin_sui_out) = swap<Token>(pool, coin::zero<Token>(ctx), coin_sui, actual_amount_out, amount_sui_in - amount_in_swap - fee, ctx);

        pool.virtual_token_reserves = pool.virtual_token_reserves - coin::value<Token>(&coin_token_out);

        let traded_event = TradedEventV2{
            is_buy                 : true,
            user                   : ctx.sender(),
            token_address          : type_name::into_string(type_name::get<Token>()),
            sui_amount             : amount_in_swap,
            token_amount           : actual_amount_out,
            virtual_sui_reserves   : pool.virtual_sui_reserves,
            virtual_token_reserves : pool.virtual_token_reserves,
            real_sui_reserves      : coin::value<AIDA>(&pool.real_sui_reserves),
            real_token_reserves    : coin::value<Token>(&pool.real_token_reserves),
            pool_id                : object::id(pool),
            fee                    : fee,
            ts                     : clock::timestamp_ms(clock),
        };
        emit<TradedEventV2>(traded_event);

        transfer::public_transfer<Coin<AIDA>>(coin_sui_out, ctx.sender());
        
        if (locking_time_ms == 0) {
            transfer::public_transfer<Coin<Token>>(coin_token_out, ctx.sender());
        } else {
            let amount_coin_token_out = coin::value<Token>(&coin_token_out);
            let end_time = clock::timestamp_ms(clock) + locking_time_ms;
            moonbags_token_lock::create_lock(token_lock_config, coin_token_out, ctx.sender(), amount_coin_token_out, end_time, clock, ctx);
        };

        if (token_reserves_in_pool == actual_amount_out) {
            transfer_pool<Token>(admin, pool, clock, ctx);
        };
    }

    public fun buy_exact_in_returns_with_lock<Token>(configuration: &mut Configuration, token_lock_config: &TokenLockConfig, mut coin_sui: Coin<AIDA>, amount_in: u64, amount_out_min: u64, clock: &Clock, ctx: &mut TxContext): (Coin<AIDA>, Coin<Token>) {
        assert_version(configuration.version);
        let total_sui_in = coin::value<AIDA>(&coin_sui);
        assert!(total_sui_in >= amount_in, EInsufficientInput);
        assert!(amount_in > 0, EInvalidInput);

        let token_address = type_name::get<Token>();
        let pool = dynamic_object_field::borrow_mut<String, Pool<Token>>(&mut configuration.id, type_name::get_address(&token_address));

        assert!(!pool.is_completed, ECompletedPool);

        let amount_out_swap = curves::calculate_remove_liquidity_return(pool.virtual_sui_reserves, pool.virtual_token_reserves, amount_in);
        let token_reserves_in_pool = pool.virtual_token_reserves - get_virtual_remain_token_reserves(pool);
        
        let (actual_amount_out, amount_in_swap) = if (amount_out_swap > token_reserves_in_pool) {
            let actual_out = token_reserves_in_pool;
            let required_sui = curves::calculate_add_liquidity_cost(pool.virtual_sui_reserves, pool.virtual_token_reserves, actual_out) + 1;
            (actual_out, required_sui)
        } else {
            (amount_out_swap, amount_in)
        };

        assert!(actual_amount_out >= amount_out_min, EInvalidInput);

        let fee = utils::as_u64(utils::div(utils::mul(utils::from_u64(amount_in_swap), utils::from_u64(configuration.platform_fee)), utils::from_u64(FEE_DENOMINATOR)));
        coin::join(&mut pool.fee_recipient, coin::split<AIDA>(&mut coin_sui, fee, ctx));

        assert!(total_sui_in >= amount_in_swap + fee, EInsufficientInput);

        let (mut coin_token_out, coin_sui_out) = swap<Token>(pool, coin::zero<Token>(ctx), coin_sui, actual_amount_out, total_sui_in - amount_in_swap - fee, ctx);

        pool.virtual_token_reserves = pool.virtual_token_reserves - coin::value<Token>(&coin_token_out);

        let traded_event = TradedEventV2{
            is_buy                 : true,
            user                   : ctx.sender(),
            token_address          : type_name::into_string(token_address),
            sui_amount             : amount_in_swap,
            token_amount           : actual_amount_out,
            virtual_sui_reserves   : pool.virtual_sui_reserves,
            virtual_token_reserves : pool.virtual_token_reserves,
            real_sui_reserves      : coin::value<AIDA>(&pool.real_sui_reserves),
            real_token_reserves    : coin::value<Token>(&pool.real_token_reserves),
            pool_id                : object::id(pool),
            fee                    : fee,
            ts                     : clock::timestamp_ms(clock),
        };
        emit<TradedEventV2>(traded_event);

        if (actual_amount_out == token_reserves_in_pool) {
            transfer_pool<Token>(configuration.admin, pool, clock, ctx);
        };

        if (dynamic_field::exists_(&pool.id, POOL_CREATION_TIMESTAMP_FIELD)) {
            let creation_timestamp_ms = *dynamic_field::borrow<vector<u8>, u64>(&pool.id, POOL_CREATION_TIMESTAMP_FIELD);
            let current_timestamp_ms = clock::timestamp_ms(clock);

            let buy_block_duration_ms = *dynamic_field::borrow<vector<u8>, u64>(&configuration.id, BUY_BLOCK_DURATION_FIELD);
            let lock_buy_duration_ms = *dynamic_field::borrow<vector<u8>, u64>(&configuration.id, LOCK_BUY_DURATION_FIELD);

            if (current_timestamp_ms - creation_timestamp_ms < buy_block_duration_ms) {
                let end_time = current_timestamp_ms + lock_buy_duration_ms;
                let locked_token = coin_token_out;
                let amount_lock_token = coin::value<Token>(&locked_token);

                moonbags_token_lock::create_lock(token_lock_config, locked_token, ctx.sender(), amount_lock_token, end_time, clock, ctx);
                
                coin_token_out = coin::zero<Token>(ctx);
            }
        };

        (coin_sui_out, coin_token_out)
    }

    public fun check_pool_exist<Token>(configuration: &Configuration) : bool {
        let token_address = type_name::get<Token>();
        dynamic_object_field::exists_<String>(&configuration.id, type_name::get_address(&token_address))
    }

    public entry fun create_and_lock_first_buy_with_fee<Token>(
        configuration: &mut Configuration,
        stake_config: &mut StakeConfig,
        token_lock_config: &TokenLockConfig,
        mut treasury_cap: coin::TreasuryCap<Token>,
        mut pool_creation_fee: Coin<AIDA>,
        coin_sui: Coin<AIDA>,
        amount_out: u64,
        threshold: u64,
        locking_time_ms: u64,
        clock: &Clock,
        name: String,
        symbol: String,
        uri: String,
        description: String,
        twitter: String,
        telegram: String,
        website: String,
        metadata_token: CoinMetadata<Token>,
        ctx: &mut TxContext
    ) {
        assert!(ascii::length(&uri) <= 300, EInvalidInput);
        assert!(ascii::length(&description) <= 1000, EInvalidInput);
        assert!(ascii::length(&twitter) <= 500, EInvalidInput);
        assert!(ascii::length(&telegram) <= 500, EInvalidInput);
        assert!(ascii::length(&website) <= 500, EInvalidInput);
        assert!(coin::value<AIDA>(&pool_creation_fee) >= configuration.pool_creation_fee, EInvalidInput);

        assert_version(configuration.version);
        assert!(coin::total_supply<Token>(&treasury_cap) == 0, EExistTokenSupply);

        let threshold = if (threshold == 0) { DEFAULT_THRESHOLD } else { threshold };
        assert!(threshold >= MINIMUM_THRESHOLD, EInvalidInput);

        if (locking_time_ms > 0) {
            let one_hour_in_milliseconds = 3_600_000;
            assert!(locking_time_ms >= one_hour_in_milliseconds, EInvalidInput);
        };

        let initial_virtual_sui_reserves = calculate_init_sui_reserves(configuration, threshold);

        // R² / (R - I) where R = remain, I = initial
        let actual_virtual_token_reserves = utils::as_u64(
            utils::div(
                utils::mul(
                    utils::from_u64(configuration.remain_token_reserves),
                    utils::from_u64(configuration.remain_token_reserves)
                ),
                utils::from_u64(configuration.remain_token_reserves - configuration.initial_virtual_token_reserves)
            )
        );

        let mut pool = Pool<Token>{
            id                          : object::new(ctx),
            real_sui_reserves           : coin::zero<AIDA>(ctx),
            real_token_reserves         : coin::mint<Token>(&mut treasury_cap, configuration.remain_token_reserves, ctx),
            virtual_token_reserves      : actual_virtual_token_reserves,
            virtual_sui_reserves        : initial_virtual_sui_reserves,
            remain_token_reserves       : coin::mint<Token>(&mut treasury_cap, configuration.remain_token_reserves, ctx),
            fee_recipient               : coin::zero<AIDA>(ctx),
            is_completed                : false,
            platform_fee_withdraw       : configuration.init_platform_fee_withdraw,
            creator_fee_withdraw        : configuration.init_creator_fee_withdraw,
            stake_fee_withdraw          : configuration.init_stake_fee_withdraw,
            platform_stake_fee_withdraw : configuration.init_platform_stake_fee_withdraw,
            threshold                   : threshold,
        };

        // R * I / (R - I)
        let virtual_remain_token_reserves = utils::as_u64(
            utils::div(
                utils::mul(
                    utils::from_u64(configuration.remain_token_reserves),
                    utils::from_u64(configuration.initial_virtual_token_reserves)
                ),
                utils::from_u64(configuration.remain_token_reserves - configuration.initial_virtual_token_reserves)
            )
        );
        dynamic_field::add(&mut pool.id, VIRTUAL_TOKEN_RESERVES_FIELD, virtual_remain_token_reserves);
        // Freeze metadata immediately so explorers (SuiVision, SuiScan, wallets) can
        // display the token image and name before DEX graduation — same behaviour as
        // the original Moonbags contract.
        transfer::public_freeze_object(metadata_token);

        let unlock_timestamp_ms = clock::timestamp_ms(clock) + DISTRIBUTE_FEE_LOCK_DURATION_MS;
        dynamic_field::add(&mut pool.id, DISTRIBUTE_FEE_LOCK_TIME_FIELD, unlock_timestamp_ms);

        let pool_creation_timestamp_ms = clock::timestamp_ms(clock);
        dynamic_field::add(&mut pool.id, POOL_CREATION_TIMESTAMP_FIELD, pool_creation_timestamp_ms);

        let token_address = type_name::get<Token>();
        let pool_address = type_name::get<Pool<Token>>();
        let created_event = CreatedEventV2 {
            name                        : name,
            symbol                      : symbol,
            uri                         : uri,
            description                 : description,
            twitter                     : twitter,
            telegram                    : telegram,
            website                     : website,
            token_address               : type_name::into_string(token_address),
            bonding_curve               : type_name::get_module(&pool_address),
            pool_id                     : object::id<Pool<Token>>(&pool),
            created_by                  : ctx.sender(),
            virtual_sui_reserves        : pool.virtual_sui_reserves,
            virtual_token_reserves      : pool.virtual_token_reserves,
            real_sui_reserves           : coin::value<AIDA>(&pool.real_sui_reserves),
            real_token_reserves         : coin::value<Token>(&pool.real_token_reserves),
            platform_fee_withdraw       : pool.platform_fee_withdraw,
            creator_fee_withdraw        : pool.creator_fee_withdraw,
            stake_fee_withdraw          : pool.stake_fee_withdraw,
            platform_stake_fee_withdraw : pool.platform_stake_fee_withdraw,
            bonding_dex                 : 0,
            threshold                   : threshold,
            ts                          : clock::timestamp_ms(clock),
        };

        transfer::public_transfer<coin::TreasuryCap<Token>>(treasury_cap, @0x0);

        if (coin::value<AIDA>(&coin_sui) > 0) {
            buy_direct<Token>(configuration.admin, coin_sui, &mut pool, amount_out, configuration.platform_fee, token_lock_config, locking_time_ms, clock, ctx);
        } else {
            coin::destroy_zero<AIDA>(coin_sui);
        };

        dynamic_object_field::add<String, Pool<Token>>(&mut configuration.id, type_name::get_address(&token_address), pool);
        emit<CreatedEventV2>(created_event);

        moonbags_stake::initialize_staking_pool<Token>(stake_config, clock, ctx);
        moonbags_stake::initialize_creator_pool<Token>(stake_config, ctx.sender(), clock, ctx);

        let collect_creation_fee = coin::split(&mut pool_creation_fee, configuration.pool_creation_fee, ctx);
        transfer::public_transfer(collect_creation_fee, configuration.fee_platform_recipient);
        transfer::public_transfer(pool_creation_fee, ctx.sender());
    }

    public entry fun create_threshold_config(_: &AdminCap, threshold: u64, ctx: &mut TxContext) {
        let threshold_config = ThresholdConfig{
            id        : object::new(ctx),
            threshold : threshold,
        };
        transfer::public_share_object<ThresholdConfig>(threshold_config);
    }

    public fun early_complete_pool<Token>(_: &AdminCap, configuration: &mut Configuration, threshold_config: &mut ThresholdConfig, clock: &Clock, ctx: &mut TxContext) {
        let token_address = type_name::get<Token>();
        let pool = dynamic_object_field::borrow_mut<String, Pool<Token>>(&mut configuration.id, type_name::get_address(&token_address));
        pool.is_completed = true;

        let real_sui_reserves_amount = coin::value<AIDA>(&pool.real_sui_reserves);
        let mut real_sui_coin = coin::split<AIDA>(&mut pool.real_sui_reserves, real_sui_reserves_amount, ctx);

        let real_token_reserves = &pool.real_token_reserves;
        let remain_token_reserves = &pool.remain_token_reserves;

        let mut real_token_coin = coin::split<Token>(&mut pool.real_token_reserves, coin::value<Token>(real_token_reserves), ctx);
        assert!(real_sui_reserves_amount >= threshold_config.threshold, ENotEnoughThreshold);
        coin::join<Token>(&mut real_token_coin, coin::split<Token>(&mut pool.remain_token_reserves, coin::value<Token>(remain_token_reserves), ctx));
        if (real_sui_reserves_amount >= threshold_config.threshold) {
            let migration_fee = MIGRATION_FEE;
            if (real_sui_reserves_amount >= threshold_config.threshold + migration_fee) {
                transfer::public_transfer<Coin<AIDA>>(coin::split<AIDA>(&mut real_sui_coin, migration_fee, ctx), configuration.treasury);
            };
            transfer::public_transfer<Coin<AIDA>>(coin::split<AIDA>(&mut real_sui_coin, threshold_config.threshold, ctx), configuration.admin);
            transfer::public_transfer<Coin<Token>>(coin::split<Token>(&mut real_token_coin, configuration.remain_token_reserves, ctx), configuration.admin);
        };
        transfer::public_transfer<Coin<AIDA>>(real_sui_coin, ctx.sender());
        transfer::public_transfer<Coin<Token>>(real_token_coin, ctx.sender());
        let pool_completed_event = PoolCompletedEventV2{
            token_address : type_name::into_string(type_name::get<Token>()),
            lp            : ascii::string(b"0x0"),
            ts            : clock::timestamp_ms(clock),
        };
        emit<PoolCompletedEventV2>(pool_completed_event);
    }

    public fun estimate_amount_out<Token>(configuration: &mut Configuration, amount_sui_in: u64, amount_token_in: u64) : (u64, u64) {
        let token_address = type_name::get<Token>();
        let pool = dynamic_object_field::borrow_mut<String, Pool<Token>>(&mut configuration.id, type_name::get_address(&token_address));
        if (amount_sui_in > 0 && amount_token_in == 0) {
            (0, curves::calculate_token_amount_received(pool.virtual_sui_reserves, pool.virtual_token_reserves, amount_sui_in - utils::as_u64(utils::div(utils::mul(utils::from_u64(amount_sui_in), utils::from_u64(configuration.platform_fee)), utils::from_u64(FEE_DENOMINATOR)))))
        } else {
            let (amount_sui_out, amount_token_out) = if (amount_sui_in == 0 && amount_token_in > 0) {
                let amount_sui_out_with_fee = curves::calculate_remove_liquidity_return(pool.virtual_token_reserves, pool.virtual_sui_reserves, amount_token_in);
                (amount_sui_out_with_fee - utils::as_u64(utils::div(utils::mul(utils::from_u64(amount_sui_out_with_fee), utils::from_u64(configuration.platform_fee)), utils::from_u64(FEE_DENOMINATOR))), 0)
            } else {
                (0, 0)
            };
            (amount_sui_out, amount_token_out)
        }
    }

    public entry fun migrate_version(_: &AdminCap, configuration: &mut Configuration) {
        configuration.version = VERSION;
    }

    public entry fun sell<Token>(configuration: &mut Configuration, coin_token: Coin<Token>, amount_out_min: u64, clock: &Clock, ctx: &mut TxContext) {
        assert_version(configuration.version);
        let token_address = type_name::get<Token>();
        let pool = dynamic_object_field::borrow_mut<String, Pool<Token>>(&mut configuration.id, type_name::get_address(&token_address));

        assert!(!pool.is_completed, ECompletedPool);
        let amount_in = coin::value<Token>(&coin_token);
        assert!(amount_in > 0, EInvalidInput);

        let mut amount_sui_out = curves::calculate_remove_liquidity_return(pool.virtual_token_reserves, pool.virtual_sui_reserves, amount_in);
        amount_sui_out = min(amount_sui_out, coin::value(&pool.real_sui_reserves));

        let fee = utils::as_u64(utils::div(utils::mul(utils::from_u64(amount_sui_out), utils::from_u64(configuration.platform_fee)), utils::from_u64(FEE_DENOMINATOR)));
        assert!(amount_sui_out - fee >= amount_out_min, EInvalidInput);
        let (coin_token_out, mut coin_sui_out) = swap<Token>(pool, coin_token, coin::zero<AIDA>(ctx), 0, amount_sui_out, ctx);
        pool.virtual_sui_reserves = pool.virtual_sui_reserves - coin::value<AIDA>(&coin_sui_out);

        coin::join(&mut pool.fee_recipient, coin::split<AIDA>(&mut coin_sui_out, fee, ctx));

        transfer::public_transfer<Coin<AIDA>>(coin_sui_out, ctx.sender());
        transfer::public_transfer<Coin<Token>>(coin_token_out, ctx.sender());

        let traded_event = TradedEventV2{
            is_buy                 : false,
            user                   : ctx.sender(),
            token_address          : type_name::into_string(token_address),
            sui_amount             : amount_sui_out,
            token_amount           : amount_in,
            virtual_sui_reserves   : pool.virtual_sui_reserves,
            virtual_token_reserves : pool.virtual_token_reserves,
            real_sui_reserves      : coin::value<AIDA>(&pool.real_sui_reserves),
            real_token_reserves    : coin::value<Token>(&pool.real_token_reserves),
            pool_id                : object::id<Pool<Token>>(pool),
            fee                    : fee,
            ts                     : clock::timestamp_ms(clock),
        };
        emit<TradedEventV2>(traded_event);
    }

    public fun sell_returns<Token>(configuration: &mut Configuration, coin_token: Coin<Token>, amount_out_min: u64, clock: &Clock, ctx: &mut TxContext) : (Coin<AIDA>, Coin<Token>) {
        assert_version(configuration.version);
        let token_address = type_name::get<Token>();
        let pool = dynamic_object_field::borrow_mut<String, Pool<Token>>(&mut configuration.id, type_name::get_address(&token_address));

        assert!(!pool.is_completed, ECompletedPool);
        let amount_in = coin::value<Token>(&coin_token);
        assert!(amount_in > 0, EInvalidInput);

        let mut amount_sui_out = curves::calculate_remove_liquidity_return(pool.virtual_token_reserves, pool.virtual_sui_reserves, amount_in);
        amount_sui_out = min(amount_sui_out, coin::value(&pool.real_sui_reserves));

        let fee = utils::as_u64(utils::div(utils::mul(utils::from_u64(amount_sui_out), utils::from_u64(configuration.platform_fee)), utils::from_u64(FEE_DENOMINATOR)));
        assert!(amount_sui_out - fee >= amount_out_min, EInvalidInput);
        let (coin_token_out, mut coin_sui_out) = swap<Token>(pool, coin_token, coin::zero<AIDA>(ctx), 0, amount_sui_out, ctx);
        pool.virtual_sui_reserves = pool.virtual_sui_reserves - coin::value<AIDA>(&coin_sui_out);

        coin::join(&mut pool.fee_recipient, coin::split<AIDA>(&mut coin_sui_out, fee, ctx));

        let traded_event = TradedEventV2{
            is_buy                 : false,
            user                   : ctx.sender(),
            token_address          : type_name::into_string(token_address),
            sui_amount             : amount_sui_out,
            token_amount           : amount_in,
            virtual_sui_reserves   : pool.virtual_sui_reserves,
            virtual_token_reserves : pool.virtual_token_reserves,
            real_sui_reserves      : coin::value<AIDA>(&pool.real_sui_reserves),
            real_token_reserves    : coin::value<Token>(&pool.real_token_reserves),
            pool_id                : object::id<Pool<Token>>(pool),
            fee                    : fee,
            ts                     : clock::timestamp_ms(clock),
        };
        emit<TradedEventV2>(traded_event);
        (coin_sui_out, coin_token_out)
    }

    public fun skim<Token>(_: &AdminCap, configuration: &mut Configuration, ctx: &mut TxContext) {
        let token_address = type_name::get<Token>();
        let pool = dynamic_object_field::borrow_mut<String, Pool<Token>>(&mut configuration.id, type_name::get_address(&token_address));
        assert!(pool.is_completed, ECompletedPool);

        let real_token_reserves = &pool.real_token_reserves;
        let real_sui_reserves = &pool.real_sui_reserves;

        transfer::public_transfer<Coin<AIDA>>(coin::split<AIDA>(&mut pool.real_sui_reserves, coin::value<AIDA>(real_sui_reserves), ctx), ctx.sender());
        transfer::public_transfer<Coin<Token>>(coin::split<Token>(&mut pool.real_token_reserves, coin::value<Token>(real_token_reserves), ctx), ctx.sender());
    }

    public entry fun transfer_admin(admin_cap: AdminCap, configuration: &mut Configuration, new_admin: address, clock: &Clock, ctx: &mut TxContext) {
        configuration.admin = new_admin;
        transfer::transfer(admin_cap, new_admin);

        let ownership_transferred_event = OwnershipTransferredEventV2 {
            old_admin : ctx.sender(),
            new_admin : new_admin,
            ts        : clock::timestamp_ms(clock),
        };
        emit<OwnershipTransferredEventV2>(ownership_transferred_event);
    }

    public entry fun update_fee_recipients(
        _: &AdminCap,
        configuration: &mut Configuration,
        new_treasury: address,
        new_fee_platform_recipient: address,
    ) {
        configuration.treasury = new_treasury;
        configuration.fee_platform_recipient = new_fee_platform_recipient;
    }

    public entry fun update_initial_virtual_token_reserves(
        _: &AdminCap,
        configuration: &mut Configuration,
        new_initial_virtual_token_reserves: u64,
    ) {
        configuration.initial_virtual_token_reserves = new_initial_virtual_token_reserves;
    }

    /// Admin-only setter for the per-launch pool creation fee (in AIDA mist).
    /// Replaces the old compiled-in `POOL_CREATION_FEE` constant — now that
    /// `create_with_fee` and `create_and_lock_first_buy_with_fee` read from
    /// `configuration.pool_creation_fee` at runtime, a single tx can retune
    /// the launch price without a package republish.
    public entry fun setter_pool_creation_fee(
        _: &AdminCap,
        configuration: &mut Configuration,
        new_pool_creation_fee: u64,
    ) {
        configuration.pool_creation_fee = new_pool_creation_fee;
    }

    fun get_virtual_remain_token_reserves<Token>(pool: &Pool<Token>): u64 {
        if (dynamic_field::exists_(&pool.id, VIRTUAL_TOKEN_RESERVES_FIELD)) {
            *dynamic_field::borrow<vector<u8>, u64>(&pool.id, VIRTUAL_TOKEN_RESERVES_FIELD)
        } else {
            coin::value(&pool.remain_token_reserves)
        }
    }

    // Simplified transfer_pool: sends all funds to admin wallet for manual DEX pool creation
    fun transfer_pool<Token>(admin: address, pool: &mut Pool<Token>, clock: &Clock, ctx: &mut TxContext) {
        pool.is_completed = true;

        let real_token_reserves = &pool.real_token_reserves;
        let remain_token_reserves = &pool.remain_token_reserves;
        let real_sui_reserves = &pool.real_sui_reserves;

        let mut coin_token = coin::split<Token>(&mut pool.real_token_reserves, coin::value<Token>(real_token_reserves), ctx);
        coin::join<Token>(&mut coin_token, coin::split<Token>(&mut pool.remain_token_reserves, coin::value<Token>(remain_token_reserves), ctx));

        let coin_sui = coin::split<AIDA>(&mut pool.real_sui_reserves, coin::value<AIDA>(real_sui_reserves), ctx);

        let pool_completed_event = PoolCompletedEventV2 {
            token_address : type_name::into_string(type_name::get<Token>()),
            lp            : ascii::string(b"0x0"),
            ts            : clock::timestamp_ms(clock),
        };
        emit<PoolCompletedEventV2>(pool_completed_event);

        emit<PoolMigratingEvent>(PoolMigratingEvent {
            token_address   : type_name::into_string(type_name::get<Token>()),
            sui_amount      : coin::value<AIDA>(&coin_sui),
            token_amount    : coin::value<Token>(&coin_token),
            bonding_dex     : 0,
            ts              : clock::timestamp_ms(clock),
        });

        // Transfer all funds to admin for manual DEX pool creation
        transfer::public_transfer<Coin<Token>>(coin_token, admin);
        transfer::public_transfer<Coin<AIDA>>(coin_sui, admin);
        // Note: CoinMetadata is already frozen at pool creation — no action needed here.
    }

    // threshold * I / (R - I) = threshold/3 with 4:1 ratio
    fun calculate_init_sui_reserves(configuration: &Configuration, threshold: u64) : u64 {
        let remain_token_reserves = configuration.remain_token_reserves;
        let initial_virtual_token_reserves = configuration.initial_virtual_token_reserves;

        assert!(remain_token_reserves > initial_virtual_token_reserves, EInvalidInput);

        utils::as_u64(
            utils::div(
                utils::mul(
                    utils::from_u64(threshold),
                    utils::from_u64(initial_virtual_token_reserves)
                ),
                utils::from_u64(remain_token_reserves - initial_virtual_token_reserves)
            )
        )
    }

    public entry fun update_config(
        _: &AdminCap,
        configuration: &mut Configuration,
        new_platform_fee: u64,
        new_initial_virtual_token_reserves: u64,
        new_remain_token_reserves: u64,
        new_token_decimals: u8,
        new_init_platform_fee_withdraw: u16,
        new_init_creator_fee_withdraw: u16,
        new_init_stake_fee_withdraw: u16,
        new_init_platform_stake_fee_withdraw: u16,
        new_token_platform_type_name: String,
        clock: &Clock
    ) {
        assert!((new_init_platform_fee_withdraw + new_init_creator_fee_withdraw + new_init_stake_fee_withdraw + new_init_platform_stake_fee_withdraw) as u64 <= FEE_DENOMINATOR, EInvalidInput);

        let config_changed_event = ConfigChangedEventV2 {
            old_platform_fee                        : configuration.platform_fee,
            new_platform_fee                        : new_platform_fee,
            old_initial_virtual_token_reserves      : configuration.initial_virtual_token_reserves,
            new_initial_virtual_token_reserves      : new_initial_virtual_token_reserves,
            old_remain_token_reserves               : configuration.remain_token_reserves,
            new_remain_token_reserves               : new_remain_token_reserves,
            old_token_decimals                      : configuration.token_decimals,
            new_token_decimals                      : new_token_decimals,
            old_init_platform_fee_withdraw          : configuration.init_platform_fee_withdraw,
            new_init_platform_fee_withdraw          : new_init_platform_fee_withdraw,
            old_init_creator_fee_withdraw           : configuration.init_creator_fee_withdraw,
            new_init_creator_fee_withdraw           : new_init_creator_fee_withdraw,
            old_init_stake_fee_withdraw             : configuration.init_stake_fee_withdraw,
            new_init_stake_fee_withdraw             : new_init_stake_fee_withdraw,
            old_init_platform_stake_fee_withdraw    : configuration.init_platform_stake_fee_withdraw,
            new_init_platform_stake_fee_withdraw    : new_init_platform_stake_fee_withdraw,
            old_token_platform_type_name            : configuration.token_platform_type_name,
            new_token_platform_type_name            : new_token_platform_type_name,
            ts                                      : clock::timestamp_ms(clock),
        };

        configuration.platform_fee = new_platform_fee;
        configuration.initial_virtual_token_reserves = new_initial_virtual_token_reserves;
        configuration.remain_token_reserves = new_remain_token_reserves;
        configuration.token_decimals = new_token_decimals;
        configuration.init_platform_fee_withdraw = new_init_platform_fee_withdraw;
        configuration.init_creator_fee_withdraw = new_init_creator_fee_withdraw;
        configuration.init_stake_fee_withdraw = new_init_stake_fee_withdraw;
        configuration.init_platform_stake_fee_withdraw = new_init_platform_stake_fee_withdraw;
        configuration.token_platform_type_name = new_token_platform_type_name;

        emit<ConfigChangedEventV2>(config_changed_event);
    }

    public entry fun update_threshold_config(_: &AdminCap, threshold_config: &mut ThresholdConfig, new_threshold: u64) {
        threshold_config.threshold = new_threshold;
    }

    public entry fun update_buy_block_duration_config(
        _: &AdminCap,
        configuration: &mut Configuration,
        buy_block_duration_ms: u64,
    ) {
        if (dynamic_field::exists_(&configuration.id, BUY_BLOCK_DURATION_FIELD)) {
            dynamic_field::remove<vector<u8>, u64>(&mut configuration.id, BUY_BLOCK_DURATION_FIELD);
        };
        dynamic_field::add(&mut configuration.id, BUY_BLOCK_DURATION_FIELD, buy_block_duration_ms);
    }

    public entry fun update_lock_buy_duration_config(
        _: &AdminCap,
        configuration: &mut Configuration,
        lock_buy_duration_ms: u64,
    ) {
        if (dynamic_field::exists_(&configuration.id, LOCK_BUY_DURATION_FIELD)) {
            dynamic_field::remove<vector<u8>, u64>(&mut configuration.id, LOCK_BUY_DURATION_FIELD);
        };
        dynamic_field::add(&mut configuration.id, LOCK_BUY_DURATION_FIELD, lock_buy_duration_ms);
    }

    public entry fun update_config_withdraw_fee(
        _: &AdminCap,
        configuration: &mut Configuration,
        new_init_platform_fee_withdraw: u16,
        new_init_creator_fee_withdraw: u16,
        new_init_stake_fee_withdraw: u16,
        new_init_platform_stake_fee_withdraw: u16,
    ) {
        configuration.init_platform_fee_withdraw = new_init_platform_fee_withdraw;
        configuration.init_creator_fee_withdraw = new_init_creator_fee_withdraw;
        configuration.init_stake_fee_withdraw = new_init_stake_fee_withdraw;
        configuration.init_platform_stake_fee_withdraw = new_init_platform_stake_fee_withdraw;
    }

    public fun withdraw_fee_bonding_curve<Token, PlatformToken>(bonding_curve_config: &mut Configuration, stake_config: &mut StakeConfig, clock: &Clock, ctx: &mut TxContext) {
        assert_version(bonding_curve_config.version);
        let platform_token_type_name = type_name::into_string(type_name::get<PlatformToken>());
        assert!(platform_token_type_name == bonding_curve_config.token_platform_type_name, EInsufficientInput);

        let token_address = type_name::get_address(&type_name::get<Token>());
        let pool = dynamic_object_field::borrow_mut<String, Pool<Token>>(&mut bonding_curve_config.id, token_address);

        let fee_platform_recipient = bonding_curve_config.fee_platform_recipient;
        let init_platform_fee_withdraw = bonding_curve_config.init_platform_fee_withdraw;
        let init_creator_fee_withdraw = bonding_curve_config.init_creator_fee_withdraw;
        let init_stake_fee_withdraw = bonding_curve_config.init_stake_fee_withdraw;
        let init_platform_stake_fee_withdraw = bonding_curve_config.init_platform_stake_fee_withdraw;
        
        distribute_fees<Token, PlatformToken>(
            pool, 
            fee_platform_recipient,
            init_platform_fee_withdraw,
            init_creator_fee_withdraw,
            init_stake_fee_withdraw,
            init_platform_stake_fee_withdraw,
            stake_config, 
            clock, 
            ctx
        );
    }

    fun distribute_fees<Token, PlatformToken>(
        pool: &mut Pool<Token>,
        admin_platform_fee: address,
        init_platform_fee_withdraw: u16,
        init_creator_fee_withdraw: u16,
        init_stake_fee_withdraw: u16,
        init_platform_stake_fee_withdraw: u16,
        stake_config: &mut StakeConfig,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        if (dynamic_field::exists_(&pool.id, DISTRIBUTE_FEE_LOCK_TIME_FIELD)) {
            let unlock_timestamp_ms = *dynamic_field::borrow<vector<u8>, u64>(&pool.id, DISTRIBUTE_FEE_LOCK_TIME_FIELD);
            let current_timestamp_ms = clock::timestamp_ms(clock);

            assert!(current_timestamp_ms >= unlock_timestamp_ms, EInvalidDistributeFeeTime);
        };

        let fee_amount = coin::value(&pool.fee_recipient);
        if (fee_amount <= FEE_DENOMINATOR) {
            return
        };

        let platform_share = utils::as_u64(utils::div(utils::mul(utils::from_u64(fee_amount), utils::from_u64(init_platform_fee_withdraw as u64)), utils::from_u64(FEE_DENOMINATOR)));
        let creator_share = utils::as_u64(utils::div(utils::mul(utils::from_u64(fee_amount), utils::from_u64(init_creator_fee_withdraw as u64)), utils::from_u64(FEE_DENOMINATOR)));
        let stake_share = utils::as_u64(utils::div(utils::mul(utils::from_u64(fee_amount), utils::from_u64(init_stake_fee_withdraw as u64)), utils::from_u64(FEE_DENOMINATOR)));
        let platform_stake_share = utils::as_u64(utils::div(utils::mul(utils::from_u64(fee_amount), utils::from_u64(init_platform_stake_fee_withdraw as u64)), utils::from_u64(FEE_DENOMINATOR)));

        assert!(platform_share + creator_share + stake_share + platform_stake_share <= fee_amount, EInvalidWithdrawAmount);

        let platform_coin = coin::split(&mut pool.fee_recipient, platform_share, ctx);
        transfer::public_transfer(platform_coin, admin_platform_fee);

        let creator_coin = coin::split(&mut pool.fee_recipient, creator_share, ctx);
        moonbags_stake::deposit_creator_pool<Token>(stake_config, creator_coin, clock, ctx);

        let stake_coin = coin::split(&mut pool.fee_recipient, stake_share, ctx);
        moonbags_stake::update_reward_index<Token>(stake_config, stake_coin, clock, ctx);

        let platform_stake_coin = coin::split(&mut pool.fee_recipient, platform_stake_share, ctx);
        moonbags_stake::update_reward_index<PlatformToken>(stake_config, platform_stake_coin, clock, ctx);
        
        let remaining_fee = coin::value(&pool.fee_recipient);
        if (remaining_fee > 1000) {
            let remaining_coin = coin::split(&mut pool.fee_recipient, remaining_fee, ctx);
            transfer::public_transfer(remaining_coin, PLATFORM_TOKEN_BUYER);
        };
    }

    #[test_only]
    public(package) fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }

    #[test_only]
    public(package) fun create_pool_for_withdraw_fee_testing<Token>(configuration: &mut Configuration, mut treasury_cap: coin::TreasuryCap<Token>, fee_recipient: Coin<AIDA>, ctx: &mut TxContext) {
        let pool = Pool<Token> {
            id                          : object::new(ctx),
            real_sui_reserves           : coin::zero<AIDA>(ctx),
            real_token_reserves         : coin::mint<Token>(&mut treasury_cap, configuration.remain_token_reserves - configuration.initial_virtual_token_reserves, ctx),
            virtual_token_reserves      : configuration.initial_virtual_token_reserves,
            virtual_sui_reserves        : calculate_init_sui_reserves(configuration, DEFAULT_THRESHOLD),
            remain_token_reserves       : coin::mint<Token>(&mut treasury_cap, configuration.remain_token_reserves, ctx),
            fee_recipient               : fee_recipient,
            is_completed                : false,
            platform_fee_withdraw       : configuration.init_platform_fee_withdraw,
            creator_fee_withdraw        : configuration.init_creator_fee_withdraw,
            stake_fee_withdraw          : configuration.init_stake_fee_withdraw,
            platform_stake_fee_withdraw : configuration.init_platform_stake_fee_withdraw,
            threshold                   : DEFAULT_THRESHOLD,
        };

        dynamic_object_field::add<String, Pool<Token>>(
            &mut configuration.id,
            type_name::get_address(&type_name::get<Token>()),
            pool
        );

        transfer::public_transfer(treasury_cap, ctx.sender());
    }

    #[test_only]
    public(package) fun update_config_for_testing(configuration: &mut Configuration, token_platform_type_name: String) {
        configuration.token_platform_type_name = token_platform_type_name;
    }

    #[test_only]
    public(package) fun get_config_value_for_testing(configuration: &Configuration) : (u16, u16, u16, u16) {
        (
            configuration.init_platform_fee_withdraw,
            configuration.init_creator_fee_withdraw,
            configuration.init_stake_fee_withdraw,
            configuration.init_platform_stake_fee_withdraw
        )
    }

    #[test_only]
    public(package) fun join_sui_for_testing<Token>(pool: &mut Pool<Token>, coin_sui: Coin<AIDA>) {
        pool.virtual_sui_reserves = pool.virtual_sui_reserves + coin::value(&coin_sui);
        coin::join(&mut pool.real_sui_reserves, coin_sui);
    }

    // === V4 Cetus auto-migration ===========================================
    // Original V4 entry — DO NOT change this signature. Sui's "compatible"
    // upgrade policy rejects any signature change on a previously published
    // public function, so once V4 shipped with `pool: &mut Pool<Token>`
    // we're stuck with this shape forever.
    //
    // The argument design turned out to be unusable from a PTB: the AIDA
    // fork stores per-token pools as dynamic object fields hanging off
    // Configuration, so external callers can't obtain the `&mut Pool<T>`
    // needed for arg 4. The replacement that actually works is
    // `init_cetus_aida_pool_v2` below, which takes Configuration and
    // borrows the Pool internally. Existing callers should switch to v2;
    // this entry is left in place purely to keep the upgrade compatible.
    //
    // Mirror of `moonbags::init_cetus_pool` in the SUI fork — tick math
    // (spacing 200, -443600..443600, Q64 sqrt price) is pool-agnostic.
    public entry fun init_cetus_aida_pool<Token>(
        admin: address,
        coin_aida: Coin<AIDA>,
        coin_token: Coin<Token>,
        pool: &mut Pool<Token>,
        cetus_burn_manager: &mut BurnManager,
        cetus_pools: &mut Pools,
        cetus_config: &mut GlobalConfig,
        metadata_aida: &CoinMetadata<AIDA>,
        metadata_token: &CoinMetadata<Token>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        init_cetus_aida_pool_inner<Token>(
            admin,
            pool,
            coin_aida,
            coin_token,
            cetus_burn_manager,
            cetus_pools,
            cetus_config,
            metadata_aida,
            metadata_token,
            clock,
            ctx,
        );
    }

    // === V5 Cetus auto-migration (callable from PTB) =======================
    // Replacement for init_cetus_aida_pool. Takes &mut Configuration and
    // borrows the Pool<Token> internally via dynamic_object_field, so this
    // is the variant Jack's cron and ad-hoc admin tx actually call.
    public entry fun init_cetus_aida_pool_v2<Token>(
        admin: address,
        configuration: &mut Configuration,
        coin_aida: Coin<AIDA>,
        coin_token: Coin<Token>,
        cetus_burn_manager: &mut BurnManager,
        cetus_pools: &mut Pools,
        cetus_config: &mut GlobalConfig,
        metadata_aida: &CoinMetadata<AIDA>,
        metadata_token: &CoinMetadata<Token>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let token_address = type_name::get<Token>();
        let pool = dynamic_object_field::borrow_mut<String, Pool<Token>>(
            &mut configuration.id,
            type_name::get_address(&token_address)
        );
        init_cetus_aida_pool_inner<Token>(
            admin,
            pool,
            coin_aida,
            coin_token,
            cetus_burn_manager,
            cetus_pools,
            cetus_config,
            metadata_aida,
            metadata_token,
            clock,
            ctx,
        );
    }

    // Shared body — both entries above flow through here. Splitting the
    // logic out keeps the v1/v2 entries identical apart from how they
    // obtain the &mut Pool reference.
    fun init_cetus_aida_pool_inner<Token>(
        admin: address,
        pool: &mut Pool<Token>,
        coin_aida: Coin<AIDA>,
        coin_token: Coin<Token>,
        cetus_burn_manager: &mut BurnManager,
        cetus_pools: &mut Pools,
        cetus_config: &mut GlobalConfig,
        metadata_aida: &CoinMetadata<AIDA>,
        metadata_token: &CoinMetadata<Token>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(pool.is_completed, EPoolNotComplete);

        let token_amount = coin::value<Token>(&coin_token) as u256;
        let aida_amount = coin::value<AIDA>(&coin_aida) as u256;

        let icon_url = if (coin::get_icon_url<Token>(metadata_token).is_some()) {
            coin::get_icon_url<Token>(metadata_token).extract().inner_url().to_string()
        } else {
            string::utf8(b"")
        };

        // Sui's Cetus expects Q64.64 sqrt price. 340282366920938463463374607431768211456 = 2^128.
        let (position, coin_token_refund, coin_aida_refund) = pool_creator::create_pool_v2<Token, AIDA>(
            cetus_config,
            cetus_pools,
            200, // tick spacing — Cetus standard
            sqrt(340282366920938463463374607431768211456 * aida_amount / token_amount),
            icon_url,
            4294523696, // lower tick (full-range for tick_spacing=200)
            443600,     // upper tick
            coin_token,
            coin_aida,
            metadata_token,
            metadata_aida,
            true, // fix_amount_a: use token_amount as exact, AIDA side adjusts
            clock,
            ctx
        );

        let burn_proof = lp_burn::burn_lp_v2(cetus_burn_manager, position, ctx);
        dynamic_object_field::add(&mut pool.id, BURN_PROOF_FIELD, burn_proof);

        // Any residual coins returned from Cetus (rounding dust or single-sided
        // liquidity on an off-peg first buy) go back to the admin.
        transfer::public_transfer<Coin<Token>>(coin_token_refund, admin);
        transfer::public_transfer<Coin<AIDA>>(coin_aida_refund, admin);
    }

    // Integer square root (u256 → u128), Newton's method. Copied from the
    // SUI fork — needed to build the Q64 sqrt price for Cetus init.
    fun sqrt(number: u256) : u128 {
        assert!(number > 0, EInvalidInput);
        let mut result = number;
        let mut next_estimate = (number + 1) / 2;
        while (next_estimate < result) {
            result = next_estimate;
            let sum = next_estimate + number / next_estimate;
            next_estimate = sum / 2;
        };
        result as u128
    }

    #[test_only]
    public(package) fun borrow_mut_pool<Token>(configuration: &mut Configuration): &mut Pool<Token> {
        let token_address = type_name::get<Token>();
        dynamic_object_field::borrow_mut<String, Pool<Token>>(&mut configuration.id, type_name::get_address(&token_address))
    }

    #[test_only]
    public(package) fun get_pool_info_for_testing<Token>(configuration: &Configuration) : (u64, u64, u64, u64, bool, u64) {
        let token_address = type_name::get<Token>();
        let pool = dynamic_object_field::borrow<String, Pool<Token>>(&configuration.id, type_name::get_address(&token_address));
        
        (
            coin::value(&pool.real_sui_reserves),
            coin::value(&pool.real_token_reserves),
            pool.virtual_sui_reserves,
            pool.virtual_token_reserves,
            pool.is_completed,
            coin::value(&pool.fee_recipient)
        )
    }
}
