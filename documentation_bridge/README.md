# Justify Bridge Architecture — documentation set

How Justify builds **cross-chain bridges** for its event / prediction markets
across multiple blockchains (Arc, Base, Ethereum, Polygon, BSC), and how that
bridge layer **is directly inspired by the Chainlink CCIP architecture**.

This set expands [§5 "Bridge-proxied markets"](../documentation_justify_whitepaper/justify-whitepaper.md)
of the Justify whitepaper from a one-page concept into a buildable design.

> **Acknowledgement of inspiration.** Justify's bridge layer is **explicitly and
> directly inspired by the architecture of Chainlink CCIP** (Cross-Chain
> Interoperability Protocol). Where Chainlink separates a chain-local *Router*
> from per-lane *OnRamp/OffRamp* contracts, carries messages over a
> Decentralized Oracle Network (DON), and guards the system with an independent
> *Risk Management Network*, Justify mirrors that separation of concerns in its
> own `IBridgeAdapter` / `MarketProxy` / home-market design. We do not reimplement
> Chainlink; we adopt its architectural pattern and use CCIP itself as the first
> production transport adapter.

## Reading order

| # | Document | What it covers |
|---|----------|----------------|
| 00 | [overview.md](./00-overview.md) | The home/proxy model, the Chainlink-inspired layering, glossary |
| 01 | [bridge-adapter-interface.md](./01-bridge-adapter-interface.md) | The `IBridgeAdapter` seam: message shape, lifecycle, guarantees |
| 02 | [chainlink-ccip-adapter.md](./02-chainlink-ccip-adapter.md) | The CCIP adapter and the explicit mapping to Chainlink's architecture |
| 03 | [marketproxy-and-home-market.md](./03-marketproxy-and-home-market.md) | `MarketProxy`, wrapped receipts, lock/mint, home-market wiring |
| 04 | [per-chain-bridge-playbook.md](./04-per-chain-bridge-playbook.md) | How to stand up a bridge per chain; lanes, tokens, CCTP for USDC legs |
| 05 | [cross-chain-resolution.md](./05-cross-chain-resolution.md) | Settlement propagation; CCIP + CRE; one resolution settles all chains |
| 06 | [security-and-risk-management.md](./06-security-and-risk-management.md) | Bridge trust, allowlists, exposure caps, circuit breaker (Chainlink RMN parallel) |

## Status

Designed (forward-looking). The MVP is single-chain; Phase 2 is multi-chain
native; Phase 3 is this bridge layer. See the whitepaper roadmap (§8). Nothing
here is deployed yet — these documents define the target so the contracts and
adapters can be built against a frozen seam.

## Relation to the rest of the repo

- **Whitepaper §5** — the concept this set expands.
- **`docs/delivery/cre-resolver-plan.md`** — the CRE resolver that, in the bridge
  phase, settles the home market once and propagates outward.
- **`docs/delivery/arc-layer-plan.md`** — the env-driven "chain is a parameter"
  property that makes per-chain deployment config, not a rewrite.
- **`contracts/src/`** — `MarketFactory`, `MarketAMM`, `PredictionMarket`,
  `OracleResolver` are the home-chain stack the proxies forward to.
