#[allow(lint(self_transfer))]
module moonbags_aida::moonbags_stake {
    // === Imports ===
    use std::type_name;
    use std::ascii::String;

    use sui::coin::{Self, Coin};
    use sui::dynamic_object_field;
    use sui::event::emit;
    use sui::clock::{Clock, Self};
    use 0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA;

    // === Errors ===
    const EStakingPoolNotExist: u64 = 1;
    const EStakingCreatorNotExist: u64 = 2;
    const EStakingAccountNotExist: u64 = 3;
    const EAccountBalanceNotEnough: u64 = 4;
    const EInvalidCreator: u64 = 5;
    const EInvalidAmount: u64 = 6;
    const ERewardToClaimNotValid: u64 = 7;
    const EUnstakeDeadlineNotAllow: u64 = 8;
    const ENotUpgrade: u64 = 9;
    const EWrongVersion: u64 = 10;

    // === Constants ===
    const MULTIPLIER: u128 = 10_000_000_000_000_000; // 1e16
    const VERSION: u64 = 1;

    // === Structs ===
    public struct AdminCap has key {
        id: UID,
    }

    public struct Configuration has key, store {
        id: UID,
        version: u64,
        admin: address,
        deny_unstake_duration_ms: u64,
    }

    #[allow(lint(coin_field))]
    public struct StakingPool<phantom StakingToken> has key, store {
        id: UID,
        staking_token: Coin<StakingToken>,
        sui_token: Coin<AIDA>,
        total_supply: u64,
        reward_index: u128,
        pending_initial_rewards: u64,
    }

    #[allow(lint(coin_field))]
    public struct CreatorPool<phantom StakingToken> has key, store {
        id: UID,
        sui_token: Coin<AIDA>,
        creator: address,
    }

    public struct StakingAccount has key, store {
        id: UID,
        staker: address,
        balance: u64,
        reward_index: u128,
        earned: u64,
        unstake_deadline: u64,
    }

    // === Events ===
    public struct InitializeStakingPoolEvent has copy, drop, store {
        token_address: String,
        staking_pool: ID,
        initializer: String,
        timestamp: u64,
    }

    public struct InitializeCreatorPoolEvent has copy, drop, store {
        token_address: String,
        creator_pool: ID,
        initializer: String,
        creator: String,
        timestamp: u64,
    }

    public struct StakeEvent has copy, drop, store {
        token_address: String,
        staking_pool: ID,
        staking_account: ID,
        staker: String,
        amount: u64,
        timestamp: u64,
    }

    public struct UnstakeEvent has copy, drop, store {
        token_address: String,
        staking_pool: ID,
        staking_account: ID,
        is_staking_account_deleted: bool,
        unstaker: String,
        amount: u64,
        timestamp: u64,
    }

    public struct UpdateRewardIndexEvent has copy, drop, store {
        token_address: String,
        staking_pool: ID,
        reward_updater: String,
        reward: u64,
        timestamp: u64,
        is_initial_rewards: bool,
    }

    public struct DepositPoolCreatorEvent has copy, drop, store {
        token_address: String,
        creator_pool: ID,
        depositor: String,
        amount: u64,
        timestamp: u64,
    }

    public struct ClaimStakingPoolEvent has copy, drop, store {
        token_address: String,
        staking_pool: ID,
        staking_account: ID,
        is_staking_account_deleted: bool,
        claimer: String,
        reward: u64,
        timestamp: u64,
    }
    
    public struct ClaimCreatorPoolEvent has copy, drop, store {
        token_address: String,
        creator_pool: ID,
        claimer: String,
        reward: u64,
        timestamp: u64,
    }

    public struct UpdateCreatorEvent has copy, drop, store {
        token_address: String,
        creator_pool: ID,
        old_creator: String,
        new_creator: String,
        updated_by: String,
    }

