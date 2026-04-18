module moonbags_aida::curves {
    use moonbags_aida::utils::{as_u64,sub,from_u64,div,mul,add};

    // Calculate the amount of Token A needed to obtain an exact amount of Token B
    public fun calculate_add_liquidity_cost(reserves_token_a: u64, reserves_token_b: u64, amount_token_b_out: u64) : u64 {
        let remaining_reserves_b = as_u64(sub(from_u64(reserves_token_b), from_u64(amount_token_b_out)));
        assert!(remaining_reserves_b > 0, 100);
        as_u64(sub(from_u64(as_u64(div(mul(from_u64(reserves_token_a), from_u64(reserves_token_b)), from_u64(remaining_reserves_b)))), from_u64(reserves_token_a)))
    }

    // Calculate the amount of Token B received for providing a certain amount of Token A
    public fun calculate_remove_liquidity_return(reserves_token_a: u64, reserves_token_b: u64, amount_token_a_in: u64) : u64 {
        as_u64(sub(from_u64(reserves_token_b), from_u64(as_u64(div(mul(from_u64(reserves_token_b), from_u64(reserves_token_a)), from_u64(as_u64(add(from_u64(reserves_token_a), from_u64(amount_token_a_in)))))))))
    }

    public fun calculate_token_amount_received(reserves_token_a: u64, reserves_token_b: u64, amount_token_a_in: u64) : u64 {
        as_u64(sub(from_u64(reserves_token_b), from_u64(as_u64(div(mul(from_u64(reserves_token_a), from_u64(reserves_token_b)), from_u64(as_u64(add(from_u64(reserves_token_a), from_u64(amount_token_a_in)))))))))
    }
}

