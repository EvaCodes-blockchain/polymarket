# Justify Bridge Architecture — Overview

**Bridge documentation set — entry point**

**Version:** 1.0 (design phase)

**Date:** 2026-06-13

**Status:** Designed, not implemented. This is the forward-looking target for Phase 3
of the Justify roadmap (see whitepaper §8). The MVP is single-chain; Phase 2 is
multi-chain native; Phase 3 is this cross-chain bridge layer.

---

## 1. The problem: per-chain liquidity fragmentation

Justify deploys its prediction-market protocol natively to **Arc, Base, Ethereum,
Polygon, and BNB Smart Chain** (see whitepaper §4). In the multi-chain native phase
(Phase 2), each market lives on exactly one home chain:

- A market created on Base accepts trades only from Base users with Base USDC.
- An identical real-world event could spawn separate markets on Polygon and Ethereum,
  each with its own isolated AMM pool, its own price, and no way to arbitrage them.
- Users must bridge capital manually between chains to participate in markets on
  networks where they don't already hold collateral.

The result: **liquidity fragmentation by chain for the same event.** A market on a
small chain has thin depth; a market on a large chain excludes users on other networks.
The protocol's multi-chain reach becomes a liability — it splits, rather than unifies,
the available capital.

This document describes how Justify's **cross-chain bridge layer** solves that
fragmentation by proxying markets across chains, presenting one logical market per
event with unified liquidity backed by a single AMM pool on a designated home chain.

---

## 2. The solution: home-market / proxy-market model

### 2.1 Conceptual model

A bridge-proxied market has:

1. **One home chain** — the chain where the market was created and where its
   `PredictionMarket`, `MarketAMM`, collateral pool, and `OracleResolver` actually
   live. This is the **source of truth** for prices, settlement, and state.
2. **Lightweight proxy contracts on every other supported chain** — a `MarketProxy`
   per remote chain that accepts local collateral (e.g., USDC on Polygon), locks it,
   emits a bridge message (a buy or sell *intent*) to the home market, receives a
   confirmation, and mints a **wrapped position receipt** representing the outcome
   tokens held on the home chain.
3. **A pluggable bridge adapter per route** — the transport layer that carries intents
   from a proxy to the home market and carries confirmations and resolutions back. The
   adapter is an interface (`IBridgeAdapter`); concrete implementations wrap Chainlink
   CCIP, Circle CCTP, LayerZero-class messaging, or other cross-chain transports.

### 2.2 ASCII diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                   HOME MARKET (e.g., Arc chain 5042002)              │
│                                                                       │
│  ┌────────────────┐   ┌─────────────┐   ┌──────────────┐           │
│  │ PredictionMar  │   │  MarketAMM  │   │  OracleRes   │           │
│  │ ket (state,    │◀──│  (CPMM pool,│◀──│  olver (set  │           │
│  │  question)     │   │   YES/NO res│   │   tles on    │           │
│  └────────────────┘   │   erves)    │   │   home)      │           │
│                       └──────▲──────┘   └──────────────┘           │
│                              │                                       │
│                     Collateral pool (USDC)                           │
│                     Outcome tokens minted here                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                   ┌───────────┴────────────┐
                   │   Bridge messages       │
                   │  (intent / confirm /    │
                   │   resolve)             │
                   └───────────┬────────────┘
                               │
         ┌─────────────────────┼──────────────────────┐
         │                     │                      │
         ▼                     ▼                      ▼
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ MarketProxy    │    │ MarketProxy    │    │ MarketProxy    │
│ on Base (8453) │    │ on Polygon     │    │ on BSC (56)    │
│                │    │ (137)          │    │                │
│ Locks local    │    │ Locks local    │    │ Locks local    │
│ USDC, mints    │    │ USDC, mints    │    │ USDC/USDT,     │
│ wrapped recpt  │    │ wrapped recpt  │    │ mints wrapped  │
└────────────────┘    └────────────────┘    └────────────────┘
        ▲                     ▲                      ▲
        │                     │                      │
   User on Base          User on Polygon        User on BSC
   (trades with          (trades with           (trades with
    local USDC)           local USDC)            local stablecoin)