    fun init(ctx: &mut TxContext) {
        let admin = AdminCap {
            id: object::new(ctx),
        };

        let configuration = Configuration {
            id: object::new(ctx),
            version: 1,
            admin: ctx.sender(),
            deny_unstake_duration_ms: 60 * 60 * 1000, // 1 hour
        };
        transfer::public_share_object<Configuration>(configuration);

        transfer::transfer(admin, ctx.sender());
    }

    // === Public Functions ===

    /*
     * Initializes a new staking pool for a specific token type.
     * 
     * @typeArgument StakingToken - The token type that will be staked in this pool.
     * @param configuration - Global configuration object.
     * @param clock - clock for timestamp recording.
     * @param ctx - Mutable transaction context.
     */
    public entry fun initialize_staking_pool<StakingToken>(configuration: &mut Configuration, clock: &Clock, ctx: &mut TxContext) {
        assert_version(configuration.version);
        let staking_pool_type_name = type_name::into_string(type_name::get<StakingPool<StakingToken>>());
        
        // Return early if staking pool already exists to prevent revert when called by create bonding pool function
        if (dynamic_object_field::exists_(&configuration.id, staking_pool_type_name)) {
            return
        };

        let staking_pool = StakingPool<StakingToken> {
            id                      : object::new(ctx),
            staking_token           : coin::zero<StakingToken>(ctx),
            sui_token               : coin::zero<AIDA>(ctx),
            total_supply            : 0,
            reward_index            : 0,
            pending_initial_rewards : 0,
        };

        let initialize_staking_pool_event = InitializeStakingPoolEvent {
            token_address       : type_name::into_string(type_name::get<StakingToken>()),
            staking_pool        : object::id(&staking_pool),
            initializer         : ctx.sender().to_ascii_string(),
            timestamp           : clock::timestamp_ms(clock),
        };
        emit<InitializeStakingPoolEvent>(initialize_staking_pool_event);

        dynamic_object_field::add(&mut configuration.id, staking_pool_type_name, staking_pool);
    }

    /*
     * Initializes a creator pool for a specific token type.
     * 
     * @typeArgument StakingToken - The token type associated with this creator pool.
     * @param configuration - Global configuration object.
     * @param creator - Address of the creator for this pool.
     * @param clock - Clock for timestamp recording.
     * @param ctx - Mutable transaction context.
     */
    public(package) entry fun initialize_creator_pool<StakingToken>(configuration: &mut Configuration, creator: address, clock: &Clock, ctx: &mut TxContext) {
        assert_version(configuration.version);
        let creator_pool_type_name = type_name::into_string(type_name::get<CreatorPool<StakingToken>>());

        // Return early if creator pool already exists to prevent revert when called by create bonding pool function
        if (dynamic_object_field::exists_(&configuration.id, creator_pool_type_name)) {
            return
        };

        let creator_pool = CreatorPool<StakingToken> {
            id                  : object::new(ctx),
            sui_token           : coin::zero<AIDA>(ctx),
            creator             : creator,
        };

        let initialize_staking_pool_event = InitializeCreatorPoolEvent {
            token_address       : type_name::into_string(type_name::get<StakingToken>()),
            creator_pool        : object::id(&creator_pool),
            initializer         : ctx.sender().to_ascii_string(),
            creator             : creator.to_ascii_string(),
            timestamp           : clock::timestamp_ms(clock),
        };
        emit<InitializeCreatorPoolEvent>(initialize_staking_pool_event);

        dynamic_object_field::add(&mut configuration.id, creator_pool_type_name, creator_pool);
    }

