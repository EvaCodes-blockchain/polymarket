# PolyMarket Social ("Justify") — Team Composition (Maximum Parallel Team)

**Document version:** 1.1

**Date:** 2026-06-11

> **Status note (2026-06-11):** the working Claude Code agent team in `.claude/agents/` is now
> the **developer** instantiation of this composition — Groups B–F below (43 seats: `sc-*`,
> `be-*`, `fe-*`, `qa-*`, `devops-*`), plus a `dev-lead` orchestrator and a
> `documentation-engineer`. The previous five-agent **architects** team (Group A) was retired;
> its agent definitions are preserved verbatim in
> [team-architects-backup.md](team-architects-backup.md), which also maps each architect
> charter to its inheritor. Section 5 describes Group A as designed; coordination duties now
> sit with `dev-lead`.

**Source:** Derived from the component boundaries in
[uml-components-layers.puml](uml-components-layers.puml),
[uml-components-api.puml](uml-components-api.puml),
[uml-components-smart-contracts.puml](uml-components-smart-contracts.puml), the test-suite
decomposition in [testing-integration.md](testing-integration.md) §3.1 /
[ui-testing.md](ui-testing.md) §5–6 / [testing-market-generator.md](testing-market-generator.md),
and the MVP priorities in [functional-requirements-ceo.md](functional-requirements-ceo.md).

---

## 1. Purpose

This document describes the **largest team that can work on the project in parallel without
blocking each other**. "Without blocking" has a precise meaning here:

- every seat **exclusively owns** a disjoint set of components/files (single-writer rule —
  no two seats ever edit the same file);
- every dependency between seats is mediated by a **frozen artifact** (an OpenAPI contract,
  a Solidity interface + ABI, a DB schema namespace, a seed-fixture set, a deployed-address
  artifact), never by waiting for another seat's working code;
- anything that cannot be split without violating those two rules stays with one owner.

The result is **48 seats** in six groups (Section 9). The maximality argument — why splitting
further *would* introduce blocking — is in Section 10. The composition is also rendered as a
parallel-flow activity diagram in
[uml-team-composition-flow.puml](uml-team-composition-flow.puml).

A team this size is the ceiling, not a recommendation for day one. Section 8 marks the subset
that sits on the CEO's MVP critical path; every other seat works on areas that may ship
hardcoded per [functional-requirements-ceo.md](functional-requirements-ceo.md) §3 and can be
staffed (or not) independently.

---

## 2. Why this much parallelism is available

Three properties of the project make a wide team feasible:

1. **The architecture is already decomposed into small, contract-isolated components.**
   The API diagram defines 16 API components behind one gateway, each with its own endpoint
   surface and its own database access; the contracts diagram defines 8 contracts in three
   packages; the presentation layer is 8 page groups plus two client-integration components
   and one shared widget.
2. **The HTML prototype is a complete, read-only specification.** Every front-end and QA seat
   can start on day one against the running prototype (`docker compose up`, port `:3001`)
   without waiting for any backend — page objects, component specs, visual references, and
   `data-testid` plans all come from the prototype.
3. **The test strategy already mandates determinism and isolation** (fixed Ganache mnemonic
   and account roles, snapshot/revert chain isolation, per-module test directories, stubbed
   third parties), so test seats do not contend for shared mutable state.

---

## 3. Ground rules (what keeps 48 people unblocked)

These rules are preconditions for the composition below; the Chief Architect enforces them.