```

### 2.3 Trade flow (proxy to home)

1. **User initiates a buy on a proxy chain.** Alice on Base calls
   `MarketProxy.buy(outcomeIndex=0, collateralAmount=100 USDC, minSharesOut=95)`.
2. **Proxy locks collateral.** The proxy transfers Alice's 100 USDC into escrow and
   records a pending intent.
3. **Intent bridged to home.** The proxy invokes its `IBridgeAdapter.sendBuyIntent()`,
   which encodes the message (marketId, user, outcomeIndex, amount, minShares) and
   transmits it via the underlying transport (e.g., Chainlink CCIP).
4. **Home market executes trade.** The home-chain bridge receiver decodes the intent
   and calls `MarketAMM.buy()` against the unified pool. The AMM calculates shares
   based on its CPMM reserves, mints outcome tokens to a bridge escrow, and emits a
   `TradeConfirmed` event.
5. **Confirmation bridged back to proxy.** The home adapter sends a confirmation
   message (intentId, sharesOut) back to the proxy chain.
6. **Proxy mints wrapped receipt.** The proxy receives the confirmation, verifies it,
   and mints a **wrapped position token** to Alice representing her claim on the
   outcome shares held on the home chain. Alice's 100 USDC is now locked on Base; her
   wrapped receipt entitles her to redeem for home-chain outcome tokens (or, after
   resolution, for collateral) via a bridge withdrawal.

### 2.4 Settlement flow (home to proxies)

1. **Home market resolves.** The `OracleResolver` on the home chain calls
   `PredictionMarket.resolve(winningOutcome=0)`. The market state transitions to
   `Resolved`.
2. **Resolution propagates outward.** The home bridge adapter emits a resolution
   message to every registered proxy: `MarketResolved(marketId, winningOutcome)`.
3. **Proxies mirror the resolution.** Each `MarketProxy` receives the resolution
   message, records the winning outcome, and transitions to a redeemable state.
4. **Users redeem locally.** Alice on Base calls `MarketProxy.redeem()`. The proxy
   verifies her wrapped receipt corresponds to the winning outcome, burns the receipt,
   and transfers the locked Base USDC (proportional to her shares) back to her. No
   second bridge hop — redemption happens on the chain where she entered.

---

## 3. Chainlink-inspired layering

**Acknowledge the inspiration.** Justify's bridge architecture is **directly inspired
by the Chainlink Cross-Chain Interoperability Protocol (CCIP) architecture.** We adopt
Chainlink's proven separation of concerns, layering strategy, and risk-management
approach as the foundation of our design. We do **not** reimplement Chainlink; we use
CCIP itself as the first production bridge adapter and mirror its architectural pattern
for other transports.

### 3.1 The Chainlink CCIP model (reference)

Chainlink CCIP separates cross-chain messaging into four layers:

| Chainlink CCIP layer              | Role                                                                                                                                                              |
|-----------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Router** (per chain)            | The chain-local entry point. Users and applications send cross-chain messages to the Router, which forwards them to the appropriate lane-specific OnRamp.         |
| **OnRamp / OffRamp** (per lane)   | Per source→destination lane contracts. OnRamp on the source chain encodes and commits messages; OffRamp on the destination chain decodes and delivers them.       |
| **Decentralized Oracle Network**  | A committee of independent oracle nodes that observe committed messages on the source chain, reach consensus, and attest them on the destination chain's OffRamp. |
| **Risk Management Network (RMN)** | An independent monitoring layer that observes message flow and can halt the OffRamp (pause message execution) if anomalies are detected — a circuit breaker.      |

Key properties:
- **Separation of concerns:** chain-local routing, per-lane transport, consensus, and
  risk monitoring are independent layers with defined interfaces between them.
- **Pluggable lanes:** adding a new source→destination route is a deploy-and-register
  operation, not a protocol change.
- **Defense in depth:** the RMN provides an independent safety layer on top of the DON
  consensus.

### 3.2 How Justify maps Chainlink's layers

Justify adopts this pattern in its bridge design:

| Justify bridge component           | Chainlink CCIP analog                        | Role in Justify                                                                                                                                                                                    |
|------------------------------------|----------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **`MarketProxy`** (per chain)      | Router                                       | The chain-local entry point for bridged markets. Accepts user intents (buy/sell), locks collateral, emits events to the bridge adapter. One proxy contract per remote chain per bridged market.    |
| **`IBridgeAdapter`** (interface)   | OnRamp / OffRamp abstraction                 | The per-route transport seam. `sendBuyIntent()` / `receiveBuyConfirm()` / `sendResolution()` methods. Concrete adapters implement this for CCIP, CCTP, LayerZero, etc.                            |
| **Concrete adapter (e.g., CCIP)**  | OnRamp / OffRamp + DON message transport     | A Justify adapter wrapping Chainlink CCIP: encodes intents into CCIP messages on the source chain, relays via Chainlink's DON, decodes on the destination. Reuses CCIP's consensus and finality. |
| **Per-route exposure caps + pause** | Risk Management Network (RMN) circuit breaker | Justify's risk layer: each adapter has a per-route max exposure cap (total locked collateral) and a `pause()` function callable by protocol governance on anomaly detection. (See doc 06.)         |
| **Home-market settlement**         | Canonical state anchor                       | The home chain's `PredictionMarket` and `MarketAMM` are the single source of truth; proxies never resolve independently — they only mirror home state.                                             |

### 3.3 Why we adopt Chainlink's pattern

1. **Proven at scale.** CCIP's architecture has secured billions in cross-chain value.
   We inherit its design rigor rather than inventing our own untested model.
2. **Separation of transport from application logic.** `IBridgeAdapter` is a clean
   seam; swapping CCIP for LayerZero or Wormhole is a new adapter implementation, not
   a rewrite of `MarketProxy` or `MarketAMM`.
3. **Defense in depth.** The RMN-inspired exposure caps and circuit breaker give
   protocol governance a safety valve independent of any single bridge's security.
4. **Pluggable lanes.** Adding Base↔Polygon as a new route is a deploy operation
   (deploy adapters on both chains, register them with the proxies) with no changes to
   the factory or AMM contracts.
5. **Forward compatibility with decentralized resolution.** When Justify moves to
   automated oracle resolution (Phase 4, whitepaper §8), the resolution message is
   carried by the same adapter that carries trade intents — decentralizing resolution
   on the home chain decentralizes it everywhere at once.

### 3.4 Differences from Chainlink CCIP

| Aspect                          | Chainlink CCIP                                                                             | Justify bridge                                                                                                                    |
|---------------------------------|--------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| **Message types**               | Arbitrary data + token transfers                                                           | Three message types: buy intent, sell intent (future), resolution. Strongly typed per the `IBridgeAdapter` interface.             |
| **Finality**                    | DON waits for probabilistic finality (e.g., 15 blocks on Ethereum) before attesting        | Justify adapters inherit the finality guarantees of their underlying transport (CCIP: same as Chainlink; CCTP: Circle finality). |
| **Token standard**              | CCIP has a native token-transfer standard with burn-and-mint or lock-and-mint token pools  | Justify uses lock-and-mint for collateral (proxy locks USDC, home uses it to buy shares) and wrapped receipts for positions.     |
| **Governance**                  | Chainlink DAO / node-operator set managed by Chainlink Labs                                | Justify protocol governance (initially multisig, later DAO) manages adapter allowlist and exposure caps per route.                |
| **Application-specific state**  | CCIP is general-purpose messaging                                                          | Justify messages are prediction-market-specific: they carry marketId, outcomeIndex, shares, oracle proofs.                        |

---

## 4. Target chains and deployment scope

The bridge layer spans the same five networks as the multi-chain native phase (see
whitepaper §4.1):

| Network              | Chain ID | Native collateral                            | Role in bridge architecture                                                                                                  |
|----------------------|----------|----------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| **Arc** (Circle)     | 5042002  | **USDC** — native gas *and* collateral asset | The stablecoin-native chain; markets created here use native USDC for gas and trading — the cleanest UX for dollar markets.  |
| **Base**             | 8453     | USDC                                         | The social-consumer L2; low fees, the largest onchain-social user base — natural home for feed-driven prediction markets.    |
| **Ethereum**         | 1        | USDC / DAI                                   | The settlement anchor and deepest capital base; canonical home for high-value markets and (likely) the bridge root.          |
| **Polygon PoS**      | 137      | USDC                                         | The incumbent prediction-market ecosystem (Polymarket's home); cheapest entry for high-frequency retail flow.                |
| **BNB Smart Chain**  | 56       | USDC / USDT                                  | The largest retail population in Asia and the global south; distribution at scale.                                           |

Every market designates one of these five as its **home chain** at creation time. The
other four chains each receive a `MarketProxy` for that market if the creator opts in
to cross-chain bridging. Initially, high-liquidity markets (seeded by the protocol or
prominent creators) will be bridged; smaller markets may remain single-chain to avoid
bridge overhead.

---

## 5. Glossary

| Term                            | Definition                                                                                                                                                                                            |
|---------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Home chain / home market**    | The blockchain where a market's `PredictionMarket`, `MarketAMM`, collateral pool, and `OracleResolver` are deployed and where settlement actually happens. The single source of truth for the market. |
| **Proxy chain / proxy market**  | A blockchain other than the home chain where a lightweight `MarketProxy` contract accepts local collateral and forwards trade intents to the home market via a bridge.                                |
| **Lane / route**                | A unidirectional source→destination bridge path, e.g., "Base → Arc" or "Arc → Polygon." Each route has its own `IBridgeAdapter` deployment and its own exposure cap.                                  |
| **Bridge adapter**              | A contract (or set of contracts) implementing `IBridgeAdapter` for a specific transport (CCIP, CCTP, LayerZero). Encodes messages on the source, relays them, decodes on the destination.             |
| **Intent**                      | A cross-chain message requesting a trade on the home market: `BuyIntent(marketId, user, outcomeIndex, collateralAmount, minSharesOut)` or `SellIntent(…)`.                                            |
| **Wrapped position receipt**    | An ERC-20 or ERC-1155 token minted by `MarketProxy` on a proxy chain representing a user's claim on outcome shares held in escrow on the home chain.                                                  |
| **Attestation**                 | A cryptographic proof (signature, Merkle proof, or consensus certificate) carried in a bridge message verifying that the source-chain event (intent or resolution) is finalized.                      |
| **Exposure cap**                | A per-route maximum for total locked collateral on a proxy chain for a given market or globally. A risk-management parameter enforced by the bridge adapter; acts as a circuit breaker.               |
| **Circuit breaker**             | A pause mechanism callable by protocol governance to halt new intents on a route (or all routes) without blocking redemptions. Inspired by Chainlink's Risk Management Network.                       |

---

## 6. Forward references — the rest of this documentation set

The bridge architecture is detailed across seven documents (including this overview):

| # | Document                                         | What it covers                                                                                                                      |
|---|--------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| 00 | **00-overview.md** (this document)               | The problem (liquidity fragmentation), the home/proxy model, the Chainlink-inspired layering, glossary.                            |
| 01 | **01-bridge-adapter-interface.md**               | The `IBridgeAdapter` Solidity interface: message types, lifecycle, events, guarantees, and the seam between proxies and adapters.  |
| 02 | **02-chainlink-ccip-adapter.md**                 | The CCIP adapter: explicit mapping to Chainlink's Router/OnRamp/OffRamp/DON, message encoding, fee handling, finality assumptions. |
| 03 | **03-marketproxy-and-home-market.md**            | `MarketProxy` contract design, wrapped position receipts, lock/mint flow, home-market AMM wiring, state synchronization.           |
| 04 | **04-per-chain-bridge-playbook.md**              | Operational playbook: how to stand up a bridge per chain pair, deploy adapters, configure lanes, use CCTP for USDC legs.           |
| 05 | **05-cross-chain-resolution.md**                 | Settlement propagation: how `OracleResolver.resolve()` on the home chain triggers resolution messages to all proxies via adapters.  |
| 06 | **06-security-and-risk-management.md**           | Bridge trust model, adapter allowlists, per-route exposure caps, circuit breaker, Chainlink RMN parallel, governance.              |

---

## 7. Status and integration with the Justify roadmap

**Current phase (as of 2026-06-13):** Phase 1 (Arc testnet deployment) is in progress.
The MVP (Phase 0) is complete and runs on local Ganache.

**Bridge phase:** This documentation set describes **Phase 3** of the Justify roadmap
(whitepaper §8). Nothing here is deployed yet. Phase 2 (multi-chain native — five
independent deployments, no bridges) comes first.

**Design freeze:** These documents define the target architecture so that when Phase 3
begins, the `IBridgeAdapter` interface, `MarketProxy` contract, and per-chain adapter
deployments can be built against a stable specification. The interfaces and message
shapes described here are the **integration contract** between the bridge layer and the
home-chain stack (`MarketFactory`, `MarketAMM`, `PredictionMarket`, `OracleResolver`).

**Related documentation:**
- **Whitepaper §5** (`documentation_justify_whitepaper/justify-whitepaper.md`) — the
  one-page concept this set expands.
- **CRE resolver plan** (`docs/delivery/cre-resolver-plan.md`) — the Chainlink
  Functions-based automated resolver that, in the bridge phase, settles the home market
  once and propagates outward.
- **Arc migration spec** (`docs/delivery/arc-layer-plan.md`) — the proof that "chain
  is a config parameter," validating the claim that per-chain deployment is
  operational, not architectural.
- **Home-chain contracts** (`contracts/src/`) — `MarketFactory.sol`, `MarketAMM.sol`,
  `PredictionMarket.sol`, `OracleResolver.sol` are the existing stack the proxies
  forward to.

---

## 8. Properties and trade-offs recap

| Property                    | Consequence / design choice                                                                                                                                                                            |
|-----------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Unified liquidity**       | Every chain's users deepen the *same* AMM pool; small chains get big-chain depth from day one. One price per outcome per event — no arbitrage, no cross-chain price divergence.                        |
| **Single source of truth**  | Home market resolves once; proxies mirror that resolution. No proxy can disagree with home state — the `OracleResolver` on the home chain is the only authority.                                       |
| **Asynchronous fills**      | A bridged buy confirms in bridge time (CCIP: ~10 min, optimistic bridges: faster). UI quotes a *guaranteed-bounds* fill (max slippage envelope) at intent time; home AMM fills within it or refunds. |
| **Bridge trust**            | A proxy position is as safe as min(home chain security, bridge adapter security). Adapters are allowlisted per route by governance; per-route exposure caps limit blast radius.                        |
| **Local-first routing**     | If a market's home chain *is* the user's chain, the proxy path is bypassed entirely — native speed, no bridge fees, no bridge risk. The feed automatically routes users to the cheapest path.          |
| **Pluggable transports**    | The `IBridgeAdapter` interface lets us swap CCIP for LayerZero, Wormhole, or native token bridges (CCTP for USDC) without changing `MarketProxy` or `MarketAMM`. Future-proof.                        |
| **Progressive deployment**  | High-liquidity markets bridge first; long-tail markets can remain single-chain. The architecture supports both bridged and non-bridged markets in parallel.                                           |

---

## 9. Next steps

Readers new to the bridge layer should proceed in document order:

1. **01-bridge-adapter-interface.md** — understand the message types and interface.
2. **02-chainlink-ccip-adapter.md** — see the CCIP mapping concretely.
3. **03-marketproxy-and-home-market.md** — learn how proxies lock collateral and mint
   wrapped receipts.
4. **04-per-chain-bridge-playbook.md** — operational details for standing up a route.
5. **05-cross-chain-resolution.md** — how settlement propagates.
6. **06-security-and-risk-management.md** — risk controls and governance.

Engineers building the bridge layer should treat `IBridgeAdapter` (doc 01) as the
frozen integration contract; concrete adapters (CCIP, CCTP, LayerZero) implement that
interface.

---

**End of overview.** Proceed to `01-bridge-adapter-interface.md` for the message
specification and interface definition.