    /*
     * Updates the reward index of a staking pool by adding new rewards.
     * 
     * @typeArgument StakingToken - The token type associated with the staking pool.
     * @param configuration - Global configuration object.
     * @param reward_sui_coin - SUI coin to be added as rewards to the staking pool.
     * @param clock - Clock for timestamp recording.
     * @param ctx - Mutable transaction context for sender information.
     */
    public entry fun update_reward_index<StakingToken>(configuration: &mut Configuration, reward_sui_coin: Coin<AIDA>, clock: &Clock, ctx: &mut TxContext) {
        assert_version(configuration.version);
        let staking_pool_type_name = type_name::into_string(type_name::get<StakingPool<StakingToken>>());

        assert!(dynamic_object_field::exists_(&configuration.id, staking_pool_type_name), EStakingPoolNotExist);

        let staking_pool = dynamic_object_field::borrow_mut<String, StakingPool<StakingToken>>(
            &mut configuration.id,
            staking_pool_type_name
        );

        let reward_amount = coin::value<AIDA>(&reward_sui_coin);
        assert!(reward_amount > 0, EInvalidAmount);

        // no stakers
        if (staking_pool.total_supply == 0) {
            staking_pool.pending_initial_rewards = staking_pool.pending_initial_rewards + reward_amount;
            coin::join(&mut staking_pool.sui_token, reward_sui_coin);

            emit<UpdateRewardIndexEvent>(UpdateRewardIndexEvent {
                token_address       : type_name::into_string(type_name::get<StakingToken>()),
                staking_pool        : object::id(staking_pool),
                reward_updater      : ctx.sender().to_ascii_string(),
                reward              : reward_amount,
                timestamp           : clock::timestamp_ms(clock),
                is_initial_rewards  : true,
            });
            return
        };

        staking_pool.reward_index = staking_pool.reward_index + (reward_amount as u128) * MULTIPLIER / (staking_pool.total_supply as u128);

        coin::join(&mut staking_pool.sui_token, reward_sui_coin);

        let update_reward_index_event = UpdateRewardIndexEvent {
            token_address       : type_name::into_string(type_name::get<StakingToken>()),
            staking_pool        : object::id(staking_pool),
            reward_updater      : ctx.sender().to_ascii_string(),
            reward              : reward_amount,
            timestamp           : clock::timestamp_ms(clock),
            is_initial_rewards  : false,
        };
        emit<UpdateRewardIndexEvent>(update_reward_index_event);
    }

    /*
     * Deposits SUI coin into a creator pool.
     * 
     * @typeArgument StakingToken - The token type associated with the creator pool.
     * @param configuration - Global configuration object.
     * @param reward_sui_coin - SUI coin to be deposited into the creator pool.
     * @param clock - Clock for timestamp recording.
     * @param ctx - Mutable transaction context for sender information.
     */
    public entry fun deposit_creator_pool<StakingToken>(configuration: &mut Configuration, reward_sui_coin: Coin<AIDA>, clock: &Clock, ctx: &mut TxContext) {
        assert_version(configuration.version);
        let creator_pool_type_name = type_name::into_string(type_name::get<CreatorPool<StakingToken>>());

        assert!(dynamic_object_field::exists_(&configuration.id, creator_pool_type_name), EStakingCreatorNotExist);

        let creator_pool = dynamic_object_field::borrow_mut<String, CreatorPool<StakingToken>>(
            &mut configuration.id,
            creator_pool_type_name
        );

        let reward_amount = coin::value<AIDA>(&reward_sui_coin);
        assert!(reward_amount > 0, EInvalidAmount);

        coin::join(&mut creator_pool.sui_token, reward_sui_coin);

        let update_reward_index_event = DepositPoolCreatorEvent {
            token_address       : type_name::into_string(type_name::get<StakingToken>()),
            creator_pool        : object::id(creator_pool),
            depositor           : ctx.sender().to_ascii_string(),
            amount              : reward_amount,
            timestamp           : clock::timestamp_ms(clock)
        };
        emit<DepositPoolCreatorEvent>(update_reward_index_event);
    }

