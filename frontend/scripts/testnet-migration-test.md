# Testnet Migration Test — Step-by-Step Guide

## Prerequisites
- Sui CLI installed (`sui --version`)
- Admin wallet with 100+ SUI on **testnet**
- Git clone of `moonbags-contracts-sui` repo

## Step 0: Switch to Testnet

```bash
sui client switch --env testnet
sui client active-address
sui client gas  # Verify you have 100+ SUI
```

## Step 1: Clone and Configure the Contract

```bash
cd ~
git clone https://github.com/aidaonsui-collab/moonbags-contracts-sui.git
cd moonbags-contracts-sui
```

Edit `Move.toml` — change the Sui dependency to testnet:
```toml
[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet" }
```

**Important**: The external packages (cetus_clmm, turbos_clmm, lp_burn) may need testnet versions too. If the build fails due to dependency issues, see "Alternative: Use Cetus testnet addresses" below.

## Step 2: Deploy the Contract

```bash
sui move build
sui client publish --gas-budget 500000000
```

Save the output! You need:
- **Package ID** (the published package address)
- **Configuration object ID** (shared object created by `init()`)
- **AdminCap object ID** (transferred to your wallet)

Example output to look for:
```
Created Objects:
  - ID: 0xABC... , Owner: Shared (Configuration)
  - ID: 0xDEF... , Owner: Account (AdminCap)
Published:
  - PackageID: 0x123...
```

## Step 3: Update Config for Low Threshold Test

The contract initializes with default config. You may want to update it via `update_config`:

```bash
# The init() sets:
# - initial_virtual_token_reserves: 533333333500000
# - remain_token_reserves: 1066666667000000
# - platform_fee: 200 (2%)
# - token_platform_type_name: "...::shr::SHR" (you'll change this to AIDA later)
#
# For testnet testing, defaults are fine.
```

## Step 4: Create a Test Token

You need a fresh coin type to test with. Create a simple Move module:

Create file `test_token/sources/test_token.move`:
```move
module test_token::test_token {
    use sui::coin;

    public struct TEST_TOKEN has drop {}

    fun init(witness: TEST_TOKEN, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency(
            witness,
            6,           // decimals
            b"TEST",     // symbol
            b"TestMigrate", // name
            b"Testing bonding curve migration", // description
            option::none(), // icon_url
            ctx,
        );
        transfer::public_transfer(treasury_cap, tx_context::sender(ctx));
        transfer::public_transfer(metadata, tx_context::sender(ctx));
    }
}
```

Create `test_token/Move.toml`:
```toml
[package]
name = "test_token"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet" }

[addresses]
test_token = "0x0"
```

Deploy:
```bash
cd test_token
sui move build
sui client publish --gas-budget 100000000
```

Save:
- **Token Package ID** (e.g. `0xTOKENPKG...`)
- **TreasuryCap object ID**
- **CoinMetadata object ID**

Your token type will be: `0xTOKENPKG::test_token::TEST_TOKEN`

## Step 5: Create Pool with Low Threshold (Cetus DEX = Auto-Migration)

**Important**: Use `bonding_dex = 0` (Cetus) for automatic on-chain migration. Turbos (dex=1) just sends funds to a deployer wallet and requires manual pool creation.

**However**: On testnet, Cetus contracts may not be deployed at the same addresses. If Cetus is not available on testnet, use Turbos (dex=1) — the funds will go to the BONDING_DEPLOYER address and you can verify the transfer happened.

### Using Sui CLI directly:

```bash
# Set these variables from your deployment output:
PACKAGE_ID="0x..."          # Your deployed moonbags package
CONFIG_ID="0x..."           # Configuration shared object
STAKE_CONFIG_ID="0x..."     # StakeConfig (created by init in moonbags_stake)
LOCK_CONFIG_ID="0x..."      # TokenLockConfig (created by init in moonbags_token_lock)
TREASURY_CAP="0x..."        # TreasuryCap<TEST_TOKEN>
TOKEN_METADATA="0x..."      # CoinMetadata<TEST_TOKEN>
TOKEN_TYPE="0xTOKENPKG::test_token::TEST_TOKEN"

# Cetus testnet objects (check if available):
# CETUS_BURN_MANAGER="0xd04529ef15b7dad6699ee905daca0698858cab49724b2b2a1fc6b1ebc5e474ef"
# CETUS_POOLS="0x50eb61dd5928cec5ea04711a2e9b72e5237e79e9fbcd2ce3d5469dc8708e0ee2"  
# CETUS_GLOBAL_CONFIG="0x9774e359588ead122af1c7e7f64e14ade261cfeecdb5d0eb4a5b3b4c8ab8bd3e"

# SUI Metadata (same on all networks):
SUI_METADATA="0x9258181f5ceac8dbffb7030890243caed69a9599d2886d957a9cb7656af3bdb3"

# Create pool with 100 SUI threshold, first buy of 1 SUI, Cetus DEX
sui client call \
  --package $PACKAGE_ID \
  --module moonbags \
  --function create_and_lock_first_buy_with_fee \
  --type-args "$TOKEN_TYPE" \
  --args \
    "$CONFIG_ID" \
    "$STAKE_CONFIG_ID" \
    "$LOCK_CONFIG_ID" \
    "$TREASURY_CAP" \
    "1000000000" \
    "0" \
    "1000000000" \
    "1000000" \
    "[100000000000]" \
    "0" \
    "0x6" \
    "TestMigrate" \
    "TEST" \
    "https://example.com/logo.png" \
    "Testing migration" \
    "" \
    "" \
    "" \
    "$CETUS_BURN_MANAGER" \
    "$CETUS_POOLS" \
    "$CETUS_GLOBAL_CONFIG" \
    "$SUI_METADATA" \
    "$TOKEN_METADATA" \
  --gas-budget 500000000
```

**Argument breakdown:**
| # | Value | Meaning |
|---|-------|---------|
| pool_creation_fee | 1000000000 (1 SUI) | Pool creation fee (0.01 SUI min) |
| bonding_dex | 0 | Cetus (auto-migrate) or 1 (Turbos) |
| coin_sui | 1000000000 (1 SUI) | First buy amount |
| amount_out | 1000000 | Tokens to receive |
| threshold | [100000000000] | 100 SUI threshold (Option<u64>) |
| locking_time_ms | 0 | No token lock |

## Step 6: Fill the Bonding Curve

Now buy tokens until the curve is filled. You need ~99 more SUI (since you already bought 1 SUI in step 5).

```bash
POOL_ID="0x..."  # From the CreatedEventV2 in step 5 output

# Buy with 50 SUI
sui client call \
  --package $PACKAGE_ID \
  --module moonbags \
  --function buy_exact_in_with_lock \
  --type-args "$TOKEN_TYPE" \
  --args \
    "$CONFIG_ID" \
    "$LOCK_CONFIG_ID" \
    "50000000000" \
    "50000000000" \
    "1" \
    "$CETUS_BURN_MANAGER" \
    "$CETUS_POOLS" \
    "$CETUS_GLOBAL_CONFIG" \
    "$SUI_METADATA" \
    "0x6" \
  --gas-budget 500000000

# Buy with another 50 SUI (this should trigger graduation!)
sui client call \
  --package $PACKAGE_ID \
  --module moonbags \
  --function buy_exact_in_with_lock \
  --type-args "$TOKEN_TYPE" \
  --args \
    "$CONFIG_ID" \
    "$LOCK_CONFIG_ID" \
    "50000000000" \
    "50000000000" \
    "1" \
    "$CETUS_BURN_MANAGER" \
    "$CETUS_POOLS" \
    "$CETUS_GLOBAL_CONFIG" \
    "$SUI_METADATA" \
    "0x6" \
  --gas-budget 500000000
```

## Step 7: Verify Migration

After the curve fills, look for these events in the transaction output:

1. **`PoolCompletedEventV2`** — confirms `is_completed = true`
2. **`PoolMigratingEvent`** — shows SUI amount, token amount, and DEX type

If using Cetus (dex=0):
- A new Cetus CLMM pool should be created (Token/SUI pair)
- LP position is auto-burned (stored as burn_proof in pool)
- Check on Cetus testnet explorer for the new pool

If using Turbos (dex=1):
- SUI + tokens transferred to `BONDING_DEPLOYER` address
- No pool created automatically — manual step needed

## Troubleshooting

### "ECompletedPool" error
Pool already graduated. Check with `sui client object $POOL_ID` — look for `is_completed: true`.

### Cetus objects not found on testnet
Cetus may not be deployed on testnet. Use Turbos (dex=1) instead, or check Cetus docs for testnet addresses.

### StakeConfig / LockConfig not found
These are created by `init()` in the `moonbags_stake` and `moonbags_token_lock` modules during publish. Check the publish output for shared objects.

### Build errors with external deps
The Cetus/Turbos externals may use mainnet-specific code. If build fails, check if the external packages have testnet branches.
