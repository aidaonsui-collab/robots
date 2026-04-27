// ============================================================
// Odyssey Founder NFT — commemorative NFT marking original
// agent creators on Odyssey.
//
// Design decisions:
//   - Single shared Move type (OdysseyFounderNFT). Every agent's
//     Founder NFT is an instance of this one type, so TradePort
//     only needs to index one collection.
//   - AdminCap-gated mint. Only Odyssey (holder of AdminCap)
//     can mint. Prevents squatting the collection.
//   - Off-chain airdrop model. The NFT does NOT route on-chain
//     trading fees automatically. Holders are eligible for
//     periodic airdrops run by the Odyssey team at their
//     discretion. Keeping airdrops off-chain leaves flexibility
//     to tune amounts/timing without upgrading the bonding-curve
//     package or making fee-stream commitments on-chain.
//   - Royalty enforcement via Sui's TransferPolicy + Kiosk rule
//     module. Royalty bps is a field on the policy, settable by
//     the cap holder post-publish, so we can tune it without a
//     republish.
//
// After publishing this package, Odyssey submits the type
//   `<pkg>::founder_nft::OdysseyFounderNFT`
// to TradePort's creator portal once. Every future mint auto-
// appears under the collection.
// ============================================================

module odyssey_founder_nft::founder_nft {
    use std::string::{Self, String};
    use sui::clock::{Self, Clock};
    use sui::display;
    use sui::event;
    use sui::package;
    use sui::table::{Self, Table};
    use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap};

    // ── Error codes ───────────────────────────────────────────
    const EEmptyString: u64 = 1;
    const EAlreadyMinted: u64 = 2;

    // ── One-time witness ──────────────────────────────────────
    // Must match the module name in uppercase.
    public struct FOUNDER_NFT has drop {}

    // ── The NFT itself ────────────────────────────────────────
    public struct OdysseyFounderNFT has key, store {
        id: UID,
        // Sui address assigned to this agent (matches agent.agentAddress
        // in the off-chain agents KV record). The fee-distribution cron
        // looks this up to find the agent.
        agent_id: address,
        // Bonding curve Pool<Token> object id. Lets any on-chain
        // observer follow the NFT back to the trading pool.
        pool_id: ID,
        // Display/metadata — editable only by admin at mint time.
        agent_name: String,
        agent_symbol: String,
        image_url: String,
        // When this NFT was minted, for sorting + UI.
        minted_at_ms: u64,
    }

    // ── Capabilities ──────────────────────────────────────────
    // Gates mint + transfer policy edits. Held by the Odyssey admin
    // wallet. Transferring this cap transfers minting authority.
    public struct AdminCap has key, store {
        id: UID,
    }

    // ── Registry ──────────────────────────────────────────────
    // Shared object enforcing one-NFT-per-pool. Defense-in-depth on
    // top of the AdminCap gate: even if the AdminCap key leaks, an
    // attacker can't mint a second Founder NFT for the same pool —
    // the on-chain assert blocks it.
    //
    // Also useful for off-chain lookups: anyone can query whether a
    // pool already has a Founder NFT (and which one) without
    // scanning every wallet's owned objects.
    public struct Registry has key {
        id: UID,
        // pool_id → founder_nft_id
        minted: Table<ID, ID>,
    }

    // ── Events ────────────────────────────────────────────────
    public struct FounderNFTMinted has copy, drop {
        nft_id: ID,
        agent_id: address,
        pool_id: ID,
        agent_name: String,
        agent_symbol: String,
        recipient: address,
        minted_at_ms: u64,
    }

    // ── Module init ───────────────────────────────────────────
    // Runs once at publish. Sets up Display, TransferPolicy, and
    // transfers the AdminCap + policy cap to the publisher.
    fun init(otw: FOUNDER_NFT, ctx: &mut TxContext) {
        let publisher = package::claim(otw, ctx);

        // Sui Display — wallets + marketplaces render NFTs from
        // this template. Fields in {braces} pull from the NFT's
        // own fields at render time, so updating an NFT's
        // image_url field would flow through to every marketplace
        // automatically.
        let mut display = display::new<OdysseyFounderNFT>(&publisher, ctx);
        display::add(
            &mut display,
            string::utf8(b"name"),
            string::utf8(b"Odyssey Founder \u{2014} {agent_name}"),
        );
        display::add(
            &mut display,
            string::utf8(b"description"),
            string::utf8(b"Commemorative NFT marking the original creator of the {agent_symbol} agent on Odyssey. Holders will be eligible for airdrops."),
        );
        display::add(
            &mut display,
            string::utf8(b"image_url"),
            string::utf8(b"{image_url}"),
        );
        display::add(
            &mut display,
            string::utf8(b"project_url"),
            string::utf8(b"https://theodyssey.fun/agents/{agent_id}"),
        );
        display::add(
            &mut display,
            string::utf8(b"creator"),
            string::utf8(b"Odyssey"),
        );
        display::update_version(&mut display);

        // Royalty enforcement: TransferPolicy is required for
        // royalty-aware listing on TradePort + Kiosk-based
        // marketplaces. We publish it empty; a royalty-rule can
        // be attached later by the TransferPolicyCap holder
        // without a republish (Sui ships a stock royalty rule
        // module that takes a bps and recipient address).
        let (policy, policy_cap) =
            transfer_policy::new<OdysseyFounderNFT>(&publisher, ctx);
        transfer::public_share_object(policy);

        let admin_cap = AdminCap { id: object::new(ctx) };

        // Shared registry — one mint per pool_id, forever.
        let registry = Registry {
            id: object::new(ctx),
            minted: table::new(ctx),
        };
        transfer::share_object(registry);

        let sender = tx_context::sender(ctx);
        transfer::public_transfer(publisher, sender);
        transfer::public_transfer(display, sender);
        transfer::public_transfer(policy_cap, sender);
        transfer::public_transfer(admin_cap, sender);
    }

    // ── Mint ──────────────────────────────────────────────────
    // Called once per agent at creation time. AdminCap-gated +
    // Registry-deduped: even if the AdminCap leaks, only one NFT
    // can ever exist per pool.
    public entry fun mint(
        _: &AdminCap,
        registry: &mut Registry,
        recipient: address,
        agent_id: address,
        pool_id: ID,
        agent_name: vector<u8>,
        agent_symbol: vector<u8>,
        image_url: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!agent_name.is_empty(), EEmptyString);
        assert!(!agent_symbol.is_empty(), EEmptyString);
        assert!(!table::contains(&registry.minted, pool_id), EAlreadyMinted);

        let minted_at_ms = clock::timestamp_ms(clock);
        let nft = OdysseyFounderNFT {
            id: object::new(ctx),
            agent_id,
            pool_id,
            agent_name: string::utf8(agent_name),
            agent_symbol: string::utf8(agent_symbol),
            image_url: string::utf8(image_url),
            minted_at_ms,
        };
        let nft_id = object::id(&nft);
        let agent_name_copy = nft.agent_name;
        let agent_symbol_copy = nft.agent_symbol;

        table::add(&mut registry.minted, pool_id, nft_id);

        event::emit(FounderNFTMinted {
            nft_id,
            agent_id,
            pool_id,
            agent_name: agent_name_copy,
            agent_symbol: agent_symbol_copy,
            recipient,
            minted_at_ms,
        });

        transfer::public_transfer(nft, recipient);
    }

    // ── Admin helpers ─────────────────────────────────────────
    // Updates the off-chain-stored avatar URL on an existing NFT.
    // Odyssey admin may occasionally need to refresh broken avatar
    // links (e.g., when an image host goes down). Holders keep
    // the NFT + revenue stream regardless; only the display pointer
    // changes. AdminCap-gated so holders can't self-rebrand.
    public entry fun update_image_url(
        _: &AdminCap,
        nft: &mut OdysseyFounderNFT,
        new_url: vector<u8>,
    ) {
        nft.image_url = string::utf8(new_url);
    }

    // ── View functions ────────────────────────────────────────
    public fun agent_id(nft: &OdysseyFounderNFT): address { nft.agent_id }
    public fun pool_id(nft: &OdysseyFounderNFT): ID { nft.pool_id }
    public fun agent_name(nft: &OdysseyFounderNFT): &String { &nft.agent_name }
    public fun agent_symbol(nft: &OdysseyFounderNFT): &String { &nft.agent_symbol }
    public fun image_url(nft: &OdysseyFounderNFT): &String { &nft.image_url }
    public fun minted_at_ms(nft: &OdysseyFounderNFT): u64 { nft.minted_at_ms }

    // Registry lookups for off-chain code.
    public fun is_minted(registry: &Registry, pool_id: ID): bool {
        table::contains(&registry.minted, pool_id)
    }

    public fun get_nft_id(registry: &Registry, pool_id: ID): ID {
        *table::borrow(&registry.minted, pool_id)
    }
}
