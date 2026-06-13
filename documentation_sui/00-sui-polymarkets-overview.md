# Sui-based PolyMarkets — Overview

**Justify prediction markets on Sui: the object-centric, Move-native implementation**

**Version:** 1.0 (design phase)

**Date:** 2026-06-13

**Status:** Designed, not implemented. This is a forward-looking project separate from
the EVM work. Where the EVM line (Arc, Base, Ethereum, Polygon, BSC) treats chain as a
deployment parameter within the Solidity/EVM family, this project extends the
"multi-chain protocol" thesis past EVM boundaries by reimplementing the same
prediction-market product natively on **Sui** in **Move**.

---

## 1. Why Sui for prediction markets

Sui is a non-EVM, object-centric blockchain purpose-built for high-throughput,
low-latency applications. Its design delivers five structural advantages for Justify's
social prediction-market product:

| Sui feature                             | Benefit for prediction markets                                                                                                                                                                                                     |
|-----------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Object-centric model**                | Markets, positions, and AMM pools are first-class *objects* with explicit ownership (owned vs shared). A user's position is an owned object in their address; the AMM pool is a shared object multiple traders interact with. No global storage scans. |
| **Parallel execution**                  | Sui's transaction ordering is object-based, not account-based. Independent trades on different markets (or even different outcomes of the same market) can execute in parallel — no sequential bottleneck.                        |
| **Move safety**                         | Move's *resource types* enforce linear ownership (no double-spend or accidental duplication of positions), and the lack of reentrancy as a language primitive eliminates an entire class of AMM exploits.                        |
| **Low fees**                            | Sui's gas model is 10-100x cheaper than Ethereum mainnet; retail prediction-market trades (often $1-$50) become economically viable.                                                                                              |
| **Sponsored transactions**              | A creator or the protocol can sponsor gas for new users, so a first-time trader pays zero fees — critical for social-consumer onboarding from Web2 audiences.                                                                     |
| **Native USDC on Sui**                  | Circle's USDC is native on Sui (confirm on Sui docs for exact object/coin type). Markets denominated in USDC align with the same stablecoin-collateral model as the EVM stack.                                                   |

### 1.1 The object-centric thesis

Traditional EVM contracts store state in account-scoped storage slots; reading a user's
positions requires iterating events or maintaining off-chain indexes. Sui's object model
inverts this: a position is an **owned object** directly held by the user's address. The
chain itself is the index.

For Justify, this means:

- **Portfolio queries are object lookups.** "Show me Alice's positions" is an owned-object
  scan on Alice's address, not a log replay.
- **Parallel trades scale naturally.** Bob buying YES and Carol buying NO on the same
  market can execute concurrently if the Move module design allows per-outcome escrow.
- **Social objects are composable.** A market object can be *dynamically fields* of a
  creator's profile object, making the social graph and the trading graph one unified
  on-chain structure (though Justify's MVP keeps the social layer off-chain for
  cost/latency — Sui makes the on-chain social option viable later).

---

## 2. The object model mapping: EVM contracts → Sui objects

The EVM Justify stack (see `contracts/src/`) is a set of Solidity contracts, each with
its own storage. Sui replaces "contract with storage" with "Move module + objects." The
table below maps the EVM design to the Sui equivalent.

### 2.1 EVM → Sui contract equivalence

