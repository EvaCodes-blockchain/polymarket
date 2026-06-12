# Justify — The Multi-Chain Social Prediction-Market Protocol

**Whitepaper**

**Version:** 1.0 (draft)

**Date:** 2026-06-12

**Project:** PolyMarket Social ("Justify — Trade Smarter, Together")

https://justify.evacodes.com/

---

## Abstract

Justify is a social prediction-market platform that merges a Twitter-style social
feed with Polymarket-style event markets: every market is a shareable, tradeable
social object embedded directly in the timeline. Users discover markets the way
they discover opinions — by following people — and trade them in two clicks
without leaving the feed.

Where existing prediction-market venues are anchored to a single chain, Justify
is designed from the ground up as a **multi-chain protocol**. The same market
stack — factory, automated market maker, outcome tokens, oracle resolution —
deploys natively to **Arc, Base, Ethereum, Polygon, and Binance Smart Chain
(BNB Chain)**, and the architecture treats the chain itself as a configuration
parameter rather than a hard dependency. In a subsequent phase, markets on
different chains will be **proxied through cross-chain bridges**, so that a
market created on one network can accept liquidity and positions from any
other supported network, unifying fragmented liquidity into one global order
flow per event.

This document describes the product, the protocol architecture, the multi-chain
deployment model, the bridge-proxied market design, and the roadmap.

---

## 1. Introduction

### 1.1 The problem

Prediction markets are the most direct mechanism humanity has for pricing
beliefs. Yet today they suffer from three structural failures:

1. **Discovery is broken.** Markets live on exchange-style listing pages,
   disconnected from the conversations that create demand for them. The people
   debating an event and the people trading it sit on different platforms.
2. **Liquidity is fragmented by chain.** An event market on one network is
   invisible to capital on every other network. The same real-world question is
   either listed once (excluding most users) or listed many times (splitting
   liquidity into shallow, divergent pools).
3. **Creation is gatekept.** Listing a market is an editorial decision made by
   a platform, not a social act available to any creator with an audience.

### 1.2 The Justify thesis

Justify's answer is twofold:

- **Make the market a social object.** A prediction market is embedded as an
  interactive card inside posts. Creators launch markets around their content;
  followers see live odds as social signals ("21% chance"), discuss them in
  comment threads under the same post, and trade in place. Distribution is the
  social graph, not a listings page.
- **Make the chain a deployment detail.** The protocol deploys identically to
  many EVM networks, and — in the bridge phase — presents markets across all of
  them as a single logical market. Users trade where their assets already are;
  the protocol handles where the market actually lives.

---

## 2. Product overview

### 2.1 The experience

A typical Justify session:

1. **Sign in** with a social identity (Google/email) or directly with a crypto
   wallet (MetaMask, Coinbase Wallet, Trust Wallet, WalletConnect).
2. **Scroll the feed** — posts from followed creators across three tabs:
   *Feed*, *People* (creator discovery by category), and *Trending*.
3. **Trade from the feed** — the signature flippable market card shows the
   question, volume, closing time, and a circular probability gauge. Pressing
   *Buy Yes / Buy No* flips the card into a mini order form with a projected
   payout ("To win: $X").
4. **Go deeper** — a full trading page per market: price chart, Buy/Sell
   ticket, outcome prices quoted in cents (implied probability), and the
   market's own discussion thread.
5. **Track performance** — a portfolio of every held position with amount,
   current price, value, and unrealized P&L.
6. **Engage socially** — likes, comments, reposts, follows, notifications,
   profiles with forecasting track records.
7. **Create a market** — submit a market with a question, description, image,
   an **oracle proof** (the source that will resolve the outcome), and a market
   type (*FUN*, *Classic*, or *Challenge*).

### 2.2 Who it serves

| Audience                   | Value                                                                                                                                                |
|----------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Traders / forecasters**  | Feed-driven market discovery, in-place trading, portfolio and P&L tracking — on whichever chain their capital lives.                                 |
| **Creators / influencers** | Markets as content: a football club launches a match market, a protocol founder launches an upgrade market; reputation accrues to accurate creators. |
| **Spectators / community** | Live odds as social signals; a place to follow, debate, and watch collective belief move in real time.                                               |

### 2.3 Market mechanics

Each market is a **binary-outcome event market**:

- Outcomes are tokenized as ERC-20 **outcome tokens** (YES/NO), each redeemable
  for one unit of collateral if that outcome resolves true.
- Prices are quoted in **cents of collateral** and therefore read directly as
  implied probability (a YES price of $0.21 = a 21% market-implied chance).
- An on-chain **automated market maker (AMM)** provides continuous two-sided
  liquidity per market, so every market is tradeable from the moment it is
  seeded — no order-book bootstrapping problem.