    /*
     * Stakes tokens in a staking pool.
     * 
     * @typeArgument StakingToken - The token type to stake.
     * @param configuration - Global configuration object.
     * @param staking_coin - Tokens to stake.
     * @param clock - Clock for timestamp recording.
     * @param ctx - Mutable transaction context.
     */
    public entry fun stake<StakingToken>(configuration: &mut Configuration, staking_coin: Coin<StakingToken>, clock: &Clock, ctx: &mut TxContext) {
        assert_version(configuration.version);
        let staking_pool_type_name = type_name::into_string(type_name::get<StakingPool<StakingToken>>());
        
        assert!(dynamic_object_field::exists_(&configuration.id, staking_pool_type_name), EStakingPoolNotExist);

        let staking_pool = dynamic_object_field::borrow_mut<String, StakingPool<StakingToken>>(
            &mut configuration.id,
            staking_pool_type_name
        );

        let staker_address = ctx.sender();
        if (!dynamic_object_field::exists_(&staking_pool.id, staker_address)) {
            // first time staking
            let new_staking_account = StakingAccount {
                id              : object::new(ctx),
                staker          : staker_address,
                balance         : 0,
                reward_index    : 0,
                earned          : staking_pool.pending_initial_rewards,
                unstake_deadline: 0,
            };
            staking_pool.pending_initial_rewards = 0;
            dynamic_object_field::add(&mut staking_pool.id, staker_address, new_staking_account);
        };

        let staking_pool_id = object::id(staking_pool);
        let staking_account: &mut StakingAccount = dynamic_object_field::borrow_mut(&mut staking_pool.id, staker_address);

        // Update rewards before stake
        update_rewards(staking_pool.reward_index, staking_account);

        let amount_token_staking_in = coin::value<StakingToken>(&staking_coin);
        assert!(amount_token_staking_in > 0, EInvalidAmount);

        let current_ms = clock::timestamp_ms(clock);
        staking_account.unstake_deadline = current_ms + configuration.deny_unstake_duration_ms;
        staking_account.balance = staking_account.balance + amount_token_staking_in;
        staking_pool.total_supply = staking_pool.total_supply + amount_token_staking_in;

        coin::join(&mut staking_pool.staking_token, staking_coin);

        let stake_event = StakeEvent {
            token_address       : type_name::into_string(type_name::get<StakingToken>()),
            staking_pool        : staking_pool_id,
            staking_account     : object::id(staking_account),
            staker              : staker_address.to_ascii_string(),
            amount              : amount_token_staking_in,
            timestamp           : current_ms,
        };
        emit<StakeEvent>(stake_event);
    }

    /*
     * Unstakes tokens from a staking pool.
     * 
     * @typeArgument StakingToken - The token type to unstake.
     * @param configuration - Global configuration object.
     * @param unstake_amount - Amount of tokens to unstake.
     * @param clock - Clock for timestamp recording.
     * @param ctx - Mutable transaction context for sender information.
     */
    public entry fun unstake<StakingToken>(configuration: &mut Configuration, unstake_amount: u64, clock: &Clock, ctx: &mut TxContext) {
        assert_version(configuration.version);
        assert!(unstake_amount > 0, EInvalidAmount);

        let staking_pool_type_name = type_name::into_string(type_name::get<StakingPool<StakingToken>>());

        assert!(dynamic_object_field::exists_(&configuration.id, staking_pool_type_name), EStakingPoolNotExist);

        let staking_pool = dynamic_object_field::borrow_mut<String, StakingPool<StakingToken>>(
            &mut configuration.id,
            staking_pool_type_name
        );

        let staker_address = ctx.sender();
        assert!(dynamic_object_field::exists_(&staking_pool.id, staker_address), EStakingAccountNotExist);

        let staking_pool_id = object::id(staking_pool);
        let staking_account: &mut StakingAccount = dynamic_object_field::borrow_mut(&mut staking_pool.id, staker_address);

        let current_ms = clock::timestamp_ms(clock);
        assert!(current_ms >= staking_account.unstake_deadline, EUnstakeDeadlineNotAllow);

        // Update rewards before unstake
        update_rewards(staking_pool.reward_index, staking_account);

        assert!(staking_account.balance >= unstake_amount, EAccountBalanceNotEnough);

        staking_account.balance = staking_account.balance - unstake_amount;
        staking_pool.total_supply = staking_pool.total_supply - unstake_amount;

        let unstake_coin = coin::split(&mut staking_pool.staking_token, unstake_amount, ctx);
        transfer::public_transfer<Coin<StakingToken>>(unstake_coin, staker_address);

        let staking_account_id = object::id(staking_account);

        // Try to clean up the account if it's empty
        let is_staking_account_deleted = try_cleanup_empty_account(staking_pool, staking_account.balance, staking_account.earned, staker_address);

        let unstake_event = UnstakeEvent {
            token_address               : type_name::into_string(type_name::get<StakingToken>()),
            staking_pool                : staking_pool_id,
            staking_account             : staking_account_id,
            is_staking_account_deleted  : is_staking_account_deleted,
            unstaker                    : staker_address.to_ascii_string(),
            amount                      : unstake_amount,
            timestamp                   : current_ms,
        };
        emit<UnstakeEvent>(unstake_event);
    }