| EVM component          | Sui / Move equivalent                                                                                                                                                  | Key differences                                                                                                                                                                   |
|------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **MarketFactory.sol**  | Move module `market_factory` + a singleton shared object `FactoryRegistry`                                                                                             | EVM: factory is a contract with a `markets` mapping. Sui: registry is a shared object; `create_market()` is a public entry function that mints a new `Market` shared object.    |
| **PredictionMarket.sol** | Shared object `Market` with fields: `id`, `question`, `outcome_labels`, `close_time`, `state`, `winning_outcome`, `creator`, `oracle_proof_url`                        | EVM: contract per market. Sui: object per market. State machine (Open/Closed/Resolved) is an enum in the object's `state` field.                                                |
| **MarketAMM.sol**      | Shared object `AMMPool` holding two `Balance<USDC>` reserves for YES/NO, paired 1:1 with a `Market` object                                                            | EVM: separate contract with its own storage. Sui: the pool is a shared object; `buy()` is a public entry function in the `amm` module that mutates the pool's reserves.         |
| **OutcomeToken.sol**   | `Coin<OUTCOME_YES>` and `Coin<OUTCOME_NO>` — Sui's native `Coin<T>` type with custom witness types per market outcome                                                 | EVM: ERC-1155 with tokenId encoding market+outcome. Sui: each market's YES/NO outcomes are distinct `Coin<T>` types (or a single `Coin<OUTCOME>` with dynamic fields per market). |
| **OracleResolver.sol** | Move module `oracle_resolver` + a shared `ResolverRegistry` object granting resolution capability to authorized resolvers                                              | EVM: contract with role-based access. Sui: capability object pattern — a `ResolverCap` is an owned object held by the resolver; presenting it authorizes `resolve()` calls.      |
| **FeeTreasury.sol**    | Shared object `FeeTreasury` holding accumulated `Balance<USDC>` from AMM fees; withdrawal gated by a `TreasuryCap` capability                                          | EVM: contract with role-guarded `withdraw()`. Sui: capability pattern + shared treasury object.                                                                                  |
| **AccessControl.sol**  | Sui capability objects: `AdminCap`, `ResolverCap`, `TreasuryCap` — owned objects that grant authority                                                                 | EVM: role-based access control via OpenZeppelin. Sui: capability-based; transferring the `AdminCap` object transfers admin authority — no role registry.                         |
| **MockUSDC.sol**       | Native Circle USDC on Sui (or a testnet `Coin<MOCK_USDC>` for devnet)                                                                                                 | EVM: ERC-20 contract. Sui: `Coin<T>` is a first-class primitive.                                                                                                                 |

### 2.2 Object-centric vs account/storage model (comparison)

| Aspect                   | EVM (Solidity)                                                                                                          | Sui (Move)                                                                                                                                                |
|--------------------------|-------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| **State location**       | Contract storage (mappings, arrays, structs in contract slots)                                                          | Objects (owned, shared, or immutable) held by addresses or accessible globally by object ID                                                               |
| **Market representation** | `PredictionMarket` contract deployed once per market at a unique address; state in that contract's storage              | `Market` shared object created once per market; state in the object's fields; object ID is the market identifier                                         |
| **Position representation** | ERC-1155 token balance in `OutcomeToken` contract's mapping: `balances[user][tokenId]`                                 | Owned `Coin<OUTCOME>` object held directly in the user's address; the chain tracks ownership                                                             |
| **AMM pool reserves**    | `uint256[2] public reserves` in `MarketAMM.sol` storage                                                                 | `Balance<USDC>` fields in the `AMMPool` shared object; mutated by `buy()` / `sell()` transactions                                                        |
| **Access control**       | Role-based: `AccessControl` contract with `hasRole(role, account)` checks                                               | Capability-based: presenting an owned `ResolverCap` object in a transaction proves authority; no global role registry                                    |
| **Reentrancy risk**      | Explicit guard (`ReentrancyGuard` modifier) required; external calls can reenter                                        | Move does not allow reentrancy by design (no external calls during mutable borrows); resource types prevent duplication                                  |
| **Portfolio query**      | Off-chain: scan `Transfer` events or index into Postgres. On-chain: iterate all markets and check `balanceOf(user, id)` | On-chain: query owned objects at the user's address filtered by type `Coin<OUTCOME>` — the chain is the index                                            |
| **Parallel execution**   | Sequential per block (EVM is single-threaded); independent transactions still ordered by nonce                          | Parallel: if two trades touch disjoint objects (different markets or different outcome coins), Sui schedules them concurrently                           |
| **Upgrade model**        | Proxy pattern (e.g., UUPS) or immutable contracts requiring redeployment                                                | Move packages can be upgraded if published with upgrade capability; objects remain live, module logic is replaced                                        |

---

## 3. Product parity matrix: EVM stack → Sui Move modules