- At expiry, an **oracle resolution** step settles the market on-chain;
  winning outcome tokens redeem at full collateral value, losing tokens at
  zero.

---

## 3. Protocol architecture

### 3.1 Smart-contract layer

The Justify contract suite (Solidity, OpenZeppelin-based) consists of:

| Contract           | Role                                                                                                                                                                                                                                 |
|--------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `MarketFactory`    | Deploys and registers markets; the single entry point per chain. Takes the **collateral token, outcome-token implementation, access controller, and fee treasury as constructor arguments** — nothing chain-specific is compiled in. |
| `PredictionMarket` | The market itself: question metadata, lifecycle (open → closed → resolved), settlement logic.                                                                                                                                        |
| `MarketAMM`        | Constant-liquidity automated market maker per market; quotes YES/NO prices, executes Buy/Sell against pooled collateral.                                                                                                             |
| `OutcomeToken`     | ERC-20 representation of an outcome position; minted on buy, burned on redemption.                                                                                                                                                   |
| `OracleResolver`   | The resolution gateway: an authorized resolver (manual in MVP, decentralized later — see §5.3) calls `resolve()` to settle a market.                                                                                                 |
| `FeeTreasury`      | Collects protocol fees from AMM trades.                                                                                                                                                                                              |
| `AccessControl`    | Role management for factory, resolver, and treasury operations.                                                                                                                                                                      |

The deliberate design decision that powers the entire multi-chain strategy:
**every external dependency is injected, never hard-coded.** Collateral is a
constructor parameter; the chain RPC, chain ID, and deployed addresses are
environment configuration; the resolution authority is a role. Deploying Justify
to a new EVM chain is a **configuration-and-redeploy operation, not a code
change.**

### 3.2 Application layer

- **Frontend:** Next.js (App Router) + TypeScript + wagmi/viem. The wallet
  layer defines chains from environment configuration and uses
  `wallet_addEthereumChain` so users can add a supported network to their
  wallet in one click. Contract addresses are loaded at **runtime** from
  deployment artifacts served by the backend, so the same build serves every
  chain.
- **Backend:** Next.js API routes + NextAuth.js + PostgreSQL + Prisma. The
  backend owns the social graph (profiles, follows, posts, comments,
  notifications), indexes on-chain market state, and serves the per-chain
  deployment registry.
- **Deployment artifacts:** every chain deployment produces a frozen artifact
  (addresses + chain ID + ABI versions) that is the integration contract
  between the chain and the application — the application consumes it, never
  redefines it.

### 3.3 Hybrid on-chain / off-chain split

| Concern                                           | Where it lives                                                                               | Why                                                                          |
|---------------------------------------------------|----------------------------------------------------------------------------------------------|------------------------------------------------------------------------------|
| Money: collateral, positions, prices, settlement  | **On-chain**                                                                                 | Trust-minimized custody and settlement; auditable odds.                      |
| Social: posts, follows, likes, comments, profiles | **Off-chain (Postgres)**                                                                     | Latency and cost; social actions must be free and instant.                   |
| The link between them                             | Market addresses referenced from posts; backend indexer mirrors on-chain state into the feed | The feed renders live odds without forcing every reader through an RPC call. |

---

## 4. The multi-chain protocol — one market layer, many chains

**This is the core strategic commitment of Justify: we are bringing
Polymarket-style event markets to many blockchains.** Not as ports, not as
forks — as first-class native deployments of one protocol.

### 4.1 Target networks