    /*
     * Claims rewards from a staking pool.
     * 
     * @typeArgument StakingToken - The token type associated with the staking pool.
     * @param configuration - Global configuration object.
     * @param clock - Clock for timestamp recording.
     * @param ctx - Mutable transaction context for sender information.
     * @return The amount of SUI claimed as rewards.
     */
    public entry fun claim_staking_pool<StakingToken>(configuration: &mut Configuration, clock: &Clock, ctx: &mut TxContext) : u64 {
        assert_version(configuration.version);
        let staking_pool_type_name = type_name::into_string(type_name::get<StakingPool<StakingToken>>());

        assert!(dynamic_object_field::exists_(&configuration.id, staking_pool_type_name), EStakingPoolNotExist);

        let staking_pool = dynamic_object_field::borrow_mut<String, StakingPool<StakingToken>>(
            &mut configuration.id,
            staking_pool_type_name
        );

        let staker_address = ctx.sender();
        assert!(dynamic_object_field::exists_(&staking_pool.id, staker_address), EStakingAccountNotExist);

        let staking_pool_id = object::id(staking_pool);
        let staking_account: &mut StakingAccount = dynamic_object_field::borrow_mut(&mut staking_pool.id, staker_address);

        // Update rewards before claiming
        update_rewards(staking_pool.reward_index, staking_account);

        let reward_amount = staking_account.earned;

        assert!(reward_amount > 0, ERewardToClaimNotValid);

        staking_account.earned = 0;
        let sui_coin = coin::split(&mut staking_pool.sui_token, reward_amount, ctx);
        transfer::public_transfer<Coin<AIDA>>(sui_coin, staker_address);

        let staking_account_id = object::id(staking_account);

        // Try to clean up the account if it's empty
        let is_staking_account_deleted = try_cleanup_empty_account(staking_pool, staking_account.balance, staking_account.earned, staker_address);

        let claim_staking_pool_event = ClaimStakingPoolEvent {
            token_address               : type_name::into_string(type_name::get<StakingToken>()),
            staking_pool                : staking_pool_id,
            staking_account             : staking_account_id,
            is_staking_account_deleted  : is_staking_account_deleted,
            claimer                     : staker_address.to_ascii_string(),
            reward                      : reward_amount,
            timestamp                   : clock::timestamp_ms(clock),
        };
        emit<ClaimStakingPoolEvent>(claim_staking_pool_event);

        reward_amount
    }