Every feature the EVM contracts provide must have a Sui equivalent. This table defines
the functional mapping.

| EVM contract function                          | Sui Move equivalent                                                                                                                                     | Notes / differences                                                                                                                                                                  |
|------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **MarketFactory.createMarket()**               | `market_factory::create_market(registry: &mut FactoryRegistry, question, ...): Market`                                                                 | EVM: returns marketId. Sui: returns (or transfers to caller) a new `Market` shared object. The factory registry records the object ID.                                              |
| **MarketAMM.seed()**                           | `amm::seed_pool(pool: &mut AMMPool, seed_coin: Coin<USDC>, yes_amount, no_amount)`                                                                     | EVM: transfers collateral from caller. Sui: caller passes a `Coin<USDC>` object; the function splits it and deposits into the pool's `Balance<USDC>` reserves.                      |
| **MarketAMM.buy(outcomeIndex, collateralIn)**  | `amm::buy(pool: &mut AMMPool, market: &Market, collateral_in: Coin<USDC>, outcome_index, min_shares_out): Coin<OUTCOME>`                              | EVM: transfers ERC-20, mints ERC-1155. Sui: consumes input `Coin<USDC>`, mints and returns `Coin<OUTCOME_YES>` or `Coin<OUTCOME_NO>` to the caller.                                 |
| **MarketAMM.impliedProbabilityBps()**          | `amm::implied_probability_bps(pool: &AMMPool, outcome_index): u64`                                                                                     | Read-only; calculates price from the pool's reserves. Identical math (CPMM), same 0-10,000 basis-point range.                                                                       |
| **PredictionMarket.close()**                   | `market::close(market: &mut Market, creator_cap: &CreatorCap)`                                                                                         | EVM: `onlyCreator` modifier checks `msg.sender`. Sui: capability pattern — only the holder of the `CreatorCap` can call `close()`.                                                  |
| **PredictionMarket.resolve(winningOutcome)**   | `market::resolve(market: &mut Market, resolver_cap: &ResolverCap, winning_outcome: u8)`                                                                | EVM: role check. Sui: presenting `ResolverCap` proves authority. Updates `market.state` to `Resolved` and sets `market.winning_outcome`.                                            |
| **OutcomeToken.mint(to, id, amount)**          | `coin::mint<OUTCOME>(mint_cap: &mut TreasuryCap<OUTCOME>, amount): Coin<OUTCOME>`                                                                      | Sui `Coin` standard uses `TreasuryCap<T>` for minting. The AMM module holds a `TreasuryCap<OUTCOME_YES>` and `TreasuryCap<OUTCOME_NO>` for each market.                            |
| **OutcomeToken.burn(from, id, amount)**        | `coin::burn<OUTCOME>(treasury: &mut TreasuryCap<OUTCOME>, coin: Coin<OUTCOME>)`                                                                        | Redemption: user transfers their `Coin<OUTCOME>` to a redemption function, which burns it and returns collateral from the pool.                                                     |
| **OracleResolver.resolve(marketId, outcome)**  | `oracle_resolver::resolve(registry: &mut ResolverRegistry, market: &mut Market, resolver_cap: &ResolverCap, outcome, proof_url)`                       | Sui: same capability pattern. The resolver presents `ResolverCap`, the function mutates the `Market` object's state.                                                                |
| **FeeTreasury.withdraw(to, amount)**           | `fee_treasury::withdraw(treasury: &mut FeeTreasury, cap: &TreasuryCap, amount): Coin<USDC>`                                                            | Sui: returns a `Coin<USDC>` to the caller. Caller can transfer it to any address.                                                                                                   |

### 3.1 Outcome token design: Coin<T> vs dynamic fields

Two Move design options for outcome tokens:

1. **Per-market coin types.** Each market gets two distinct `Coin<T>` types:
   `Coin<MARKET_1_YES>`, `Coin<MARKET_1_NO>`, `Coin<MARKET_2_YES>`, etc. Pro: type
   safety — impossible to redeem Market 1 YES for Market 2's pool. Con: every market
   requires publishing a new coin type (or generating one-time witnesses dynamically).