| # | Rule | Consequence |
|---|------|-------------|
| G1 | **Single writer.** Every file/dir has exactly one owning seat. Cross-cutting changes go through the owner. | No merge conflicts between seats. |
| G2 | **Contract-first.** All inter-seat dependencies are frozen in Phase 0 (Section 4): OpenAPI per API component, Solidity interfaces + event signatures, DB schema namespaces, fixture set, deployed-address artifact format. Changes after the freeze require Chief Architect sign-off and are versioned. | A consumer codes against the contract + a generated mock, never against the producer's branch. |
| G3 | **Mock everything you don't own.** Front-end seats run against OpenAPI-generated mock servers; backend seats stub the inter-API calls (`Engagement → Notifications`, `Creation → Markets`, etc.) at the frozen interface; integration testers sign wallet nonces with Ganache keys instead of browsers (testing-integration.md §2.4). | A seat's progress never depends on another seat's code being finished. |
| G4 | **One DB schema namespace per service.** Each backend seat owns its own migrations directory and schema; cross-service reads go through the owning API, not the tables. | Database work parallelizes with the services. |
| G5 | **Shared registries are append-only with one owner.** `docker-compose.yaml` (DevOps), gateway route table (Backend Platform), CI workflow files (DevOps), seed-fixture manifest (Test Infrastructure). Other seats submit additions as requests to the owner. | The four genuinely shared files cannot become contention points. |
| G6 | **The prototype is read-only.** `html-polymarket-social-prototype/` is the human-made source of truth; no seat edits it. The production web client is a new codebase that must visually match it. | The most-read artifact in the project is immune to write contention. |
| G7 | **The prototype's `js/custom.js` is not ported as one file.** Its behaviors are split along seat boundaries: card flip/payout → FE-2; follow toggles → FE-9; dark mode → FE-9; carousel → FE-5; wallet handlers → FE-4. | The one file in the prototype that would otherwise be a five-owner collision disappears. |

---

## 4. Phase 0 — the bootstrap (the only serialized work)

Maximum parallelism begins after a short bootstrap in which a small subset freezes the
contracts everyone else codes against. During Phase 0 the remaining seats are *not* idle —
they work against the prototype (page objects, component specs, test plans, visual styling)
and draft their own contracts for review.

| Phase-0 deliverable | Producing seat(s) | Unblocks |
|---|---|---|
| OpenAPI spec per API component (16 specs), incl. error model and auth header conventions | Each backend seat drafts own spec; ARCH-1 arbitrates and freezes | All FE seats (via generated mocks), all integration-test seats |
| Solidity interfaces, event signatures (`MarketCreated`, `Trade`, `MarketResolved`, `Redeemed`), MockUSDC decimals / cent-rounding / price-complement conventions (closes FR §15 item 13) | ARCH-2 with SC-1..3 | SC seats build against interfaces; BE-11/12/13 index events; QA fixtures |
| Deployed-address artifact format + seed-market fixture content | SC-3 + QA-1 | API config, integration suite, E2E suite |
| DB schema namespace allocation (one per service) | ARCH-1 + BP-1 | All backend seats migrate independently (G4) |
| Gateway skeleton: routing table format, session/JWT validation middleware, service scaffold template | BP-1 | All backend seats plug in routes without touching each other |
| Design tokens, three-column layout shell, page-module conventions, `data-testid` naming scheme | FE-1 with QA-7 | All FE page seats compose into the shell |
| `docker-compose.yaml` extension: `api`, `contracts`, `storage`, `oauth-mock`, `oracle-mock` services (testing-integration.md §2.1 note) | DO-1 | Integration suite stops being blocked on environment |

---

## 5. Group A — Architecture & coordination (5 seats)

These roles existed as Claude Code agent definitions in `.claude/agents/` until 2026-06-11,
when the agent team was switched to the developer seats of Groups B–F; the architect agent
definitions are archived in [team-architects-backup.md](team-architects-backup.md). The
charters below remain the design: they own **documents**, not production code, so they never
contend with implementation seats. In the current agent team, ARCH-1's coordination/change-control
duties are carried by the `dev-lead` agent.

