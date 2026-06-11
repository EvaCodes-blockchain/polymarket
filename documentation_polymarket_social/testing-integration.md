# PolyMarket Social ("Justify") — API Integration Testing

**Document version:** 1.0

**Date:** 2026-06-11

**Scope:** Integration testing of the API surface defined in [uml-components-api.puml](uml-components-api.puml),
against the MVP infrastructure (Ganache in Docker — see [README.md](README.md), Architectural decisions).

---

## 1. Goals and scope

### 1.1 What integration tests verify

Integration tests exercise each API **through its public HTTP interface** together with its real collaborators:

- the **application database** (real instance, not mocked);
- the **Ganache EVM node** with the platform's smart contracts deployed (real chain, not mocked);
- **other platform APIs** the component depends on (e.g., Posts → Markets for embedded cards);
- **media storage** (real S3-compatible instance).

Only **third-party services outside our control** are replaced by test doubles: Google OAuth, wallet browser
extensions, and external oracle-proof URLs.

### 1.2 What is out of scope

- **Unit tests** — business logic in isolation; covered per service, not here.
- **End-to-end UI tests** — browser automation against the front end; separate test suite.
- **Load/performance tests** — separate concern; integration tests assert correctness, not throughput.

### 1.3 Test pyramid position

Integration tests are the contract-level safety net between unit tests and E2E: every endpoint of every API
component gets at least one happy-path and one failure-path test, and every cross-API flow listed in Section 6 is
covered by a scenario test.

---

## 2. Test environment

### 2.1 Docker Compose topology

The environment is described in the repository's `docker-compose.yaml` (extended with test-only services as
they are added) so that local runs and CI are identical:

| Service       | Image / source                  | Purpose                                                                                       |
|---------------|---------------------------------|-----------------------------------------------------------------------------------------------|
| `api`         | application image (built in CI) | The API under test, behind the same gateway config as production                              |
| `postgres`    | `postgres:16-alpine`            | Application database (database `justify`, user `justify`, password `justify`, port **5432**)  |
| `ganache`     | `trufflesuite/ganache:v7.9.2`   | Local EVM chain (chain ID **1337**, JSON-RPC `:8545`); pin matches `docker-compose.yaml`      |
| `contracts`   | migrations image                | One-shot: deploys smart contracts and seed fixtures to Ganache                                |
| `storage`     | MinIO (S3-compatible)           | Media storage                                                                                 |
| `oauth-mock`  | WireMock (or equivalent)        | Stubbed Google OAuth 2.0 / OIDC endpoints                                                     |
| `oracle-mock` | static HTTP server              | Serves fake oracle-proof pages for market-resolution tests                                    |

> **Note:** as of this writing, `docker-compose.yaml` provides `ganache` and `postgres`; the remaining
> services (`api`, `contracts`, `storage`, `oauth-mock`, `oracle-mock`) are planned additions that block
> the suite until added.

A test run is: `docker compose up -d --wait` from the repo root, run the suite, tear down.

### 2.2 Ganache configuration

Ganache must be started **deterministically** so tests can rely on known accounts:

- fixed mnemonic (`--wallet.mnemonic`), producing a stable set of pre-funded accounts;
- chain ID 1337, automining enabled (a transaction is mined immediately — no block-time waits in tests);
- well-known role assignment by account index:

| Account index | Role                                    |
|---------------|-----------------------------------------|
| 0             | Contract deployer / platform admin      |
| 1             | Trusted oracle resolver                 |
| 2–5           | Test traders (pre-funded with MockUSDC) |
| 6             | Market creator ("founder")              |

The `contracts` one-shot service deploys MarketFactory, CollateralToken (MockUSDC), and supporting contracts
(see [uml-components-smart-contracts.puml](uml-components-smart-contracts.puml)), mints MockUSDC to the trader
accounts, and writes the deployed addresses to a shared artifact consumed by both the API and the test suite.

### 2.3 Chain state isolation

Tests that mutate chain state use Ganache's snapshot/revert RPC:

- `evm_snapshot` in the suite's setup;
- `evm_revert` to that snapshot in teardown.

This keeps on-chain tests independent without redeploying contracts per test. Database isolation is handled
separately (Section 5).

### 2.4 Stubbing third parties

- **Google OAuth** — the `oauth-mock` service implements the token and JWKS endpoints; tests obtain valid-looking
  ID tokens for fictional users without touching Google. The API is pointed at the mock via configuration.
- **Wallets** — there is no browser in integration tests. Wallet authentication is tested by signing the nonce
  directly with a Ganache account's private key (the same signature MetaMask would produce).
- **Oracle sources** — `oracle-mock` serves deterministic pages used as `oracle proof` URLs in market-creation
  and resolution tests.

---

## 3. Conventions

### 3.1 Test organization

One test module per API component, mirroring the diagram:

```
tests/integration/
  auth/            # Auth API, Wallet Auth API
  users/           # Users API
  social/          # Posts, Comments, Engagement, Social Graph
  markets/         # Markets, Market Creation, Market Data
  trading/         # Orders API
  portfolio/       # Portfolio API
  support/         # Notifications, Search, Media, Support
  flows/           # cross-API scenarios (Section 6)
```

### 3.2 Naming and traceability

Every test references the functional requirement(s) it verifies in its name or metadata, e.g.
`test_card_payout_calculation__FR_CARD_3`. This keeps coverage auditable against
[functional-requirements.md](functional-requirements.md).

### 3.3 Authentication in tests

A shared helper performs the wallet-auth handshake (Section 4.1) once per test user and caches the session
token. Tests never hand-craft sessions or bypass the gateway — requests go through the same auth middleware as
production traffic.

---

## 4. Per-API test coverage

For each API component, the table lists the minimum scenarios. Failure paths (validation errors, unauthorized
access, not-found) are required for every endpoint and are not repeated in the table.

### 4.1 Identity & access

| API             | Key scenarios                                                                                                                                                                    |
|-----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Auth API        | Exchange a mock-Google ID token for a session (FR-AUTH-2); email flow start (FR-AUTH-3); rejected: expired/garbage token.                                                        |
| Wallet Auth API | Full handshake: request nonce → sign with Ganache key → verify → session issued (FR-AUTH-4); rejected: wrong signer, reused nonce, signature for a different chain ID than 1337. |
| Users API       | Read profile by handle (FR-PROF-1); update profile fields (FR-PROF-3); sensitive change requires password confirmation (FR-PROF-4); settings toggles persist (FR-PROF-5).        |

### 4.2 Social

| API              | Key scenarios                                                                                                                                                                                                                                                         |
|------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Posts API        | Create post within 500-char limit, reject over-limit (FR-FEED-3); feed tabs return correct content sets (FR-FEED-1); edit/delete own post only (FR-FEED-5); pagination for infinite scroll (FR-FEED-9); post embedding a market card returns market data (FR-CARD-1). |
| Comments API     | Comment on a post and on a market's trading page — same thread behavior (FR-FEED-7, FR-TRD-4); reply and like a comment.                                                                                                                                              |
| Engagement API   | Like/unlike, repost, share counters increment/decrement correctly and are idempotent per user (FR-FEED-6).                                                                                                                                                            |
| Social Graph API | Follow/unfollow toggling (FR-SOC-10); follower/following lists and counts (FR-SOC-11); who-to-follow excludes already-followed accounts (FR-NAV-5).                                                                                                                   |

### 4.3 Market & trading

| API                 | Key scenarios                                                                                                                                                                                                                        |
|---------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Markets API         | List live markets with hashtag filtering (FR-MKT-1, FR-MKT-2); market movers ranking (FR-NAV-4); market detail matches on-chain state (question, close time, outcome prices).                                                        |
| Market Creation API | Submit a request with all fields including oracle-proof URL (FR-CRT-1); submission lands in *pending* state (moderated flow); upon approval the market exists on-chain via MarketFactory and appears in the Markets API.             |
| Orders API          | Buy an outcome: MockUSDC balance decreases, outcome tokens minted, on-chain `Trade` event emitted (FR-CARD-2, FR-TRD-3); the quoted projected payout matches `amount / displayed price` to two decimals (FR-CARD-3 is a UI projection at spot price); executed trades follow CPMM pricing — assert collateral in ≈ Σ(execution price × shares) within the documented rounding tolerance, and shares received ≤ amount / pre-trade spot price; sell path; rejected: amount below minimum, market closed. Exact rounding tolerances are pending the pricing/rounding specification ([functional-requirements.md](functional-requirements.md) Section 15, item 13). |
| Market Data API     | Prices reflect AMM pool state after a trade moves the price; chart endpoint returns series for every timeframe 1H–ALL (FR-TRD-2).                                                                                                    |
| Portfolio API       | After trades, positions report amount, current price, value, and unrealized P&L consistent with chain state (FR-PORT-2); P&L sign flips correctly after adverse price movement.                                                      |

### 4.4 Supporting

| API               | Key scenarios                                                                                                                                        |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| Notifications API | Follow, like, and repost by another user each produce exactly one notification for the right recipient (FR-NOT-1); no notification for self-actions. |
| Search API        | Query matches users, posts, and markets (FR-NAV-3); empty result set is a valid 200 response.                                                        |
| Media API         | Upload an image, receive a URL, object exists in storage (FR-FEED-3); rejected: unsupported type, oversized payload.                                 |
| Support API       | Submit a help request, record persisted (FR-HELP-1).                                                                                                 |

---

## 5. Data management

- **Database:** each test (or test class) runs against a known fixture state. Reset strategy: truncate and re-seed
  between modules; faster per-test isolation via transaction rollback where the stack allows it.