| Network             | Chain ID          | Native collateral                            | Strategic role                                                                                                                                              |
|---------------------|-------------------|----------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Arc** (Circle)    | 5042002 (testnet) | **USDC** — native gas *and* collateral asset | The stablecoin-native settlement chain: gas and bets in the same dollar unit; the cleanest UX for a market denominated in dollars. First production target. |
| **Base**            | 8453              | USDC                                         | The social-consumer L2: low fees, the largest onchain-social user base, natural home for feed-driven trading.                                               |
| **Ethereum**        | 1                 | USDC / DAI                                   | The settlement anchor and deepest capital base; canonical home for high-value, long-horizon markets and (later) bridge root state.                          |
| **Polygon**         | 137               | USDC                                         | The incumbent prediction-market ecosystem (Polymarket's home); cheapest entry for high-frequency retail flow.                                               |
| **BNB Smart Chain** | 56                | USDC / USDT                                  | The largest retail user population in Asia and the global south; distribution at scale.                                                                     |

### 4.2 Why multi-chain is structural, not aspirational

The protocol was built so that chains are configuration:

1. **Collateral is injected at deploy time.** `MarketFactory` receives the
   collateral token address as a constructor argument. On Arc the factory
   points at Circle's native USDC; on Base, Ethereum, Polygon, and BSC it
   points at the canonical USDC (or chain-appropriate stablecoin) of that
   network. No contract is rewritten per chain.
2. **Chain identity is environment, not code.** RPC URLs, chain IDs, and
   explorer links live in environment configuration on both the contract
   tooling (per-network Hardhat targets) and the application (env-driven chain
   definitions in the wallet layer).
3. **Addresses are runtime data.** The frontend resolves contract addresses
   from served deployment artifacts, so one application build fronts every
   chain simultaneously.
4. **Proven by migration.** The stack has already executed a substrate swap
   (local development chain → Arc testnet) as a pure config-and-redeploy
   exercise, validating the claim before any further network is added.

The result: adding a supported chain is **deploy + register the artifact +
fund the fee treasury**. The marginal cost of chain N+1 is operational, not
architectural.

### 4.3 The user's view of multi-chain

In the multi-chain phase (pre-bridge), each market lives natively on one chain:

- The feed is **chain-agnostic**: markets from all supported networks appear in
  one timeline, badged with their home network.
- Selecting *Buy* on a market prompts the wallet to switch (or add) the
  market's home chain — one click via `wallet_addEthereumChain`.
- The portfolio aggregates positions **across all chains** into one view, with
  per-chain breakdowns.
- Creators choose a home chain at market creation, defaulting to where their
  audience's capital is.

This already beats single-chain venues on reach — but it still fragments
liquidity per market per chain. That is what the bridge phase resolves.

---

## 5. Bridge-proxied markets — the unification phase

**The future of Justify markets is that they will be proxied through
cross-chain bridges.** A market will have one *home chain* — where its
collateral pool, AMM, and settlement actually live — and lightweight *proxy
markets* on every other supported chain that forward orders and liquidity to
the home market through bridge messaging.

### 5.1 The model

```
                        ┌────────────────────────────┐
                        │   HOME MARKET (e.g. Arc)   │
                        │  PredictionMarket + AMM    │
                        │  collateral pool (USDC)    │
                        │  OracleResolver settles    │
                        └─────▲──────────▲──────▲────┘
                              │ bridge   │      │ bridge
                              │ messages │      │ messages
                 ┌────────────┴───┐ ┌────┴─────┐ ┌──┴───────────┐
                 │ MarketProxy    │ │ Market   │ │ MarketProxy  │
                 │ on Base        │ │ Proxy on │ │ on BSC       │
                 │                │ │ Polygon  │ │              │
                 └────────────────┘ └──────────┘ └──────────────┘
                        ▲                ▲              ▲
                   user on Base    user on Polygon  user on BSC
                   (pays in local  (local USDC)     (local USDC/USDT)
                    USDC)
```

- **`MarketProxy`** (per remote chain): accepts a user's local collateral,
  locks it, and emits a bridge message (buy/sell intent) to the home market.
  The home AMM executes the trade against the unified pool and confirms back;
  the proxy mints a local **wrapped position receipt** representing the
  outcome tokens held on the home chain.
- **One pool, one price.** Because all flow from all chains executes against
  the single home AMM, there is exactly one price per outcome per event —
  no cross-chain price divergence, no fragmented depth.
- **Settlement propagates outward.** When the home market resolves, the
  resolution is bridged to every proxy; users redeem their wrapped receipts
  for local collateral on the chain where they entered.
- **Bridge-agnostic by design.** The proxy ↔ home transport is an interface
  (`IBridgeAdapter`), with adapters for general message bridges (e.g.
  Chainlink CCIP, LayerZero-class messaging) and native-USDC transfer rails
  (e.g. Circle CCTP for the USDC legs). The same injected-dependency principle
  from §3.1 applies: the bridge is a parameter, not a commitment.

### 5.2 Properties and trade-offs

| Property               | Consequence                                                                                                                                                                                           |
|------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Unified liquidity      | Every chain's users deepen the *same* book; small chains get big-chain depth from day one.                                                                                                            |
| Single source of truth | One resolution event settles all chains; no proxy can disagree with home state.                                                                                                                       |
| Asynchronous fills     | A bridged buy confirms in bridge time (seconds to minutes), not block time. The UI quotes a *guaranteed-bounds* fill (max slippage envelope) at intent time; the home AMM fills within it or refunds. |
| Bridge trust           | A proxy position is as safe as the weakest of (home chain, bridge adapter). Adapters are allowlisted per route by protocol governance, and per-route exposure caps limit blast radius.                |
| Local-first routing    | If a market's home chain *is* the user's chain, the proxy path is bypassed entirely — native speed, no bridge risk.                                                                                   |

### 5.3 Resolution across chains

The MVP resolves markets via an authorized manual oracle. The protocol design
anticipates progressive decentralization of `OracleResolver`:

- **Phase 1 (current):** authorized resolver role, with the oracle-proof URL
  attached to every market at creation as the public resolution commitment.
- **Phase 2:** automated resolution workflows (e.g. Chainlink CRE-style
  compute fetching the committed source and calling `resolve()`), removing the
  human from the loop for objectively verifiable events.
- **Phase 3 (bridge phase):** resolution executes **once, on the home chain**,
  and is propagated to all proxies via the same bridge adapters used for
  order flow — so decentralizing resolution on one chain decentralizes it
  everywhere at once.

---

## 6. Fees and sustainability

- The AMM charges a protocol fee on each trade, routed to the per-chain
  `FeeTreasury`.
- In the bridge phase, bridged orders carry the home-market fee plus the
  bridge transport cost (surfaced explicitly in the quoted payout — no hidden
  spread).
- Creator incentives: a configurable share of a market's fee flow can be
  directed to its creator, aligning the social layer (audience building) with
  the market layer (volume) — the creator-economy loop that listings-page
  venues cannot offer.

---

## 7. Security model

- **Contracts:** OpenZeppelin primitives, role-based access control, and the
  injected-dependency pattern (no upgradeable god-contracts; a bad parameter is
  fixed by redeploying a market, not by mutating the protocol).
- **Collateral:** chain-canonical stablecoins only (Circle USDC where
  available); no protocol-issued synthetic collateral on production networks.
- **Bridge phase:** allowlisted bridge adapters per route, per-route exposure
  caps, and a circuit-breaker pausing new proxy intents (never blocking
  redemptions) on anomaly detection.
- **Resolution:** the oracle-proof commitment at creation time makes every
  market's resolution criterion public *before* trading opens; disputes in the
  decentralized phase escalate to the home chain's resolution process.

---

## 8. Roadmap

| Phase                                         | Scope                                                                                                                                                            | Status                       |
|-----------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------|
| **0 — MVP**                                   | Single-chain (local devnet): auth, social graph (follow), MetaMask connect, one real on-chain Buy with on-chain settlement.                                      | **Done**                     |
| **1 — Arc**                                   | First public-network deployment: native USDC gas + USDC collateral on Arc testnet; runtime address registry; automated resolution pilot.                         | **In progress**              |
| **2 — Multi-chain native**                    | Independent deployments on **Base, Ethereum, Polygon, BSC**; chain-agnostic feed with network badges; cross-chain aggregated portfolio; creator chain selection. | Planned                      |
| **3 — Bridge-proxied markets**                | `MarketProxy` + `IBridgeAdapter` (CCIP / CCTP-class transports); unified home-market liquidity; cross-chain settlement propagation.                              | Designed (this document, §5) |
| **4 — Decentralized resolution & governance** | Fully automated/decentralized oracle resolution propagated cross-chain; adapter allowlist and fee parameters under protocol governance.                          | Research                     |

---

## 9. Conclusion

Justify collapses the distance between *talking about the future* and *pricing
it*. By embedding event markets in the social feed, it gives prediction markets
the distribution channel they have always lacked; by deploying one protocol
natively across **Arc, Base, Ethereum, Polygon, and BNB Smart Chain**, it meets
users where their capital already lives; and by **proxying markets through
cross-chain bridges** in the unification phase, it turns five fragmented venues
into one global market per event — one question, one pool, one price,
tradeable from any chain.

The chain is a detail. The market is the product. The feed is the distribution.

---

## Appendix A — Supported network parameters

| Network              | Chain ID | Gas token             | Collateral  | Explorer            |
|----------------------|----------|-----------------------|-------------|---------------------|
| Arc Testnet (Circle) | 5042002  | USDC (native, 18 dec) | Circle USDC | testnet.arcscan.app |
| Base                 | 8453     | ETH                   | USDC        | basescan.org        |
| Ethereum             | 1        | ETH                   | USDC        | etherscan.io        |
| Polygon PoS          | 137      | POL                   | USDC        | polygonscan.com     |
| BNB Smart Chain      | 56       | BNB                   | USDC / USDT | bscscan.com         |

## Appendix B — Related project documents

- Product specification: `documentation_polymarket_social/overview.md`,
  `functional-requirements.md`
- MVP scope: `documentation_polymarket_social/functional-requirements-ceo.md`
- Platform architecture reference:
  `documentation_polymarket_social/architecture-polymarket-platform-reference.md`
- Arc migration spec (chain-as-config proof): `docs/delivery/arc-layer-plan.md`
- Automated resolution spec: `docs/delivery/cre-resolver-plan.md`

---

*This whitepaper is a living document describing protocol direction; testnet
parameters and phase ordering may evolve. It is not an offer of securities or
investment advice.*