    /*
     * Claims rewards from a creator pool.
     * 
     * @typeArgument StakingToken - The token type associated with the creator pool.
     * @param configuration - Global configuration object.
     * @param clock - Clock for timestamp recording.
     * @param ctx - Mutable transaction context for sender information.
     * @return The amount of SUI claimed from the creator pool.
     */
    public entry fun claim_creator_pool<StakingToken>(configuration: &mut Configuration, clock: &Clock, ctx: &mut TxContext) : u64 {
        assert_version(configuration.version);
        let creator_pool_type_name = type_name::into_string(type_name::get<CreatorPool<StakingToken>>());

        assert!(dynamic_object_field::exists_(&configuration.id, creator_pool_type_name), EStakingCreatorNotExist);

        let creator_pool = dynamic_object_field::borrow_mut<String, CreatorPool<StakingToken>>(
            &mut configuration.id,
            creator_pool_type_name,
        );

        assert!(creator_pool.creator == ctx.sender(), EInvalidCreator);

        let reward_amount = coin::value<AIDA>(&creator_pool.sui_token);
        assert!(reward_amount > 0, ERewardToClaimNotValid);

        let sui_coin = coin::split(&mut creator_pool.sui_token, reward_amount, ctx);
        transfer::public_transfer<Coin<AIDA>>(sui_coin, creator_pool.creator);

        let claim_creator_pool_event = ClaimCreatorPoolEvent {
            token_address       : type_name::into_string(type_name::get<StakingToken>()),
            creator_pool        : object::id(creator_pool),
            claimer             : ctx.sender().to_ascii_string(),
            reward              : reward_amount,
            timestamp           : clock::timestamp_ms(clock),
        };
        emit<ClaimCreatorPoolEvent>(claim_creator_pool_event);

        reward_amount
    }

    /*
     * Updates the creator address for a creator pool. Only admin can call this function.
     * 
     * @typeArgument StakingToken - The token type associated with the creator pool.
     * @param configuration - Global configuration object.
     * @param new_creator - New address to set as the creator for the pool.
     * @param ctx - Mutable transaction context for sender information.
     */
    public entry fun update_creator<StakingToken>(_: &AdminCap, configuration: &mut Configuration, new_creator: address, ctx: &mut TxContext) {
        assert_version(configuration.version);
        let creator_pool_type_name = type_name::into_string(type_name::get<CreatorPool<StakingToken>>());

        assert!(dynamic_object_field::exists_(&configuration.id, creator_pool_type_name), EStakingCreatorNotExist);

        let creator_pool = dynamic_object_field::borrow_mut<String, CreatorPool<StakingToken>>(
            &mut configuration.id,
            creator_pool_type_name,
        );

        let old_creator = creator_pool.creator;
        creator_pool.creator = new_creator;

        let update_creator_event = UpdateCreatorEvent {
            token_address: type_name::into_string(type_name::get<StakingToken>()),
            creator_pool: object::id(creator_pool),
            old_creator: old_creator.to_ascii_string(),
            new_creator: new_creator.to_ascii_string(),
            updated_by: ctx.sender().to_ascii_string(),
        };
        emit<UpdateCreatorEvent>(update_creator_event);
    }

    // === View Functions ===

    /*
     * Calculates the rewards earned by the sender for staking tokens.
     * 
     * @typeArgument StakingToken - The token type associated with the staking pool.
     * @param configuration - Global configuration object.
     * @param ctx - Mutable transaction context for sender information.
     * @return The total amount of rewards earned.
     */
    public entry fun calculate_rewards_earned<StakingToken>(configuration: &Configuration, ctx: &mut TxContext): u64 {
        assert_version(configuration.version);
        let staking_pool_type_name = type_name::into_string(type_name::get<StakingPool<StakingToken>>());

        assert!(dynamic_object_field::exists_(&configuration.id, staking_pool_type_name), EStakingPoolNotExist);

        let staking_pool = dynamic_object_field::borrow<String, StakingPool<StakingToken>>(
            &configuration.id,
            staking_pool_type_name
        );

        let staker_address = ctx.sender();
        assert!(dynamic_object_field::exists_(&staking_pool.id, staker_address), EStakingAccountNotExist);

        let staking_account: &StakingAccount = dynamic_object_field::borrow(&staking_pool.id, staker_address);

        staking_account.earned + calculate_rewards(staking_pool.reward_index, staking_account)
    }