2. **Single outcome coin type with dynamic fields.** `Coin<OUTCOME>` is a single type;
   each market's escrow distinguishes outcomes via dynamic fields on the pool object.
   Pro: one coin type for all markets. Con: more runtime checks; the redemption function
   must verify the coin belongs to the correct market.

**Recommended approach:** option 1 (per-market coin types) for maximum type safety,
using Move's one-time witness pattern to generate unique `OUTCOME_YES` and `OUTCOME_NO`
witness types at market creation. This mirrors the EVM design where ERC-1155 token IDs
encode market+outcome, but enforced at the type system level rather than runtime.

---

## 4. Hybrid on-chain / off-chain split: unchanged from EVM

The product's data architecture is identical on Sui:

| Concern                                           | Where it lives                                                  | Why                                                                                      |
|---------------------------------------------------|-----------------------------------------------------------------|------------------------------------------------------------------------------------------|
| Money: collateral, positions, prices, settlement  | **On-chain (Sui objects)**                                      | Trust-minimized custody; auditable odds; the blockchain is the ledger.                   |
| Social: posts, follows, likes, comments, profiles | **Off-chain (Postgres, same backend as EVM deployment)**        | Latency and cost — even Sui's low fees cannot match the sub-10ms, zero-cost expectation for social actions. |
| The link between them                             | Market object IDs referenced in posts; backend indexer mirrors Sui object state | Feed renders live odds by reading indexed state, not querying Sui RPC on every page load. |

**Implication:** Justify on Sui reuses the **same Next.js backend, Postgres schema, and
social graph** as the EVM deployment. Only the blockchain integration layer changes:
wagmi/viem (EVM) → Sui TypeScript SDK; Solidity events → Sui transaction effects; ERC-20
approvals → `Coin` transfers.

The multi-chain product promise extends naturally: a user on Sui sees the same feed, the
same profiles, and the same market cards as a user on Base — they are simply trading
through different substrate layers that converge in the same Postgres social graph.

---

## 5. How Sui fits the multi-chain thesis: beyond EVM, not instead of EVM

The Justify whitepaper (§4) states:

> The chain is a detail. The market is the product.

Sui extends this thesis **beyond the EVM family**. Where Arc, Base, Ethereum, Polygon,
and BSC are "chain as a config parameter" (same Solidity contracts, different RPC
endpoints and collateral addresses), Sui is "chain as a substrate parameter" — the
*product* is identical, the *implementation* is a port to a different VM and type system.

### 5.1 What stays the same

- **Market mechanics.** Binary YES/NO outcomes, CPMM pricing, collateral-backed shares,
  oracle resolution, the same 2% fee. A market on Sui behaves identically to a market on
  Base from the user's perspective.
- **The feed.** Markets from Sui, Base, and Ethereum all appear in the same
  chain-agnostic timeline, badged with their home network. A user follows a creator, not
  a chain.
- **The oracle-proof commitment.** Every market, on any chain, records an
  `oracle_proof_url` at creation — the public resolution source. The same off-chain
  oracle indexer (or Chainlink CRE-style automation) can resolve markets on Sui and EVM
  networks uniformly.
- **The social graph.** One Postgres database, one user table, one follow graph. A
  user's wallet address (EVM or Sui) maps to the same profile.

### 5.2 What changes: a reimplementation, not a config swap

Be honest: **deploying Justify to Sui is a reimplementation in Move, not a deployment
script change.** Unlike the EVM stack, where adding Polygon meant updating environment
variables and redeploying the same compiled bytecode, Sui requires:

1. **Rewriting contracts in Move.** The `contracts/src/*.sol` files have no Sui
   equivalent — they must be ported module by module to Move's resource-oriented type
   system.
2. **New client-side integration.** The frontend's wagmi hooks (`useContractWrite`,
   `useContractRead`) are EVM-specific. Sui requires the Sui TypeScript SDK, different
   wallet adapters (Sui Wallet, Suiet), and a different transaction-building flow
   (programmable transaction blocks instead of ABI-encoded calldata).
