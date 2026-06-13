# 01 — Move Market Contracts: Justify on Sui

**Sui-native prediction markets: object-centric, resource-safe, bridgeable**

This document specifies the **Move package design** for Justify prediction markets on Sui. The package is a faithful re-expression of the EVM stack (`contracts/src/`) in Sui's object model: factory-deployed markets, constant-product AMM pricing, outcome positions as Coin types, capability-based access control, and explicit event emissions for bridge and indexer consumption. The design prioritizes **object-centric safety** (no reentrancy, resource conservation enforced by type system) and **bridge interop** (entry points the Wormhole adapter calls, events the MarketProxy consumes).

---

## 1. Package layout

The Move package is named **`justify_markets`** and organized into seven modules:

```
justify_markets/
├── sources/
│   ├── factory.move          // MarketRegistry + createMarket (analog: MarketFactory.sol)
│   ├── market.move           // Market shared object (analog: PredictionMarket.sol)
│   ├── amm.move              // CPMM pool, buy/sell (analog: MarketAMM.sol)
│   ├── outcome_coin.move     // YES/NO outcome coins (analog: OutcomeToken.sol ERC-1155)
│   ├── oracle_resolver.move  // Resolution logic (analog: OracleResolver.sol)
│   ├── fee_treasury.move     // Fee collection (analog: FeeTreasury.sol)
│   └── access.move           // Capability objects for roles (analog: AccessControl.sol)
├── Move.toml
└── tests/
    └── market_tests.move
```

**Module dependency tree:**

```
                      access
                        ↓
         ┌──────────────┴──────────────┐
         ↓                             ↓
    fee_treasury                  oracle_resolver
         ↓                             ↓
    outcome_coin                    market
         ↓                             ↓
        amm ←───────────────────────┘
         ↓
      factory
```

- `access` defines capability objects (`AdminCap`, `ResolverCap`, `FactoryCap`).
- `market` holds the market state machine (Open → Closed → Resolved).
- `outcome_coin` defines the `YES` and `NO` fungible outcome types.
- `amm` implements constant-product pricing and mints/burns outcome coins.
- `factory` deploys new markets and registers them in the shared `MarketRegistry`.
- `oracle_resolver` records resolution decisions and updates market state.
- `fee_treasury` collects trading fees (2% per trade, matching EVM 200 BPS).

---

## 2. Core objects and structs

### 2.1 `Market` — shared object

The `Market` is a **shared object** (`has key, has store`) representing one prediction market. It is the Sui analog to `PredictionMarket.sol`.

```move
module justify_markets::market {
    use sui::object::{Self, UID};
    use sui::coin::{Coin, Balance};
    use sui::balance::{Self, Balance};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;

    /// State machine: Open → Closed → Resolved
    struct MarketState has copy, drop, store {
        open: bool,
        closed: bool,
        resolved: bool,
    }

    /// The Market shared object (one per market).
    struct Market has key, store {
        id: UID,
        market_id: u64,              // Globally unique ID (factory counter)
        question: vector<u8>,        // Market question (UTF-8 encoded string)
        outcome_labels: vector<vector<u8>>, // ["YES", "NO"] or ["Barcelona", "Real Madrid"]
        close_time: u64,             // Unix timestamp; 0 = no fixed close
        state: MarketState,
        winning_outcome: u8,         // 0 or 1; set on resolution
        creator: address,
        oracle_proof_url: vector<u8>,// URL to oracle reference (UTF-8)

        // AMM pool state (embedded in Market for simplicity)
        collateral: Balance<USDC>,   // Locked collateral backing outcome shares
        reserves: vector<u64>,       // [YES reserve, NO reserve] in basis units
        fee_bps: u64,                // Fee in basis points (200 = 2%)

        // Outcome supply tracking
        yes_supply: u64,
        no_supply: u64,
    }

    /// Event: Market created
    struct MarketCreated has copy, drop {
        market_id: u64,
        question: vector<u8>,
        creator: address,
    }

    /// Event: Market closed (trading stops)
    struct MarketClosed has copy, drop {
        market_id: u64,
    }

    /// Event: Market resolved
    struct MarketResolved has copy, drop {
        market_id: u64,
        winning_outcome: u8,
        oracle_proof_url: vector<u8>,
    }
}
```