| Seat | Role | Owns (exclusively) | Key responsibility |
|------|------|--------------------|--------------------|
| ARCH-1 | **Chief Architect** (`chief-architect`) | Contract-freeze register; arbitration decisions; consistency of all docs in `documentation_polymarket_social/` | Runs Phase 0; sole authority for post-freeze contract changes (G2); dispatches cross-component questions |
| ARCH-2 | **Blockchain Architect** (`blockchain-architect`) | Solidity interface specs, event catalog, collateral-invariant spec, Ganache→Base migration plan | The on-chain contract surface SC and BE seats code against |
| ARCH-3 | **Test Strategy Architect** (`test-strategy-architect`) | `testing-integration.md`, `ui-testing.md`, `testing-market-generator.md`, coverage matrices, CI gate definitions | Keeps the three test suites' scopes disjoint so QA seats don't double-cover |
| ARCH-4 | **Component/Repo Architect** (`component-repo-architect`) | `documentation_polymarket_social/repos/` (to be created): per-repo layout, boundaries, ownership records | Maintains the file-ownership matrix that makes G1 auditable |
| ARCH-5 | **Architecture Reviewer** (`architecture-reviewer`) | Deviation reports (new files only) | Read-only conformance audits after merges; reports, never edits code |

---

## 6. Implementation groups

### 6.1 Group B — Smart contracts (3 seats)

Split along the three packages of
[uml-components-smart-contracts.puml](uml-components-smart-contracts.puml). The
`PredictionMarket ↔ MarketAMM/OutcomeToken` coupling (share-pair minting against escrowed
collateral, the full-backing invariant) is exactly why the split stops at three: the seam
between SC-1 and SC-2 is held together by the frozen interfaces from ARCH-2, and the
collateral invariant is verified jointly in the shared-fixture tests owned by SC-3.

| Seat | Owns (exclusively) | Consumes (frozen) | Traceability |
|------|--------------------|-------------------|--------------|
| SC-1 | `MarketFactory`, `PredictionMarket`, `OracleResolver` + their unit tests | `IOutcomeToken`, `IMarketAMM`, `IAccessControl` interfaces | FR-CRT-1; market states Open/Closed/Resolved |
| SC-2 | `MarketAMM` (CPMM), `OutcomeToken` (ERC-1155), `CollateralToken` (MockUSDC) + unit tests | `IPredictionMarket`, `IFeeTreasury` interfaces | FR-CARD-2..3, FR-TRD-3, FR-PORT-2 |
| SC-3 | `FeeTreasury`, `AccessControl`; Truffle/Hardhat migrations; the `contracts` one-shot Docker image; seed markets + MockUSDC minting to accounts 2–5; deployed-address artifact | SC-1/SC-2 ABIs | testing-integration.md §2.2 account-role table |

### 6.2 Group C — Backend (17 seats)

One seat per API component of [uml-components-api.puml](uml-components-api.puml), plus a
platform seat. Each seat owns its service code, its OpenAPI file (post-freeze, changes via
ARCH-1), its DB schema namespace and migrations (G4), and its unit tests. Inter-API arrows in
the diagram (e.g. `Engagement → Notifications` for like/repost events) are consumed as frozen
internal contracts and stubbed during development (G3).

