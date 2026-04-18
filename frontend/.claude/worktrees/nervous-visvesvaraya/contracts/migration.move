// Odyssey Launchpad Migration Contract
// Adds 100 SUI migration fee to treasury after curve fills

module odyssey_launchpad::migration {
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
    const DEX_CETUS: u8 = 0;
    const DEX_TURBOS: u8 = 1;
    
    // === Errors ===
    
    const EInsufficientSUI: u64 = 1;
    const EPoolNotComplete: u64 = 2;
    const EAlreadyMigrated: u64 = 3;
    
    // === Structs ===
    
    /// Migration configuration - shared object
    public struct MigrationConfig has key {
        id: UID,
        treasury: address,
        admin: address,
        migration_fee: u64,
    }
    
    /// Admin capability
    public struct MigrationAdmin has key, store {
        id: UID,
    }
    
    /// Tracks migration state per pool
    public struct PoolMigration has key, store {
        id: UID,
        pool_id: ID,
        migrated: bool,
        sui_raised: u64,
        tokens_sold: u64,
    }
    
    // === Initializer ===
    
    /// Create migration config and transfer admin cap
    fun init(ctx: &mut TxContext) {
        let config = MigrationConfig {
            id: object::new(ctx),
            treasury: @0x92a32ac7fd525f8bd37ed359423b8d7d858cad26224854dfbff1914b75ee658b,
            admin: tx_context::sender(ctx),
            migration_fee: MIGRATION_FEE_SUI,
        };
        
        let admin = MigrationAdmin {
            id: object::new(ctx),
        };
        
        transfer::share_object(config);
        transfer::transfer(admin, tx_context::sender(ctx));
    }
    
    // === Public Functions ===
    
    /// Initialize migration for a new pool
    public fun init_pool_migration(
        config: &MigrationConfig,
        pool_id: ID,
        ctx: &mut TxContext,
    ) {
        let migration = PoolMigration {
            id: object::new(ctx),
            pool_id,
            migrated: false,
            sui_raised: 0,
            tokens_sold: 0,
        };
        
        transfer::transfer(migration, tx_context::sender(ctx));
    }
    
    /// Migrate pool to DEX - collects 100 SUI fee to treasury
    public fun migrate_to_dex(
        config: &MigrationConfig,
        migration: &mut PoolMigration,
        pool_sui_balance: &mut Balance<SUI>,
        pool_token_balance: &mut Balance<AIDA>,
        clock: &Clock,
        dex_type: u8,
        ctx: &mut TxContext,
    ) {
        // Check not already migrated
        assert!(!migration.migrated, EAlreadyMigrated);
        
        let sui_balance = pool_sui_balance.value();
        
        // Check sufficient SUI for migration fee
        assert!(sui_balance >= config.migration_fee, EInsufficientSUI);
        
        // Take 100 SUI migration fee to treasury
        let fee = pool_sui_balance.split(config.migration_fee);
        transfer::public_transfer(fee.into_coin(ctx), config.treasury);
        
        // Mark as migrated
        migration.migrated = true;
        
        // TODO: Add DEX liquidity logic here
        // - Send remaining SUI to DEX
        // - Send tokens to DEX liquidity pool
        // - Mint LP tokens
        
        // Emit event
        // TODO: emit MigrationEvent { ... }
    }
    
    /// Update treasury address (admin only)
    public fun update_treasury(
        _: &MigrationAdmin,
        config: &mut MigrationConfig,
        new_treasury: address,
    ) {
        config.treasury = new_treasury;
    }
    
    /// Update migration fee (admin only)
    public fun update_migration_fee(
        _: &MigrationAdmin,
        config: &mut MigrationConfig,
        new_fee: u64,
    ) {
        config.migration_fee = new_fee;
    }
    
    // === Test Helper ===
    
    #[test_only]
    public fun init_for_test(ctx: &mut TxContext) {
        init(ctx);
    }
}