    public entry fun update_config(_: &AdminCap, configuration: &mut Configuration, new_admin: address, new_deny_unstake_duration_ms: u64) {
        configuration.admin = new_admin;
        configuration.deny_unstake_duration_ms = new_deny_unstake_duration_ms;
    }

    public entry fun migrate_version(_: &AdminCap, configuration: &mut Configuration) {
        // This will update the min version which is still compatible
        // Allow both upgrade and downgrade version
        // assert!(configuration.version < VERSION, ENotUpgrade);
        configuration.version = VERSION;
    }

    public entry fun transfer_admin(admin_cap: AdminCap, new_admin: address) {
        transfer::transfer(admin_cap, new_admin);
    }

    // === Private Functions ===

    /*
     * Calculates the pending rewards for a staking account.
     * 
     * @param staking_pool_reward_index - Current reward index of the staking pool.
     * @param staking_account - The staking account to calculate rewards for.
     * @return The amount of pending rewards.
     */
    fun calculate_rewards(staking_pool_reward_index: u128, staking_account: &StakingAccount): u64 {
        let shares = staking_account.balance as u128;
        let reward_u128 = ((shares * (staking_pool_reward_index - staking_account.reward_index)) / MULTIPLIER);

        let reward_option = std::u128::try_as_u64(reward_u128);
        if (option::is_some(&reward_option)) {
            option::destroy_some(reward_option)
        } else {
            std::u64::max_value!()
        }
    }

    /*
     * Updates the rewards earned by a staking account based on the current reward index.
     * 
     * @param staking_pool_reward_index - Current reward index of the staking pool.
     * @param staking_account - The staking account to update rewards for.
     */
    fun update_rewards(staking_pool_reward_index: u128, staking_account: &mut StakingAccount) {
        staking_account.earned = staking_account.earned + calculate_rewards(staking_pool_reward_index, staking_account);
        staking_account.reward_index = staking_pool_reward_index;
    }

    /*
     * Attempts to clean up a staking account if it has zero balance and zero earned rewards.
     * 
     * @param staking_pool - Mutable reference to the staking pool containing the account.
     * @param staker_address - The address of the staker whose account should be checked.
     * @return A boolean indicating whether the account was deleted (true) or kept (false).
     */
    fun try_cleanup_empty_account<StakingToken>(staking_pool: &mut StakingPool<StakingToken>, staking_balance: u64, staking_earned: u64, staker: address): bool {
        let is_account_empty = (staking_balance == 0 && staking_earned == 0);
        
        if (is_account_empty) {
            let StakingAccount { id, staker: _, balance: _, reward_index: _, earned: _, unstake_deadline: _ } = 
                dynamic_object_field::remove(&mut staking_pool.id, staker);
            object::delete(id);
            return true
        };
        
        false
    }

    fun assert_version(version: u64) {
        assert!(version <= VERSION, EWrongVersion);
    }

    // === Test Functions ===
    #[test_only]
    public(package) fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }

    #[test_only]
    public(package) fun get_configuration_id_for_testing(config: &Configuration): &UID {
        &config.id
    }

    #[test_only]
    public(package) fun get_staking_pool_values_for_testing<StakingToken>(pool: &StakingPool<StakingToken>): (&UID ,u64, u64, u64, u128, u64) {
        (
            &pool.id,
            coin::value(&pool.staking_token),
            coin::value(&pool.sui_token),
            pool.total_supply,
            pool.reward_index,
            pool.pending_initial_rewards,
        )
    }

    #[test_only]
    public(package) fun get_staking_account_values_for_testing(account: &StakingAccount): (u64, u128, u64) {
        (
            account.balance,
            account.reward_index,
            account.earned,
        )
    }

   #[test_only]
    public(package) fun get_creator_pool_reward_value_for_testing<StakingToken>(pool: &CreatorPool<StakingToken>): u64 {
        coin::value(&pool.sui_token)
    }

    #[test_only]
    public(package) fun get_unstake_deadline_for_testing(account: &StakingAccount): u64 {
        account.unstake_deadline
    }
}