3. **Event indexing differences.** EVM emits logs; Sui produces transaction *effects* (a
   structured diff of object changes). The backend indexer must parse Sui events from the
   `Event` objects emitted by Move modules, not from EVM log topics.
4. **Different finality model.** Sui uses a DAG-based consensus (Narwhal + Bullshark);
   finality is certificate-based, not longest-chain. The settlement UX must reflect Sui's
   sub-second finality (versus Base's 2s or Ethereum's 12-15s).

### 5.3 Why do it, then?

Two strategic reasons:

1. **Reach.** Sui has a distinct user base and capital pool. Users with SUI and USDC on
   Sui cannot trade Justify markets on EVM chains without bridging — costly, slow, and a
   UX barrier. A native Sui deployment meets them where they are.
2. **Performance proof of concept.** Sui's parallel execution and object model are
   designed for high-throughput apps. Justify on Sui demonstrates the protocol can scale
   past EVM's sequential bottleneck — a technical and narrative win.

The product's multi-chain claim becomes: **we run on five EVM chains and Sui**, proving
that "chain is a parameter" is not limited to the EVM monoculture.

---

## 6. The Sui bridge: connecting Sui to the EVM home market

Once Justify has both EVM deployments (Arc, Base, Ethereum, Polygon, BSC) and a Sui
deployment, the **Phase 3 bridge layer** (see `documentation_bridge/00-overview.md`)
extends to Sui.

### 6.1 Sui as a proxy chain

A market created on Ethereum (home chain) can have a **Sui proxy**:

```
                        ┌──────────────────────────────┐
                        │  HOME MARKET (Ethereum)      │
                        │  PredictionMarket + AMM      │
                        │  EVM contracts (Solidity)    │
                        └──────────▲───────────────────┘
                                   │
                         ┌─────────┴──────────┐
                         │ Wormhole bridge    │
                         │ (VAA messages)     │
                         └─────────┬──────────┘
                                   │
                        ┌──────────▼───────────────────┐
                        │ MARKET PROXY (Sui)           │
                        │ Move module: market_proxy    │
                        │ Locks USDC, mints wrapped    │
                        │ position (Coin<WRAPPED_YES>) │
                        └──────────────────────────────┘
                               ▲
                          User on Sui
                     (trades with Sui USDC)
```

The Sui proxy is a Move module that:

1. Accepts a user's `Coin<USDC>` on Sui.
2. Locks it in escrow (a `Balance<USDC>` field in a shared `ProxyPool` object).
3. Emits a Sui event encoding the buy intent: `BuyIntent { market_id, user, outcome, amount, min_shares }`.
4. A **Wormhole relayer** (off-chain service) observes the Sui event, requests a signed
   VAA (Verifiable Action Approval) from Wormhole's guardian set, and submits it to the
   Ethereum home market's `WormholeAdapter` contract (EVM).
5. The home market's AMM executes the trade and emits a confirmation event.
6. The relayer carries the confirmation back to Sui as a Wormhole message; the Sui proxy
   verifies the VAA and mints a `Coin<WRAPPED_POSITION_YES>` to the user.

At resolution, the same flow in reverse: Ethereum resolves, Wormhole propagates the
resolution to Sui, the proxy burns the wrapped position and returns the locked USDC.

### 6.2 Wormhole as the transport

Why Wormhole, not Chainlink CCIP? **Sui is non-EVM and has no Chainlink CCIP lane
today.** Wormhole is the established Sui↔EVM general-message bridge with production
volume. The architecture (documented in `documentation_sui/02-sui-bridge-overview.md` and
`03-wormhole-adapter-and-interop.md`) keeps the same **Chainlink-CCIP-inspired
layering** as the EVM bridge set:

- A chain-local router/adapter seam (`IBridgeAdapter` on EVM, `bridge_adapter` module on Sui).
- Message-carrying transport (Wormhole VAAs instead of CCIP DON attestations).
- Independent risk layer (exposure caps, circuit breaker — the RMN-inspired pattern).

The transport is pluggable: if Chainlink launches a Sui CCIP lane later, swapping
Wormhole for CCIP is an adapter replacement, not a protocol redesign.