| Seat | Component(s) | Notes / external integrations | Traceability |
|------|--------------|-------------------------------|--------------|
| BP-1 | **Backend Platform & API Gateway** | Gateway (routing, rate limiting, session/JWT validation), service scaffold, shared libraries, route-table registry (G5) | Phase-0 critical |
| BE-1 | Auth API | Google OAuth token verification against `oauth-mock`/real | FR-AUTH-2, FR-AUTH-3; CEO-1 |
| BE-2 | Wallet Auth API | Nonce issue/verify, off-chain `ecrecover`, `eth_chainId` = 1337 check | FR-AUTH-4; CEO-1, CEO-3 |
| BE-3 | Users API | Profiles, settings | FR-PROF-1..6, FR-PORT-1 |
| BE-4 | Posts API ("Vogel") | Feed tabs, composer, 500-char limit; embeds market cards via Markets API contract | FR-FEED-1..5, FR-FEED-9 |
| BE-5 | Comments API | Post + market discussion threads, comment-level like/reply | FR-FEED-7, FR-TRD-4 |
| BE-6 | Engagement API | Post-level like/repost/share; emits notification events | FR-FEED-6 |
| BE-7 | Social Graph API | Follow/unfollow, follower lists, who-to-follow suggestions; emits follow events | FR-SOC-10..12, FR-NAV-5; CEO-2 |
| BE-8 | Markets API | Catalog, hashtags, movers; publishes approved markets | FR-MKT-1..3, FR-NAV-4 |
| BE-9 | Market Creation API | Request flow (name, description, photo, oracle proof, type) | FR-CRT-1 |
| BE-10 | Orders API | Buy flow → on-chain settlement via SC ABIs + address artifact | FR-CARD-2..3, FR-TRD-3; CEO-4 |
| BE-11 | Market Data API | `Trade` event indexer, AMM price reads, chart series | FR-CARD-1, FR-TRD-2 |
| BE-12 | Portfolio API | ERC-1155 balance reads, P&L vs Market Data prices | FR-PORT-2 |
| BE-13 | Notifications API | Consumes follow/like/repost events | FR-NOT-1 |
| BE-14 | Search API | Users, posts, markets | FR-NAV-3 |
| BE-15 | Media API | Uploads to MinIO (`storage`) | FR-FEED-3 |
| BE-16 | Support API | Help requests | FR-HELP-1 |

### 6.3 Group D — Web client (10 seats)

One seat per page group of the prototype, plus the three shared components (layout
foundation, market card, auth/wallet clients) that would otherwise be edited by everyone.
Every seat develops against OpenAPI-generated mocks (G3) and the running prototype as the
visual reference (G6); `custom.js` behaviors are divided per G7.

| Seat | Owns (exclusively) | Prototype reference | Traceability |
|------|--------------------|---------------------|--------------|
| FE-1 | **UI foundation & layout shell**: design tokens, Bootstrap theming, three-column responsive layout, header/nav/footer, off-canvas mobile nav | all pages | FR-NAV-1..2, FR-NAV-6; Phase-0 critical |
| FE-2 | **Embedded market-card widget**: card front, flip-to-trade form, amount/slider sync, payout calculator | feed/portfolio/profile cards | FR-CARD-1..3; CEO-4 |
| FE-3 | **Auth client**: sign-in modal, Google Identity Services, email stub, legal consent, language menu | sign-in modal | FR-AUTH-1..3, 5–6; CEO-1 |
| FE-4 | **Wallet connector**: Web3.js provider handling, MetaMask/injected flow, chain switch to 1337, error states | wallet modal | FR-AUTH-4; CEO-3 |
| FE-5 | **Feed page**: tabs (Feed/People/Trending), post cards, composer + comment/media modals, creator carousel, infinite scroll | `index.html` | FR-FEED-1..9 |
| FE-6 | **Markets page** + Market Movers widget | `market.html` | FR-MKT-1..3, FR-NAV-4 |
| FE-7 | **Trading page** (+ creator/founder variant): chart, timeframes, Buy/Sell ticket, market discussion | `trade.html`, `trade_founder.html` | FR-TRD-1..5 |
| FE-8 | **Portfolio page**: position blocks, color-coded P&L | `portfolio.html` | FR-PORT-1..2 |
| FE-9 | **Profile & settings**: profile header + follow button, four content tabs, edit-profile, dark mode persistence | `profile.html`, `edit-profile.html` | FR-PROF-1..6, FR-SOC-10..11; CEO-2 |
| FE-10 | **Secondary pages**: create-market form, notifications, help center, 404, global search box | `create.html`, `notification.html`, `help.html`, `404.html` | FR-CRT-1, FR-NOT-1, FR-HELP-1, FR-NAV-3, FR-NAV-7 |

