// Odyssey Launchpad - Simple Migration with 100 SUI Fee
// Standalone contract that can be deployed independently

module odyssey_launchpad::odyssey_migration {
    use sui::balance::{Self, Balance};
    use sui::clock::Clock;
    use sui::coin::{Self, Coin};
    use sui::object::{Self, ID, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    // === Constants ===
    
    /// Migration fee: 100 SUI
    const MIGRATION_FEE_SUI: u64 = 100_000_000_000; // 100 SUI in MIST
    
    /// DEX types
    const DEX_NONE: u8 = 0;
    const DEX_CETUS: u8 = 1;
    const DEX_TURBOS: u8 = 2;
    
    // === Errors ===
    const EInsufficientSUI: u64 = 1;
    const EAlreadyMigrated: u64 = 2;
    const ENotComplete: u64 = 3;
    
    // === Structs ===
    
    /// Global config - shared object
    public struct OdysseyConfig has key, store {
        id: UID,
        treasury: address,
        admin: address,
        migration_fee: u64,
    }
    
    /// Admin capability
    public struct OdysseyAdmin has key, store {
        id: UID,
    }
    
    /// Per-pool migration state
    public struct PoolState has key, store {
        id: UID,
        pool_id: ID,
        token_address: address,
        migrated: bool,
        dex_type: u8,
        sui_raised: u64,
    }
    
    // === Events ===
    
    public struct MigrationEvent has copy, drop {
        pool_id: ID,
        treasury: address,
        fee_collected: u64,
        dex_type: u8,
    }
    
    // === Initializer ===
    
    /// Create config and admin - called once on deployment
    fun init(ctx: &mut TxContext) {
        let config = OdysseyConfig {
            id: object::new(ctx),
            treasury: @0x92a32ac7fd525f8bd37ed359423b8d7d858cad26224854dfbff1914b75ee658b,
            admin: tx_context::sender(ctx),
            migration_fee: MIGRATION_FEE_SUI,
        };
        
        let admin = OdysseyAdmin {
            id: object::new(ctx),
        };
        
        transfer::share_object(config);
        transfer::transfer(admin, tx_context::sender(ctx));
    }
    
    // === Admin Functions ===
    
    /// Update treasury address
    public fun update_treasury(
        _: &OdysseyAdmin,
        config: &mut OdysseyConfig,
        new_treasury: address,
    ) {
        config.treasury = new_treasury;
    }
    
    /// Update migration fee
    public fun update_migration_fee(
        _: &OdysseyAdmin,
        config: &mut OdysseyConfig,
        new_fee: u64,
    ) {
        config.migration_fee = new_fee;
    }
    
    // === Public Functions ===
    
    /// Initialize a new pool for migration tracking
    public fun init_pool(
        config: &OdysseyConfig,
        pool_id: ID,
        token_address: address,
        dex_type: u8,
        ctx: &mut TxContext,
    ) {
        let pool = PoolState {
            id: object::new(ctx),
            pool_id,
            token_address,
            migrated: false,
            dex_type,
            sui_raised: 0,
        };
        
        transfer::transfer(pool, tx_context::sender(ctx));
    }
    
    /// Migrate pool to DEX - collects fee to treasury
    /// This is called when the bonding curve is complete
    public fun migrate_to_dex(
        config: &OdysseyConfig,
        pool: &mut PoolState,
        pool_sui_balance: &mut Balance<SUI>,
        pool_token_balance: &mut Balance<OdysseyToken>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Check not already migrated
        assert!(!pool.migrated, EAlreadyMigrated);
        
        let sui_balance = pool_sui_balance.value();
        
        // Check sufficient SUI for migration fee
        assert!(sui_balance >= config.migration_fee, EInsufficientSUI);
        
        // Take migration fee to treasury
        let fee = pool_sui_balance.split(config.migration_fee);
        transfer::public_transfer(fee.into_coin(ctx), config.treasury);
        
        // Mark as migrated
        pool.migrated = true;
        
        // TODO: Add DEX-specific logic here
        // For Cetus: call their router to add liquidity
        // For Turbos: call their router to add liquidity
        
        // Emit event
        transfer::emit(MigrationEvent {
            pool_id: pool.pool_id,
            treasury: config.treasury,
            fee_collected: config.migration_fee,
            dex_type: pool.dex_type,
        });
    }
    
    /// Helper: Check if pool is migrated
    public fun is_migrated(pool: &PoolState): bool {
        pool.migrated
    }
    
    /// Helper: Get pool info
    public fun get_pool_info(pool: &PoolState): (ID, address, bool, u8, u64) {
        (pool.pool_id, pool.token_address, pool.migrated, pool.dex_type, pool.sui_raised)
    }
    
    // === Test Helper ===
    
    #[test_only]
    public fun init_for_test(ctx: &mut TxContext) {
        init(ctx);
    }
    
    #[test_only]
    public fun set_treasury_for_test(config: &mut OdysseyConfig, addr: address) {
        config.treasury = addr;
    }
}

// Stub for the token type - in real deployment would use the actual token
public struct OdysseyToken has drop {}