### 6.3 Sui as a home chain

A market can also be **created on Sui** and proxied to EVM chains. The home-market
object lives on Sui; Base, Polygon, etc. deploy `MarketProxy` EVM contracts that forward
intents via Wormhole to Sui. The Move AMM on Sui is the single source of truth.

Same model, inverted direction. The bridge architecture is symmetric.

---

## 7. Forward references — the Sui documentation set

This overview is the entry point. The full Sui project is detailed across three
documents:

| # | Document                                  | What it covers                                                                                                                                                   |
|---|-------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 00 | **00-sui-polymarkets-overview.md** (this) | Why Sui; object model vs EVM; product parity; the hybrid split; multi-chain thesis extension.                                                                    |
| 01 | **01-move-market-contracts.md**           | The Move package design: module structure, object definitions (`Market`, `AMMPool`, `Coin<OUTCOME>`), capability pattern, function signatures, CPMM math in Move. |
| 02 | **02-sui-bridge-overview.md**             | The Sui bridge: Sui as proxy, Sui as home, Wormhole adapter (Move + EVM sides), VAA message flow, Chainlink-inspired layering on a non-EVM chain.               |

Supplementary:

- **03-wormhole-adapter-and-interop.md** (sibling to `documentation_bridge/`) — detailed
  Wormhole VAA encoding, guardian verification, Sui `Event` → EVM log and vice versa.
- **04-sui-bridge-security.md** — Wormhole Guardians vs Chainlink DON/RMN; exposure caps
  on Sui; circuit breaker via capability revocation.

---

## 8. Status and relation to the rest of the repo

**Current phase:** This is a **designed, not implemented** project. The EVM stack (see
`contracts/src/`) is the delivered Phase 1 work; Sui is a separate forward-looking
initiative.

**Design freeze intent:** These documents define the Sui Move package and bridge adapter
interfaces so that, when the project begins, the integration contract between the Sui
layer and the existing backend/frontend is frozen. The backend's market indexer, the
frontend's wallet connector, and the oracle resolver must support both EVM and Sui — this
set defines what "support Sui" means.

**Related documentation:**

- **`documentation_justify_whitepaper/justify-whitepaper.md` §2-§4** — the product (social
  prediction markets), the hybrid split, the "chain is a parameter" thesis that Sui
  extends.
- **`documentation_bridge/00-overview.md`** — the EVM bridge (CCIP-based, home/proxy
  model). Sui mirrors this architecture with Wormhole as the transport.
- **`contracts/src/`** — the Solidity contracts Sui achieves parity with.
- **`documentation_polymarket_social/architecture-polymarket-platform-reference.md`** —
  how the real Polymarket does it (CLOB + CTF + UMA). Sui and EVM Justify both use
  on-chain CPMM, not CLOB — but the CTF conditional-token idea is the same (outcome coins
  redeem on resolution).

---

## 9. Open questions and next steps

Before implementation begins, confirm:

1. **Sui native USDC object type.** Circle has announced USDC on Sui; verify the exact
   `Coin<T>` type identifier and whether it is mainnet-live or testnet-only as of
   2026-06-13. Update this doc with the canonical type.
2. **Outcome token type generation.** Decide between per-market coin types (unique
   one-time witness per market) vs a single `Coin<OUTCOME>` with dynamic fields. Lean
   toward per-market types for type safety unless Move package size limits force dynamic
   fields.
3. **Sponsored transaction flow.** Design which transactions the protocol sponsors (e.g.,
   first trade per user) and how the gas-payer backend service integrates with the
   frontend's transaction builder.
4. **Wormhole guardian set vs Chainlink DON.** Understand Wormhole's 19-guardian
   threshold model and whether it meets the same security bar as Chainlink's decentralized
   oracle network. Document in `04-sui-bridge-security.md`.

**Next:** proceed to `01-move-market-contracts.md` for the Move package design — module
layout, object structs, function signatures, capability pattern, and CPMM math translated
from Solidity to Move.

---

**End of overview.** This document establishes *why* Sui and *what* changes from the EVM
stack. The rest of the Sui documentation set defines *how* to build it.