### 6.4 Group E — QA & test automation (11 seats)

Mirrors the suite layouts already fixed in [testing-integration.md](testing-integration.md)
§3.1 and [ui-testing.md](ui-testing.md) §3/§5/§6, which were designed as disjoint
directories precisely so they can be owned independently.

| Seat | Owns (exclusively) | Notes |
|------|--------------------|-------|
| QA-1 | **Test infrastructure**: shared auth helper, canonical seed fixtures + manifest (G5), snapshot/revert harness, DB isolation helpers | Phase-0 critical; with SC-3 defines the fixture content both suites assert against |
| QA-2 | `tests/integration/auth/` + `tests/integration/users/` | Wallet handshake via Ganache keys, `oauth-mock` tokens |
| QA-3 | `tests/integration/social/` | Posts, Comments, Engagement, Social Graph |
| QA-4 | `tests/integration/markets/` + `tests/integration/trading/` | Incl. executed-trade pricing assertions |
| QA-5 | `tests/integration/portfolio/` + `tests/integration/support/` | Notifications, Search, Media, Support |
| QA-6 | `tests/integration/flows/` (cross-API scenarios §6.1–6.3) | Starts on scenario specs + fixtures day 1; executable once QA-2..5 helpers land — the one intentionally late-binding seat |
| QA-7 | **E2E framework**: Playwright config, injected test wallet, page objects, `data-testid` registry (with FE-1) | Page objects built against the prototype from day 1 |
| QA-8 | **E2E journeys** J1–J8 | Tier-1: J1, J5, J2/J3 (CEO mapping, ui-testing.md §5) |
| QA-9 | **E2E component-behavior specs** (ui-testing.md §6) | Card mechanics, tabs, modals, dark mode, responsive nav |
| QA-10 | **Market generator — acquisition & generation**: Google News fetching, dedup, headline→market templating, creator identity | testing-market-generator.md §3–4; pure consumer of public APIs — fully parallel |
| QA-11 | **Market generator — lifecycle & safety**: approval, background trading, closing, random resolution, safety rails, config | testing-market-generator.md §5–7 |

### 6.5 Group F — DevOps & CI (2 seats)

| Seat | Owns (exclusively) | Notes |
|------|--------------------|-------|
| DO-1 | `docker-compose.yaml` (G5 owner) + the missing test services: `api`, `storage` (MinIO), `oauth-mock` (WireMock), `oracle-mock`; image build configs | Closes the §2.1 "planned additions" blocker; `contracts` image content comes from SC-3, DO-1 owns its compose wiring |
| DO-2 | CI pipelines: build, unit/integration/E2E stages, flakiness policy enforcement, release gates on Tier-1 journeys | testing-integration.md §7.2, ui-testing.md §7 |

---

## 7. Dependency map (every cross-seat edge, and the artifact that decouples it)

| Consumer | Producer | Decoupling artifact (frozen in Phase 0) |
|----------|----------|------------------------------------------|
| All FE seats | All BE seats | OpenAPI specs → generated mock servers |
| All BE seats | BP-1 | Gateway scaffold + route registry (append-only) |
| BE-10/11/12, BE-2 | SC-1/2/3 | Solidity ABIs + deployed-address artifact + event catalog |
| SC-1 ↔ SC-2 | each other | Solidity interfaces owned by ARCH-2 |
| BE-6/7 → BE-13 | — | Frozen internal event contract, stubbed until integration |
| BE-9 → BE-8, BE-4 → BE-8, BE-12 → BE-11, BE-10 → BE-11 | — | Same: frozen internal API contracts, stubbed |
| QA-2..6 | DO-1, SC-3, QA-1 | Compose environment, seed fixtures, address artifact |
| QA-7..9 | FE seats | `data-testid` registry; until FE lands, specs run against the prototype |
| QA-10/11 | BE-8/9/10, oracle/admin endpoints | Public API contracts only (by design, testing-market-generator.md §2) |
| FE-2..10 | FE-1 | Design tokens + layout shell + module conventions |