- **Fixtures:** a canonical seed set mirroring the prototype's demo data — a handful of users (trader, founder,
  verified influencer), a followed/follower graph, several posts, and two seeded markets (one generic Yes/No,
  one with named outcomes) so card- and trading-related tests have realistic data. The generic Yes/No market is
  seeded at **Yes = 21¢ / No = 79¢** — complementary prices summing to 100¢, as a CPMM requires; the FR-CARD-3
  example pair 21¢/80¢ is hard-coded prototype display data, not a valid simultaneous AMM state (see
  [functional-requirements.md](functional-requirements.md) Section 15, item 13). Fixture prices are part of the
  canonical seed contract shared with the UI suite ([ui-testing.md](testing-ui) Section 4).
- **Chain:** snapshot/revert per suite (Section 2.3). Tests must not depend on ordering; any test that needs a
  fresh market creates one through the Market Creation API rather than reusing a seeded one.
- **Clock:** market close times in fixtures are far-future; tests that need a *closed* market use Ganache's
  `evm_increaseTime` + a mined block rather than waiting.

---

## 6. Cross-API flow scenarios

These end-to-end-through-the-API scenarios live in `tests/integration/flows/` and are the primary regression
gate for releases. Each step asserts both the API response and, where applicable, the resulting on-chain state.

### 6.1 Market lifecycle (the core flow)

1. Founder authenticates via wallet handshake (Wallet Auth API).
2. Founder submits a market-creation request with an `oracle-mock` proof URL (Market Creation API).
3. Admin approves the request → MarketFactory deploys the market; Markets API lists it as *Live*.
4. Trader buys *Yes* (Orders API) → Market Data API shows the price moved; Portfolio API shows the position.
5. Time is advanced past close (`evm_increaseTime`); market state becomes *Closed*.
6. Oracle-resolver account resolves the market to *Yes* (direct OracleResolver contract call from Ganache
   account 1; a platform resolution endpoint is not yet specified — see Section 8).
7. Trader redeems → MockUSDC balance increases by `shares × $1`; Portfolio API no longer lists the position.
8. Notifications API delivered the market-resolution notification (when implemented — required by FR-NOT-1's
   production extensions; tracked in [functional-requirements.md](functional-requirements.md) Section 15,
   item 11).

### 6.2 Social trading from the feed

1. Founder creates a post embedding their market (Posts API).
2. Trader's feed contains the post with live market-card data: volume, close time, chance (FR-CARD-1).
3. Trader buys from the card with amount 10 → the card's projected payout equals `10 / displayed price` to two
   decimals (FR-CARD-3); the executed trade reports actual shares and average price from the CPMM, with
   slippage within the configured bound.
4. Trader comments on the post; founder receives engagement counters and (when implemented) a notification.

### 6.3 Social graph propagation

1. User A follows user B → B's follower count increments; A's feed now includes B's posts; B gets a follow
   notification.
2. User A reposts B's post → repost counter increments; the repost appears in A's profile *Ree-Vogel* tab
   (FR-PROF-2); B gets a repost notification.

---

## 7. Running the tests

### 7.1 Locally

From the repo root:

```bash
docker compose up -d --wait
<test-runner> tests/integration          # the project's test command
docker compose down -v
```

### 7.2 In CI

The same compose file runs in the CI pipeline on every pull request. Gates:

- the full integration suite must pass before merge to `main`;
- the flow scenarios (Section 6) additionally run against the release candidate before deployment;
- test results are published with FR-tag annotations (Section 3.2) so requirement coverage is visible per run.

**Tier note (CEO directive, [functional-requirements-ceo.md](functional-requirements-ceo.md) Section 4):**
Tier-1 (MVP-blocking) = wallet-auth, social-graph follow, and order/portfolio scenarios plus flow 6.2;
flow 6.1 (market creation) is Tier-2 because the MVP market may be seeded manually (CEO-4 minimum bar).
Full per-endpoint coverage remains the post-MVP target.

### 7.3 Flakiness policy

Automining and deterministic accounts remove the usual blockchain flakiness sources. A test that fails
intermittently is treated as a defect (of the test or the API), not retried-until-green: retries mask real
race conditions in event indexing and counter updates.

---

## 8. Open items

- **Backend stack is not yet chosen**; this document is intentionally stack-agnostic. Once the implementation
  language/framework is fixed, add the concrete test-runner, HTTP-client, and fixture tooling here.
- **Admin/moderation API** (market approval, Section 15 of the functional requirements) is unspecified; flow 6.1
  step 3 currently assumes a minimal approval endpoint that must be defined.
- **Resolution endpoint** — flow 6.1 step 6 currently uses a direct contract call; whether the platform exposes
  a resolution API is unspecified, same status as the approval endpoint.
- **Event-indexing latency**: if market data/portfolio are fed by an asynchronous event indexer, tests need an
  explicit "indexer caught up" synchronization helper instead of sleeps — to be designed with the indexer.
