# Justify on Sui — a separate project

**Sui-based PolyMarkets, and the Sui bridge.**

This is a **separate project** from the EVM line of Justify. Where the EVM work
(see [`documentation_bridge/`](../documentation_bridge/README.md)) deploys one
Solidity market stack across Arc / Base / Ethereum / Polygon / BSC and bridges
them with a Chainlink-CCIP-inspired layer, this project brings the same
prediction-market product to **Sui** — a non-EVM, Move-language, object-centric
chain — and then bridges Sui markets to the EVM world.

Two deliverables:

1. **Sui-based PolyMarkets** — the prediction-market stack rebuilt natively in
   **Move** on Sui's object model (not a Solidity port).
2. **The Sui bridge** — connecting Sui markets to the EVM home/proxy network,
   using **Wormhole** as the concrete cross-chain transport, while keeping the
   same **Chainlink-CCIP-inspired architectural layering** (adapter / proxy /
   home market, RMN-style risk controls) as the EVM bridge set.

> **On Chainlink and Wormhole.** Sui is non-EVM and has no native Solidity or
> mature Chainlink CCIP lane today. So this project keeps the **architecture**
> inspired by Chainlink CCIP — the same separation of a chain-local router, a
> per-route adapter seam, a message-carrying transport, and an independent risk
> layer — but uses **Wormhole** (the established Sui↔EVM general-message bridge)
> as the concrete transport. The bridge stays transport-agnostic behind a Move
> adapter interface, so a Sui CCIP lane can be slotted in later without redesign.

## Reading order

| # | Document | What it covers |
|---|----------|----------------|
| 00 | [sui-polymarkets-overview.md](./00-sui-polymarkets-overview.md) | Why Sui; the object-centric prediction-market model; product parity with the EVM stack |
| 01 | [move-market-contracts.md](./01-move-market-contracts.md) | The Move package: factory, AMM, outcome coins, oracle — object-model design |
| 02 | [sui-bridge-overview.md](./02-sui-bridge-overview.md) | The Sui bridge: home/proxy model on Sui, Chainlink-CCIP-inspired layering, Wormhole transport |
| 03 | [wormhole-adapter-and-interop.md](./03-wormhole-adapter-and-interop.md) | The Wormhole adapter (Move + EVM sides), VAAs, Sui↔EVM message and value flow, wrapped receipts |
| 04 | [sui-bridge-security.md](./04-sui-bridge-security.md) | Security & risk; Wormhole Guardians vs Chainlink RMN; exposure caps, circuit breaker |

## Status

Designed (forward-looking), separate project. Nothing here is deployed. These
documents define the target so a Move package and a Wormhole adapter can be
built against a frozen seam, the same way `documentation_bridge/` does for EVM.

## Relation to the rest of the repo

- **`documentation_bridge/`** — the EVM bridge set this project mirrors in
  architecture (home/proxy, `IBridgeAdapter`, Chainlink-CCIP-inspired layering).
- **`documentation_justify_whitepaper/`** — the protocol thesis; Sui extends the
  "chain is a parameter" claim past the EVM family.
- **`contracts/src/`** — the Solidity home stack a Sui proxy bridges to.