**Design notes:**

- **Shared object:** `Market` is shared (not owned) so any user can reference it in transactions without explicit transfers. The AMM pool state (`reserves`, `collateral`) lives directly in the `Market` struct, eliminating the separate `MarketAMM` contract from the EVM design — Sui's object model makes embedding more natural.
- **State machine:** `MarketState` mirrors `PredictionMarket.sol`'s `Open | Closed | Resolved` enum. The `state` field is checked in entry functions to gate trading after close or resolution.
- **Collateral as `Balance<USDC>`:** The locked collateral is a `Balance<USDC>` (Sui's native type for coin reserves). This is a **resource type** — the Move type system guarantees it cannot be double-spent or lost.
- **Outcome supplies:** `yes_supply` and `no_supply` track total minted outcome coins for accounting (analog: ERC-1155 `totalSupply` per token ID).

### 2.2 `MarketRegistry` — shared factory state

The `MarketRegistry` is a **shared object** tracking all created markets (analog: `MarketFactory.sol`'s `markets` mapping).

```move
module justify_markets::factory {
    use sui::object::{Self, UID};
    use sui::table::{Self, Table};
    use sui::tx_context::{Self, TxContext};

    struct MarketRegistry has key {
        id: UID,
        next_market_id: u64,             // Auto-increment counter
        markets: Table<u64, address>,    // market_id → Market object address
    }

    /// Event: Registry initialized
    struct RegistryCreated has copy, drop {
        registry_id: address,
    }
}
```

**Design notes:**

- **`Table<u64, address>`:** Sui's `Table` is an off-chain-indexable map (on-chain key-value store with lazy loading). It maps `market_id` to the `Market` object's address (Sui object IDs are addresses).
- **Singleton pattern:** One `MarketRegistry` is created at package publish time and shared. All markets register themselves in this table.

### 2.3 Outcome coins — `Coin<YES>` and `Coin<NO>`

Sui's idiomatic way to represent fungible assets is the **`Coin<T>` type** with a one-time witness (OTW). Each outcome is a distinct coin type.

```move
module justify_markets::outcome_coin {
    use sui::coin::{Self, Coin, TreasuryCap};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    /// One-time witness for YES outcome
    struct YES has drop {}

    /// One-time witness for NO outcome
    struct NO has drop {}

    /// Treasury capabilities (held by AMM module, never transferred)
    struct YesTreasury has key {
        id: UID,
        cap: TreasuryCap<YES>,
    }

    struct NoTreasury has key {
        id: UID,
        cap: TreasuryCap<NO>,
    }

    /// Initialize outcome coin types (called once at package publish)
    fun init(ctx: &mut TxContext) {
        // Create YES coin type with 6 decimals (matching USDC)
        let (yes_treasury_cap, yes_metadata) = coin::create_currency(
            YES {},
            6,
            b"YES",
            b"Justify YES Outcome",
            b"Conditional outcome token for YES",
            option::none(),
            ctx
        );

        // Create NO coin type
        let (no_treasury_cap, no_metadata) = coin::create_currency(
            NO {},
            6,
            b"NO",
            b"Justify NO Outcome",
            b"Conditional outcome token for NO",
            option::none(),
            ctx
        );

        // Share metadata objects for wallets/explorers
        transfer::public_freeze_object(yes_metadata);
        transfer::public_freeze_object(no_metadata);

        // Store treasury caps in shared objects (AMM module will access)
        transfer::share_object(YesTreasury {
            id: object::new(ctx),
            cap: yes_treasury_cap,
        });

        transfer::share_object(NoTreasury {
            id: object::new(ctx),
            cap: no_treasury_cap,
        });
    }

    /// Mint YES coins (called by AMM on buy)
    public fun mint_yes(
        treasury: &mut YesTreasury,
        amount: u64,
        ctx: &mut TxContext
    ): Coin<YES> {
        coin::mint(&mut treasury.cap, amount, ctx)
    }

    /// Mint NO coins
    public fun mint_no(
        treasury: &mut NoTreasury,
        amount: u64,
        ctx: &mut TxContext
    ): Coin<NO> {
        coin::mint(&mut treasury.cap, amount, ctx)
    }

    /// Burn YES coins (on redemption after resolution)
    public fun burn_yes(
        treasury: &mut YesTreasury,
        coin: Coin<YES>
    ) {
        coin::burn(&mut treasury.cap, coin);
    }

    /// Burn NO coins
    public fun burn_no(
        treasury: &mut NoTreasury,
        coin: Coin<NO>
    ) {
        coin::burn(&mut treasury.cap, coin);
    }
}
```

**Design rationale:**

- **Why `Coin<YES>` / `Coin<NO>` instead of `OutcomePosition` owned object?** Sui's `Coin` type is the standard for fungible assets. It integrates natively with wallets (Sui Wallet, Martian), DEX protocols (Cetus, Turbos), and indexers. An `OutcomePosition` owned object would require custom wallet support and transfer logic.
- **One-time witness (OTW):** The `YES` and `NO` structs with `has drop` ability are OTWs — they can be constructed exactly once (at module init) to create unique coin types. This prevents anyone else from minting counterfeit YES/NO coins.
- **Treasury capabilities:** The `TreasuryCap<YES>` and `TreasuryCap<NO>` are held in **shared objects** (`YesTreasury`, `NoTreasury`) that the AMM module accesses via `&mut` references. This is the Move analog to granting `MINTER_ROLE` to `MarketAMM` in the EVM stack.

**Trade-off acknowledged:** `Coin<YES>` is a **global type** (one YES type for ALL markets). To distinguish YES shares from market #1 vs market #2, the system must rely on:

1. **AMM invariant:** The AMM only mints YES for a specific market and burns it on redemption from that same market.
2. **Indexer mapping:** The off-chain indexer tracks which `Coin<YES>` issuances correspond to which market via event emissions.

An alternative design is **per-market coin types** (e.g. `Coin<Market42_YES>` via dynamic OTW generation). This is more complex but type-safe. For the MVP, the global YES/NO types with off-chain indexing match the EVM ERC-1155 approach where token IDs encode market + outcome.

### 2.4 AMM pool state (embedded in `Market`)

In the EVM stack, `MarketAMM.sol` is a separate contract. In Sui, the AMM state lives **inside the `Market` shared object** to minimize object proliferation. The key fields:

```move
// Inside Market struct
collateral: Balance<USDC>,   // Locked collateral (6-decimal units)
reserves: vector<u64>,       // [YES reserve, NO reserve]
fee_bps: u64,                // 200 basis points (2%)
yes_supply: u64,             // Total YES coins minted for this market
no_supply: u64,              // Total NO coins minted for this market
```

The AMM module (`justify_markets::amm`) contains the entry functions that mutate these fields.

### 2.5 Capability objects for access control

Move's **capability pattern** replaces Solidity's role-based `AccessControl.sol`. A capability is an owned object that grants its holder the right to perform privileged operations.

```move
module justify_markets::access {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    /// Admin capability (held by deployer/protocol owner)
    struct AdminCap has key, store {
        id: UID,
    }

    /// Resolver capability (held by oracle service)
    struct ResolverCap has key, store {
        id: UID,
    }

    /// Factory capability (held by factory module)
    struct FactoryCap has key, store {
        id: UID,
    }

    /// Initialize capabilities (called once at package publish)
    fun init(ctx: &mut TxContext) {
        // Mint and transfer AdminCap to deployer
        transfer::transfer(AdminCap {
            id: object::new(ctx),
        }, tx_context::sender(ctx));

        // Mint ResolverCap and transfer to deployer (can be delegated)
        transfer::transfer(ResolverCap {
            id: object::new(ctx),
        }, tx_context::sender(ctx));

        // Mint FactoryCap and share it (factory module holds &mut reference)
        transfer::share_object(FactoryCap {
            id: object::new(ctx),
        });
    }

    /// Transfer AdminCap to a new admin (only holder can call)
    public entry fun transfer_admin_cap(
        cap: AdminCap,
        new_admin: address
    ) {
        transfer::transfer(cap, new_admin);
    }

    /// Transfer ResolverCap to oracle service
    public entry fun transfer_resolver_cap(
        cap: ResolverCap,
        oracle: address
    ) {
        transfer::transfer(cap, oracle);
    }
}
```

**Design notes:**

- **No role mappings:** Unlike Solidity's `mapping(bytes32 => mapping(address => bool))`, Move capabilities are **objects**. To check if a caller has admin rights, the function signature requires `admin_cap: &AdminCap` as a parameter — no on-chain lookup.
- **Transfer semantics:** Capabilities with `has store` can be transferred peer-to-peer via `transfer::transfer`. This is the Move equivalent of `grantRole` / `revokeRole`.
- **FactoryCap as shared object:** The `FactoryCap` is shared (not owned) so the factory module can reference it in `create_market` calls without explicit transfers. This is an ergonomic trade-off — a fully permission-less factory would not need a capability at all, but the cap pattern allows future gating (e.g. allowlists for market creation).

---

## 3. Key entry functions

Entry functions are `public entry fun` — callable from transactions, analogous to Solidity's `external` functions.

### 3.1 `create_market` (factory module)

```move
module justify_markets::factory {
    use justify_markets::market::{Self, Market};
    use justify_markets::access::FactoryCap;
    use sui::tx_context::{Self, TxContext};

    /// Create a new prediction market.
    /// Requires FactoryCap (gating future: e.g., allowlist checks).
    public entry fun create_market(
        registry: &mut MarketRegistry,
        _factory_cap: &FactoryCap,  // Proves caller is authorized
        question: vector<u8>,
        outcome_labels: vector<vector<u8>>,
        close_time: u64,
        oracle_proof_url: vector<u8>,
        ctx: &mut TxContext
    ) {
        let market_id = registry.next_market_id;
        registry.next_market_id = market_id + 1;

        let market = market::new(
            market_id,
            question,
            outcome_labels,
            close_time,
            tx_context::sender(ctx),
            oracle_proof_url,
            ctx
        );

        let market_address = object::id_address(&market);
        table::add(&mut registry.markets, market_id, market_address);

        // Share the Market object (makes it accessible to all users)
        transfer::share_object(market);

        // Emit event
        event::emit(market::MarketCreated {
            market_id,
            question,
            creator: tx_context::sender(ctx),
        });
    }
}
```

**Analog:** `MarketFactory.createMarket()` in Solidity. The key difference: no separate `MarketAMM` contract deployment — the AMM state is embedded in the `Market` object.

### 3.2 `buy` (AMM module)

```move
module justify_markets::amm {
    use justify_markets::market::{Self, Market};
    use justify_markets::outcome_coin::{Self, YES, NO, YesTreasury, NoTreasury};
    use sui::coin::{Self, Coin};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;

    /// Buy outcome shares via constant-product AMM.
    /// Mirrors MarketAMM.sol::buy logic.
    public entry fun buy(
        market: &mut Market,
        yes_treasury: &mut YesTreasury,
        no_treasury: &mut NoTreasury,
        collateral_in: Coin<USDC>,
        outcome_index: u8,  // 0 = YES, 1 = NO
        min_shares_out: u64,
        ctx: &mut TxContext
    ) {
        // 1. Check market state (must be Open)
        assert!(market.state.open && !market.state.closed, EMarketClosed);

        // 2. Deduct fee (200 bps = 2%)
        let collateral_amount = coin::value(&collateral_in);
        let fee = (collateral_amount * market.fee_bps) / 10_000;
        let net_collateral = collateral_amount - fee;

        // 3. CPMM swap (same logic as MarketAMM.sol)
        let reserves = &market.reserves;
        let other_index = 1 - outcome_index;
        let k = (*vector::borrow(reserves, 0) * *vector::borrow(reserves, 1));

        let new_other_reserve = *vector::borrow(reserves, other_index as u64) + net_collateral;
        let new_chosen_reserve = k / new_other_reserve;
        let shares_out = *vector::borrow(reserves, outcome_index as u64) - new_chosen_reserve;

        // 4. Slippage check
        assert!(shares_out >= min_shares_out, ESlippageExceeded);

        // 5. Update reserves
        *vector::borrow_mut(&mut market.reserves, outcome_index as u64) = new_chosen_reserve;
        *vector::borrow_mut(&mut market.reserves, other_index as u64) = new_other_reserve;

        // 6. Transfer fee to treasury (simplified: burn for MVP)
        let fee_coin = coin::split(&mut collateral_in, fee, ctx);
        transfer::public_transfer(fee_coin, fee_treasury_address());

        // 7. Lock remaining collateral in market
        balance::join(&mut market.collateral, coin::into_balance(collateral_in));

        // 8. Mint outcome coins to buyer
        let outcome_coin = if (outcome_index == 0) {
            market.yes_supply = market.yes_supply + shares_out;
            coin::from_balance(outcome_coin::mint_yes(yes_treasury, shares_out, ctx), ctx)
        } else {
            market.no_supply = market.no_supply + shares_out;
            coin::from_balance(outcome_coin::mint_no(no_treasury, shares_out, ctx), ctx)
        };

        transfer::public_transfer(outcome_coin, tx_context::sender(ctx));

        // 9. Emit event
        event::emit(TradeExecuted {
            market_id: market.market_id,
            trader: tx_context::sender(ctx),
            outcome_index,
            collateral_in: collateral_amount,
            shares_out,
            fee,
        });
    }

    /// Event: Trade executed
    struct TradeExecuted has copy, drop {
        market_id: u64,
        trader: address,
        outcome_index: u8,
        collateral_in: u64,
        shares_out: u64,
        fee: u64,
    }

    const EMarketClosed: u64 = 1;
    const ESlippageExceeded: u64 = 2;
}
```

**Analog:** `MarketAMM.buy()` in Solidity. The Move version uses Sui's `Balance` and `Coin` APIs instead of ERC-20 `safeTransferFrom`. The CPMM math (`k = reserves[0] * reserves[1]`) is identical to the Solidity implementation.

### 3.3 `sell` (AMM module)

```move
public entry fun sell(
    market: &mut Market,
    yes_treasury: &mut YesTreasury,
    no_treasury: &mut NoTreasury,
    outcome_coin: Coin<YES>, // or Coin<NO>, depending on outcome_index
    outcome_index: u8,
    min_collateral_out: u64,
    ctx: &mut TxContext
) {
    // 1. Check market state
    assert!(market.state.open && !market.state.closed, EMarketClosed);

    let shares_in = coin::value(&outcome_coin);

    // 2. CPMM reverse swap (shares → collateral)
    // (Logic mirrors buy in reverse; omitted for brevity)
    let collateral_out = /* compute via reserves */;
    assert!(collateral_out >= min_collateral_out, ESlippageExceeded);

    // 3. Burn outcome coins
    if (outcome_index == 0) {
        outcome_coin::burn_yes(yes_treasury, outcome_coin);
        market.yes_supply = market.yes_supply - shares_in;
    } else {
        outcome_coin::burn_no(no_treasury, outcome_coin);
        market.no_supply = market.no_supply - shares_in;
    };

    // 4. Release collateral to seller
    let payout = coin::take(&mut market.collateral, collateral_out, ctx);
    transfer::public_transfer(payout, tx_context::sender(ctx));

    // Emit event...
}
```

**Note:** Sell flow is **deferred to post-MVP** in the EVM stack (functional-requirements.md §15 item 4). The Move design includes it for completeness, but it may not be exercised in the initial Sui deployment.

### 3.4 `resolve` (oracle resolver module)

```move
module justify_markets::oracle_resolver {
    use justify_markets::market::{Self, Market};
    use justify_markets::access::ResolverCap;
    use sui::tx_context::{Self, TxContext};

    /// Resolve a market (close trading, set winning outcome).
    /// Requires ResolverCap (oracle authority).
    public entry fun resolve(
        market: &mut Market,
        _resolver_cap: &ResolverCap,  // Proves caller is authorized oracle
        winning_outcome: u8,
        ctx: &mut TxContext
    ) {
        // 1. Check market is Closed (must close before resolving)
        assert!(market.state.closed && !market.state.resolved, EInvalidState);

        // 2. Validate outcome index (0 or 1)
        assert!(winning_outcome <= 1, EInvalidOutcome);

        // 3. Update market state
        market.state.resolved = true;
        market.winning_outcome = winning_outcome;

        // 4. Emit resolution event
        event::emit(market::MarketResolved {
            market_id: market.market_id,
            winning_outcome,
            oracle_proof_url: market.oracle_proof_url,
        });
    }

    const EInvalidState: u64 = 10;
    const EInvalidOutcome: u64 = 11;
}
```

**Analog:** `OracleResolver.resolve()` in Solidity. The Move version gates the call with `ResolverCap` instead of checking `acl.hasRole(RESOLVER_ROLE, msg.sender)`.

### 3.5 `redeem` (AMM module)

```move
public entry fun redeem(
    market: &mut Market,
    yes_treasury: &mut YesTreasury,
    no_treasury: &mut NoTreasury,
    outcome_coin: Coin<YES>, // or Coin<NO>
    outcome_index: u8,
    ctx: &mut TxContext
) {
    // 1. Check market is Resolved
    assert!(market.state.resolved, ENotResolved);

    let shares = coin::value(&outcome_coin);

    // 2. Burn outcome coins
    if (outcome_index == 0) {
        outcome_coin::burn_yes(yes_treasury, outcome_coin);
        market.yes_supply = market.yes_supply - shares;
    } else {
        outcome_coin::burn_no(no_treasury, outcome_coin);
        market.no_supply = market.no_supply - shares;
    };

    // 3. Payout: 1:1 if winning, 0 if losing
    let payout_amount = if (outcome_index == market.winning_outcome) {
        shares  // Each winning share redeems for 1 collateral unit
    } else {
        0
    };

    if (payout_amount > 0) {
        let payout = coin::take(&mut market.collateral, payout_amount, ctx);
        transfer::public_transfer(payout, tx_context::sender(ctx));
    };

    // Emit event
    event::emit(Redeemed {
        market_id: market.market_id,
        trader: tx_context::sender(ctx),
        outcome_index,
        shares_redeemed: shares,
        payout: payout_amount,
    });
}

struct Redeemed has copy, drop {
    market_id: u64,
    trader: address,
    outcome_index: u8,
    shares_redeemed: u64,
    payout: u64,
}

const ENotResolved: u64 = 3;
```

**Analog:** The redemption logic from `MarketAMM` / `OutcomeToken` after resolution. In Sui, the user passes their `Coin<YES>` or `Coin<NO>` object to the `redeem` function, which burns it and releases collateral.

---

## 4. AMM math — constant product and fee routing

The AMM uses the **same constant-product formula** as `MarketAMM.sol`:

### 4.1 Invariant

```
k = reserves[YES] * reserves[NO]
```

On each buy:

1. **Fee deduction:** `fee = collateral_in * fee_bps / 10_000` (200 bps = 2%)
2. **Net collateral:** `net = collateral_in - fee`
3. **Reserves update:**
   - `reserves[other] += net`
   - `reserves[chosen] = k / reserves[other]` (preserves `k`)
4. **Shares out:** `shares_out = old_reserves[chosen] - new_reserves[chosen]`

### 4.2 Implied probability

The price of YES is:

```
price_yes = reserves[NO] / (reserves[YES] + reserves[NO])
```

Displayed in the UI as **cents** (basis points * 100). Example: if `reserves[YES] = 600` and `reserves[NO] = 400`, then `price_yes = 400 / 1000 = 0.40 = 40¢`.

### 4.3 Fee routing

Fees are transferred to a **fee treasury address** (held by `AdminCap` holder). In the MVP, the fee is sent immediately on each trade:

```move
let fee_coin = coin::split(&mut collateral_in, fee, ctx);
transfer::public_transfer(fee_coin, FEE_TREASURY_ADDRESS);
```

**Known gap:** The EVM stack has a `FeeTreasury` contract with withdrawal gating. The Move version simplifies this to a direct transfer. A production version would use a shared `FeeTreasury` object with `AdminCap`-gated withdrawals, mirroring the Solidity design.

### 4.4 Collateral conservation invariant

At all times:

```
market.collateral.value()
  == (market.yes_supply + market.no_supply) - redeemed_shares
```

This is enforced by Move's resource type system: the `Balance<USDC>` inside `market.collateral` cannot be created or destroyed except via `coin::take` (on redemption) and `coin::join` (on buy). No reentrancy or external call can violate this.

---

## 5. Move-specific safety wins

### 5.1 Resource types prevent double-spend

`Balance<USDC>` and `Coin<YES>` are **resource types** (the Move VM tracks them via linear logic). A `Coin<YES>` object cannot be:

- **Copied** (no `has copy` ability) — prevents double-spend of outcome shares.
- **Dropped** (no implicit `has drop`) — the compiler errors if a coin is not consumed (transferred, burned, or merged). This eliminates accidental loss of value.

**Contrast with Solidity:** ERC-1155 balances are `uint256` in a mapping — a malicious or buggy contract can overwrite them. In Move, the type system enforces conservation.

### 5.2 No reentrancy

Sui does not have reentrant calls (no `call` opcode). External contract calls are sequenced via **object references** (`&mut Market`) — the VM prevents two transactions from mutating the same shared object concurrently.

**Result:** The `buy` function in Solidity requires `nonReentrant` modifier from OpenZeppelin. The Move version needs no such guard — reentrancy is architecturally impossible.

### 5.3 Explicit object ownership

Every object has an **owner**:

- **Owned objects** (e.g., `AdminCap`) can only be used by their owner's transactions.
- **Shared objects** (e.g., `Market`, `MarketRegistry`) can be accessed by anyone but are locked during mutation (`&mut` reference).

**Result:** Access control is **type-enforced**. To call `resolve`, you must pass `&ResolverCap` — the Move VM checks at transaction-signing time that you own a `ResolverCap` object. No runtime `require(acl.hasRole(...))` needed.

### 5.4 Events via `event::emit`

Sui events are emitted via `sui::event::emit` and indexed off-chain by the Sui indexer (GraphQL or JSON-RPC subscription). The events are **type-safe** (structs with `copy + drop` abilities) and guaranteed to match the emitted data.

```move
event::emit(TradeExecuted {
    market_id: market.market_id,
    trader: tx_context::sender(ctx),
    outcome_index,
    collateral_in,
    shares_out,
    fee,
});
```

**Analog:** Solidity `emit Trade(...)` events. The key difference: Sui events include the transaction digest and timestamp in the indexer's event stream, simplifying off-chain reconciliation (no need to parse block logs).

---

## 6. What the bridge needs from these contracts

The Wormhole adapter (see [documentation_sui/03-wormhole-adapter-and-interop.md](./03-wormhole-adapter-and-interop.md)) requires these entry points and events:

### 6.1 Entry points for cross-chain operations

These functions are called by the **Wormhole relayer** or **MarketProxy** via Sui programmable transactions:

| Entry point | Purpose | Caller |
|-------------|---------|--------|
| `amm::buy_on_behalf` | Execute a buy for a remote trader (EVM user via MarketProxy) | Wormhole adapter contract on Sui |
| `amm::credit_position` | Mint outcome coins to a remote user's Sui address (after EVM buy settled) | Wormhole adapter |
| `market::mark_resolved` | Update market state when resolution is bridged from EVM home chain | Wormhole adapter + ResolverCap |

**Not yet designed:** `buy_on_behalf` and `credit_position` are bridge-specific entry points. The MVP may skip them if the bridge design uses **wrapped receipts** (ERC-20 on EVM, no native Sui outcome coins until redemption). See [documentation_bridge/03-marketproxy-and-home-market.md](../documentation_bridge/03-marketproxy-and-home-market.md) for the wrapping model.

### 6.2 Events for the bridge and off-chain indexer

The bridge consumes these events to trigger cross-chain actions:

| Event | Emitted by | Consumed by |
|-------|-----------|-------------|
| `TradeExecuted` | `amm::buy` / `amm::sell` | Bridge adapter (to send FillConfirmation to EVM proxy) |
| `MarketResolved` | `oracle_resolver::resolve` | Bridge adapter (to broadcast resolution to all EVM proxies) |
| `Redeemed` | `amm::redeem` | Indexer (portfolio service updates unrealized P&L) |
| `MarketCreated` | `factory::create_market` | Indexer (market registry for UI) |

**Event payloads must match the bridge's message schemas.** Example: `TradeExecuted` includes:

- `market_id` (maps to EVM `homeMarketId`)
- `trader` (maps to EVM proxy user address)
- `outcome_index` (0/1 for YES/NO)
- `shares_out` (minted shares, used by proxy to mint wrapped receipt)

### 6.3 Sui-to-EVM price feed

The AMM's `implied_probability_bps` view function (added to `amm` module) returns the current YES price in basis points:

```move
public fun implied_probability_bps(market: &Market, outcome_index: u8): u64 {
    let total = *vector::borrow(&market.reserves, 0) + *vector::borrow(&market.reserves, 1);
    if (total == 0) { return 0 };
    let other_index = 1 - outcome_index;
    (*vector::borrow(&market.reserves, other_index as u64) * 10_000) / total
}
```

The EVM `MarketProxy` can call this (via Wormhole attestation) to display the home-chain price before a remote user submits a buy intent.

---

## 7. Comparison with EVM stack

| Aspect | EVM (Solidity) | Sui (Move) |
|--------|----------------|------------|
| **Market state** | `PredictionMarket` contract | `Market` shared object |
| **AMM pool** | Separate `MarketAMM` contract | Embedded in `Market` struct |
| **Outcome shares** | ERC-1155 token IDs (`marketId << 1 | outcome`) | `Coin<YES>` / `Coin<NO>` global types |
| **Access control** | `AccessControl` role mappings | Capability objects (`AdminCap`, `ResolverCap`) |
| **Fee treasury** | `FeeTreasury` contract with withdrawal gating | Direct transfer to admin address (MVP simplification) |
| **Reentrancy** | `nonReentrant` modifier (OpenZeppelin) | Architecturally impossible (no reentrant calls) |
| **Collateral conservation** | Manual accounting + SafeERC20 | Type system enforced (`Balance<USDC>` is a resource) |
| **Event indexing** | Ethereum logs via `eth_getLogs` | Sui indexer GraphQL / JSON-RPC subscriptions |

**Design fidelity:** The Move package faithfully reproduces the EVM stack's **behavior** (CPMM pricing, outcome shares, resolution state machine) while adapting to Sui's **object model** (shared objects, capabilities, resource types). Function names (e.g., `buy`, `resolve`, `redeem`) match the Solidity originals where semantics align.

---

## 8. Open questions and confirmations needed

| Question | Status | Notes |
|----------|--------|-------|
| **Sui framework version** | Unconfirmed | This design assumes Sui Move framework version 2024 or later (with `sui::coin`, `sui::balance`, `sui::event` modules). Confirm against deployed mainnet version. |
| **`Coin<YES>` global scope** | Design decision | Global YES/NO types (one per package) vs per-market coin types (e.g., `Coin<Market42_YES>` via dynamic witness). Global is simpler; per-market is type-safer. MVP uses global. |
| **Fee treasury** | Simplified | EVM has `FeeTreasury` contract with `TREASURY_ROLE` withdrawal gating. Move version transfers fees directly to admin address on each trade. Production may add a shared `FeeTreasury` object. |
| **Bridge entry points** | Deferred | `buy_on_behalf` and `credit_position` are forward-declared for Wormhole adapter. Design depends on wrapped-receipt vs native-coin bridge model (see doc 02). |
| **USDC on Sui** | External dependency | The package assumes `USDC` is a `Coin<USDC>` type deployed on Sui (likely via Wormhole-wrapped USDC or Circle native USDC when available). Address TBD. |

---

## 9. Forward links

- **[00-sui-polymarkets-overview.md](./00-sui-polymarkets-overview.md)** — Why Sui; the object-centric prediction-market model.
- **[02-sui-bridge-overview.md](./02-sui-bridge-overview.md)** — The Sui bridge: home/proxy model on Sui, Chainlink-CCIP-inspired layering, Wormhole transport.
- **[03-wormhole-adapter-and-interop.md](./03-wormhole-adapter-and-interop.md)** — The Wormhole adapter (Move + EVM sides), VAAs, Sui↔EVM message flow.
- **[04-sui-bridge-security.md](./04-sui-bridge-security.md)** — Security & risk; Wormhole Guardians vs Chainlink RMN; exposure caps, circuit breaker.
- **[contracts/src/](../contracts/src/)** — The EVM Solidity contracts this Move package mirrors in behavior.

---

**END OF DOCUMENT**

This Move package design ensures that Justify markets on Sui achieve **object-centric safety** (resource types, no reentrancy, capability-enforced access control), **functional parity** with the EVM stack (CPMM pricing, outcome shares, resolution state machine), and **bridge readiness** (entry points and events the Wormhole adapter consumes). The package is a faithful re-expression of the EVM contracts in Sui's programming model, designed for a Sui-native deployment that bridges to the EVM home/proxy network.
