# PolyMarket Social ("Justify") — Documentation

Documentation for **PolyMarket Social** (branded *Justify — Trade Smarter, Together*), a social
prediction-market platform: a Twitter-like social network where the core shareable object is a
prediction market, tradeable directly from the feed.

All documents are derived from the analysis of the HTML prototype in
[`../html-polymarket-social-prototype/`](../html-polymarket-social-prototype/). The prototype is a
static front-end with hard-coded data; the backend, API, and smart-contract designs described here
are the planned baseline for the production system.

---

## Documents

| Document                                                                                       | Purpose                                                                                                                                                                                                                       |
|------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [overview.md](overview.md)                                                                     | Project vision, target audiences, core user experience, main functional areas, and a technical snapshot of the prototype. **Start here.**                                                                                     |
| [functional-requirements.md](functional-requirements.md)                                       | Detailed, numbered functional requirements (FR-…) for every feature visible in the prototype: auth, feed, social graph, market cards, trading, portfolio, profiles, notifications — plus the list of known gaps (Section 15). |
| [functional-requirements-ceo.md](functional-requirements-ceo.md)                               | CEO MVP scope directive: the four must-work flows (register, follow, connect wallet, place one bet) — everything else may ship hardcoded as in the prototype.                                                                 |
| [testing-integration.md](testing-integration.md)                                               | API integration-testing strategy: Docker Compose test environment (Ganache, PostgreSQL, mocks), per-API coverage matrix, cross-API flow scenarios, data management, CI gates.                                                 |
| [ui-testing.md](ui-testing.md)                                                                 | End-to-end UI testing strategy: Playwright setup, injected test wallet, page objects, critical user journeys (J1–J8), component-behavior specs, browser/viewport matrix.                                                      |
| [testing-market-generator.md](testing-market-generator.md)                                     | Test/demo component that turns Google News headlines into randomly generated markets via the public APIs: news acquisition, templating, lifecycle automation (approve/trade/resolve), safety rails, configuration.            |
| [architecture-polymarket-platform-reference.md](architecture-polymarket-platform-reference.md) | How the **real Polymarket platform** works (from the official docs): APIs, CLOB order lifecycle, CTF outcome tokens, UMA resolution, auth, fees, WebSockets, contracts — and where our design differs (Section 10).           |
| [architecture-golang.md](architecture-golang.md)                                              | The **Chain Event Indexer** — a small Go service that is the single bridge from on-chain events (`MarketCreated`, `Trade`, `MarketResolved`, `Redeemed`) to the off-chain read path: pipeline design, delivery guarantees, schema, sync endpoint, failure modes, Base migration notes. |
| [team-composition.md](team-composition.md)                                                     | The largest team (48 seats) that can work in parallel without blocking: ownership boundaries per component, frozen-contract rules, Phase-0 bootstrap, dependency map, MVP critical-path subset, and the maximality argument.  |

## UML diagrams (PlantUML)

| Diagram                                                                    | Purpose                                                                                                                                                                                                |
|----------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [uml-components-layers.puml](uml-components-layers.puml)                   | Component diagram of the system layers: presentation (prototype pages and widgets), client integration (auth and wallet), application services, data, external services, and the blockchain.           |
| [uml-components-api.puml](uml-components-api.puml)                         | Component diagram of the planned API surface behind an API gateway; each interface lists representative endpoints and the FR items it serves.                                                          |
| [uml-components-smart-contracts.puml](uml-components-smart-contracts.puml) | Component diagram of the on-chain layer: market lifecycle (factory, prediction market, oracle resolver), trading & settlement (AMM, ERC-1155 outcome tokens, mock collateral), and platform contracts. |
| [uml-team-composition-flow.puml](uml-team-composition-flow.puml)           | Activity diagram of [team-composition.md](team-composition.md) as a parallel flow: Phase-0 contract freeze, then all 48 seats forked across the six groups, joining at integration checkpoints and the CEO MVP gate.            |

### Rendering the diagrams

The `.puml` files are [PlantUML](https://plantuml.com/) sources. To render them:

- **IDE:** the PlantUML plugin for IntelliJ IDEA or VS Code previews the files in place.
- **CLI:** `plantuml uml-components-*.puml` produces PNG files (`-tsvg` for SVG).
- **Online:** paste a file's contents into <https://www.plantuml.com/plantuml>.

## Architectural decisions

- **MVP blockchain — Ganache in Docker.** For the MVP, all on-chain interaction (wallet auth,
  trading settlement, contracts) targets a local **Ganache EVM node in Docker**
  (chain ID **1337**, JSON-RPC `:8545`) with mock ERC-20 collateral and a trusted manual oracle
  resolver. Migration to a public network (e.g., **Base**, chain ID 8453) with real collateral
  (USDC) and a decentralized oracle is deferred to a later phase. All three UML diagrams reflect
  this decision. Note: where the prose documents describe Base as the target chain (as analyzed
  from the prototype), they now carry inline MVP notes pointing back to this decision
  (`overview.md` §1/§3/§5; `functional-requirements.md` §1.2, FR-AUTH-4, §16).
- **Dev/test environment — `docker-compose.yaml` (repo root).** The canonical local environment:
  Ganache + PostgreSQL today; test-only services are planned additions per
  [testing-integration.md](testing-integration.md) §2.1.

## Suggested reading order

1. [overview.md](overview.md) — what the product is and who it serves.
2. [uml-components-layers.puml](uml-components-layers.puml) — how the system is structured.
3. [functional-requirements.md](functional-requirements.md) — what each feature must do.
4. [functional-requirements-ceo.md](functional-requirements-ceo.md) — which of those features must actually work
   in the MVP (this directive wins on MVP scope).
5. [uml-components-api.puml](uml-components-api.puml) — the API that backs those features.
6. [uml-components-smart-contracts.puml](uml-components-smart-contracts.puml) — the on-chain settlement layer.
7. [architecture-polymarket-platform-reference.md](architecture-polymarket-platform-reference.md) — how the real
   Polymarket implements the same mechanics, as a design reference.