No edge in this table requires a seat to wait for another seat's *implementation* — only for
Phase-0 artifacts or, in two flagged cases (QA-6 helpers, QA-7→FE `data-testid` wiring), for
work that has a prototype-based interim form.

---

## 8. MVP critical path (CEO directive)

Per [functional-requirements-ceo.md](functional-requirements-ceo.md), only CEO-1..4 must work
end-to-end. The seats on that critical path:

> **ARCH-1, ARCH-2 · SC-1, SC-2, SC-3 · BP-1, BE-1 (or BE-2), BE-7, BE-10, BE-11 (minimal
> prices), BE-12 (minimal position view) · FE-1, FE-2, FE-3 (or FE-4), FE-4, FE-9 (follow
> only) · QA-1, QA-2, QA-4, QA-7, QA-8 (J1/J5/J2 only) · DO-1, DO-2** — about 22 of 48 seats.

The other 26 seats work exclusively in hardcode-fallback areas (feed, discovery, charts,
notifications, search, media, support, generator, remaining journeys). That is what makes
them safely parallel even under MVP pressure: if their work slips, the MVP ships the
prototype's static behavior in their area, and nothing on the critical path waited for them.

---

## 9. Headcount summary

| Group | Seats |
|-------|-------|
| A — Architecture & coordination | 5 |
| B — Smart contracts | 3 |
| C — Backend (platform + 16 API components) | 17 |
| D — Web client | 10 |
| E — QA & test automation | 11 |
| F — DevOps & CI | 2 |
| **Total** | **48** |

---

## 10. Why not more (the maximality argument)

48 is the point where every further split breaks rule G1 or G2 — i.e., it would create two
writers on one file or a dependency on unfinished code:

- **Splitting an API component in two** (e.g. Orders into buy/sell) puts two owners on one
  endpoint surface, one schema, one service codebase. The Sell flow is additionally a known
  spec gap (functional-requirements.md §15 item 4) — see below.
- **Splitting `PredictionMarket` from `OutcomeToken`/`MarketAMM` ownership any further** —
  the mint-against-escrow collateral invariant spans them; finer splits make every invariant
  change a two-seat lockstep edit.
- **Splitting the market-card widget** (front vs flip form vs payout calculator) — one
  component, one file, one animation lifecycle; FR-CARD-1..3 are inseparable in code.
- **Two writers on a shared registry** (compose file, gateway routes, CI workflows,
  fixture manifest) — exactly the contention G5 exists to prevent.
- **Per-journey E2E owners (8 seats instead of 1)** — all journeys share page objects and
  fixtures; J-specs are thin (one spec each, ui-testing.md §5) and the contention would move
  into QA-7's files.
- **Unspecified areas cannot be staffed.** Admin/moderation UI and API, sell-flow
  differentiation, deposits/withdrawals, explore/tags/login pages, creator fee split, and
  avatar upload are catalogued gaps (functional-requirements.md §15; layers-diagram legend).
  Seats for them would block immediately on missing specifications. When ARCH-1 closes a gap
  with a spec, each one adds roughly one BE seat, one FE seat, and one QA module — the
  composition scales by the same ownership rules.

---

## 11. Coordination cadence

- **Contract change control** — any post-freeze change to an OpenAPI spec, Solidity
  interface, event signature, schema namespace, or fixture set goes through ARCH-1; the
  producer and all consumers are named on the change record. This is the single
  synchronization mechanism in steady state.
- **Conformance audits** — ARCH-5 reviews merged work against the prototype, the FR catalog,
  and the diagrams; deviation reports route back through ARCH-1.
- **Integration checkpoints** — QA-6 (cross-API flows) and QA-8 (journeys) act as the
  rolling integration probe: the first place a contract drift between two otherwise-unblocked
  seats becomes visible.
