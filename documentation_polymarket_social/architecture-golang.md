# Chain Event Indexer — Go Component Architecture

**Document version:** 1.1

**Date:** 2026-06-11

**Sources:** [uml-components-smart-contracts.puml](uml-components-smart-contracts.puml),
[uml-components-api.puml](uml-components-api.puml),
[testing-integration.md](testing-integration.md) §6 ("Event-indexing latency"),
[team-composition.md](team-composition.md) (seat BE-11),
[architecture-polymarket-platform-reference.md](architecture-polymarket-platform-reference.md),
[go_pysyun_pipeline](https://github.com/pysyun/go_pysyun_pipeline),
[ethbacknode](https://github.com/ITProLabDev/ethbacknode)

A pinned snapshot of the two upstream components' technical contracts (API methods, callback
payload schemas, pipeline API and behavioral guarantees, license caveats) is kept in
[reference-upstream-go-components.md](reference-upstream-go-components.md); it partially
resolves open items 4–6 of Section 10.

This document specifies the **Chain Event Indexer** (working name: `chain-indexer`) — a small,
standalone backend service written in **Go** that is the single bridge between the on-chain world
and the off-chain read path. It subscribes to the contract events emitted on the Ganache EVM node
(`MarketCreated`, `Trade`, `MarketResolved`, `Redeemed` — see
[uml-components-smart-contracts.puml](uml-components-smart-contracts.puml)), decodes them, and
persists them into an indexer-owned database schema that the Market Data, Portfolio, Markets, and
Notifications APIs read from.

The service is built on two existing Go components rather than from scratch:

- **[ethbacknode](https://github.com/ITProLabDev/ethbacknode)** — a backend microservice for
  interacting with Ethereum nodes (block/transaction monitoring, address subscriptions,
  confirmations). It runs as a sidecar between the indexer and the EVM node and pushes
  `blockEvent` / `transactionEvent` HTTP callbacks, replacing a hand-rolled head-polling loop.
- **[go_pysyun_pipeline](https://github.com/pysyun/go_pysyun_pipeline)** — a minimalist pipeline
  library (`Processor` / `Chainable` / `ChainableGroup` / `PipelineNode` with `Delta` profiling).
  The indexer's ingest → decode → persist flow is composed from its stages, replacing hand-rolled
  goroutine/channel plumbing.

---

## 1. Why this component is critical

The component diagrams show one arrow that everything user-visible hangs off:

> `Backend --> Events : index events (market data, portfolio, notifications)`

Every number a user sees that originates on-chain flows through this service:

| Consumer | What it reads from the indexer | Requirement |
|----------|--------------------------------|-------------|
| **Market Data API** (BE-11) | Trade history → price chart series; latest AMM price per market | FR-CARD-1 (live "chance" gauge on feed cards), FR-TRD-2 (1H–ALL chart) |
| **Portfolio API** (BE-12) | Position deltas from `Trade`/`Redeemed`; cost basis for P&L | FR-PORT-2 (amount, price, value, P&L) |
| **Markets API** (BE-10) | Market registry from `MarketCreated`; state transitions from `MarketResolved` | FR-MKT-1..3, FR-NAV-4 ("Market Movers" needs volume) |
| **Notifications API** (BE-13) | Market-resolution and trade-confirmation events | FR-NOT-1 production extensions (Section 15, item 11) |

If the indexer lags, the feed shows stale prices; if it drops an event, a user's portfolio is
simply wrong — and a wrong P&L on a trading product is a trust-destroying defect, not a cosmetic
one. At the same time the service is deliberately **small**: its inputs are the chain (via the
ethbacknode sidecar's callbacks plus `eth_getLogs`), its output is its own DB schema plus a sync
endpoint, and it has no business logic beyond decode-and-store.
That combination — tiny surface, total criticality — is what makes it worth isolating and
hardening as its own component.

### Why Go

- **Concurrency model fits the workload exactly:** goroutines for callback handling, reconcile
  ticks, and pipeline stages, communicating over channels — no async framework needed.
- **First-class EVM tooling:** `go-ethereum` is the reference Ethereum implementation;
  `abigen` generates type-safe Go bindings directly from the frozen contract ABIs (Phase-0
  artifact, [team-composition.md](team-composition.md) Section 4), so decoding bugs become
  compile-time errors.
- **Reusable Go building blocks:** both selected foundations are Go —
  [ethbacknode](https://github.com/ITProLabDev/ethbacknode) for node interaction and
  [go_pysyun_pipeline](https://github.com/pysyun/go_pysyun_pipeline) for stage composition — so
  the indexer mostly wires existing components instead of writing infrastructure.
- **Operational profile:** a single static binary with a tiny memory footprint that runs for
  weeks; trivially packaged into the `docker-compose.yaml` test environment that integration
  tests already depend on.
- **Backpressure-safe by construction:** blocking channels mean a slow database naturally slows
  the reader instead of buffering events into OOM.

The rest of the backend stack is unconstrained by this choice: consumers read PostgreSQL tables
and an HTTP sync endpoint, not Go interfaces.

---

## 2. Position in the system

```
Ganache EVM node (chain 1337, :8545)
        │  Ethereum JSON-RPC
        ▼
┌────────────────────────────┐
│   ethbacknode (sidecar)    │   block/transaction monitoring,
│   JSON-RPC 2.0 service     │   confirmations, watchdog
└────────────────────────────┘
        │  HTTP callbacks: blockEvent / transactionEvent
        │  (at-least-once; indexer deduplicates)
        ▼
┌──────────────────────────────────────────────┐
│   chain-indexer (Go)                         │
│   go_pysyun_pipeline stages:                 │
│   ingest → backfill → decode → persist       │
└──────────────────────────────────────────────┘
        │                       │
        ▼                       ▼
 PostgreSQL                HTTP :8090
 schema `indexer`          /healthz, /status, /synced, /callbacks/*
        │
        ▼
 Market Data API · Portfolio API · Markets API · Notifications API
 (read-only consumers of the `indexer` schema)
```

Boundary rules (inherits the global guardrails of
[team-composition.md](team-composition.md) Section 3):

- The indexer–chain path **only reads**. ethbacknode is deployed in **monitoring-only**
  configuration: its transfer/signing surface (`transferAssets`, `addressGetNew`,
  `addressRecover`) is unused and must be unreachable from outside the indexer host (the
  ethbacknode README itself warns against exposing signing endpoints). The indexer calls only
  read/query methods (`infoGetBlockNum`, `addressSubscribe`, `transferInfo*`) plus direct
  `eth_getLogs`/`eth_call` against the node for log backfill and enrichment. Trade submission
  stays in the Orders API; market resolution stays with the trusted resolver account.
- The indexer **owns** the `indexer` PostgreSQL schema and its migrations (guardrail G4: one
  schema namespace per service). Consumers get read-only grants on it; they never write to it.
- Consumers needing derived aggregates (candlesticks, leaderboards) compute them on their side
  from the raw tables — the indexer stores facts, not projections, so consumer-specific logic
  cannot creep into the critical path.
- ethbacknode is the only component that talks to the node continuously; the indexer's direct
  RPC use is limited to range queries (`eth_getLogs`) that ethbacknode's
  event-oriented API does not cover (it is a monitor, not a historical log indexer).

### Note on seat ownership

[team-composition.md](team-composition.md) lists the "`Trade` event indexer" inside seat BE-11
(Market Data API). This document factors that work out into a standalone service because three
other seats (BE-10, BE-12, BE-13) need the same event stream, and duplicating chain-reading logic
per API would violate single-writer economics. The service remains a **single seat's property**
(BE-11 by default, per guardrail G1); the other seats consume its frozen contract: the `indexer`
schema DDL plus the sync endpoint, both frozen in Phase 0 alongside the Solidity event catalog.

---

## 3. Responsibilities and non-responsibilities

**Does:**

1. Receive `blockEvent` / `transactionEvent` callbacks from the ethbacknode sidecar as the
   "new work available" signal, and ingest every log emitted by the deployed contracts from the
   deployment block onward via `eth_getLogs` backfill — no gaps, no duplicates (effective
   exactly-once via idempotent writes; ethbacknode delivery is at-least-once by design, so the
   indexer deduplicates).
2. Decode logs with `abigen`-generated bindings for the four cataloged events:
   `MarketCreated`, `Trade`, `MarketResolved`, `Redeemed`.
3. Persist decoded events plus a per-block checkpoint in one transaction.
4. Maintain current-state convenience tables (`markets`, `positions`) derived only from those
   events, updated in the same transaction.
5. Expose sync status over HTTP for health checks and for the integration-test
   "indexer caught up" helper ([testing-integration.md](testing-integration.md) §6).
6. Survive restarts of itself, ethbacknode, and Ganache: resume from the checkpoint (the
   `eth_getLogs` backfill path covers callbacks missed while down), or detect a chain reset
   (new genesis) and reindex from scratch — Ganache in Docker loses state on recreate.

**Does not:**

- Serve end-user traffic (consumers' APIs do).
- Compute prices, P&L, fees, or rounding. Amounts are stored as raw `NUMERIC(78,0)` integer
  base units exactly as emitted; the cent-rounding and price-complement conventions are an open
  Phase-0 item ([functional-requirements.md](functional-requirements.md) Section 15, item 13)
  and must not be baked into stored data.
- Send transactions or hold keys (see boundary rules above).
- Push notifications itself — it records resolution/trade facts; the Notifications API polls or
  tails them (delivery mechanism is that seat's contract).

---

## 4. Internal design

### 4.1 Pipeline

The processing flow is composed from
[go_pysyun_pipeline](https://github.com/pysyun/go_pysyun_pipeline) stages instead of hand-rolled
goroutine/channel plumbing. Each stage is a `Processor` (`Process(data any) any`); the linear
flow is built with `Chainable.Pipe` (or the variadic `pysyun.Pipe(...)`):

```go
import pysyun "github.com/pysyun/go_pysyun_pipeline"

// per block range: trigger → fetch logs → decode → persist
ingest := pysyun.Pipe(
    pysyun.NewChainable(&RangePlanner{}),   // callback/backfill → []BlockRange
    pysyun.NewChainable(&LogFetcher{}),     // BlockRange → []types.Log (eth_getLogs)
    pysyun.NewChainable(&LogDecoder{}),     // []types.Log → []DecodedEvent (abigen)
    pysyun.NewChainable(&BatchWriter{}),    // []DecodedEvent → checkpoint (one DB tx)
)
```

- **RangePlanner** — turns the trigger (an ethbacknode `blockEvent` callback, or the startup
  backfill) into block ranges `[checkpoint+1, head]`, chunked to at most `MAX_BLOCK_RANGE`
  (default 2 000) blocks per `eth_getLogs` call. The chain head comes from the callback payload
  or from ethbacknode's `infoGetBlockNum`; there is no head-polling loop of our own.
- **LogFetcher** — requests `eth_getLogs` for the watched address set over each range. Disjoint
  ranges during a large backfill can be fanned out with `ChainableGroup` (which preserves input
  order), bounded by `FETCH_CONCURRENCY`; the MVP default is 1, since Ganache RPC is local and
  fast.
- **LogDecoder** — matches each log's `topics[0]` against the `abigen`-generated bindings and
  produces typed event records. An unrecognized log from a watched address is a **fatal error**,
  not a skip: it means the deployed ABI and the frozen event catalog have diverged, and
  continuing would silently corrupt downstream data.
- **BatchWriter** — batches decoded events per block range and commits **one database
  transaction** per batch: insert events, upsert state tables, advance the checkpoint. The
  checkpoint moving only inside the same transaction as the data is the core correctness
  mechanism. The writer stage is always single-instance — never inside a `ChainableGroup` — so
  ordering is trivial.

Two pipeline-library conventions for this codebase:

- **Errors.** `Processor.Process` has an `any → any` signature with no error return; stages pass
  a `Result{Value any; Err error}` envelope, and every stage short-circuits (passes the envelope
  through untouched) when `Err != nil`. The pipeline runner inspects the final envelope and
  applies the retry policy (Section 7).
- **Profiling.** The graph form (`PipelineNode` + `Delta`) is used in the integration-test
  harness, where per-stage `Delta.Duration` / `Delta.ItemDelta` identify which stage lags when
  the `/synced` helper times out. The production binary uses the plain `Chainable` form plus
  Prometheus metrics.

### 4.2 Delivery guarantees

- **At-least-once fetch, exactly-once effect.** ethbacknode's callback delivery is explicitly
  at-least-once, and crash-replays of the backfill path re-fetch ranges; both are absorbed by the
  same mechanism. Every event row has a natural primary key `(tx_hash, log_index)`; replays
  become `ON CONFLICT DO NOTHING` no-ops, and state-table updates are derived inside the same
  transaction, so they apply at most once. Duplicate or out-of-order callbacks at worst trigger a
  redundant `RangePlanner` run that plans an empty range.
- **Callbacks are triggers, not data.** A `blockEvent`/`transactionEvent` callback only tells the
  pipeline "the head moved"; the events themselves always come from `eth_getLogs` over
  checkpoint-anchored ranges. A lost callback therefore delays indexing until the next callback
  (or the periodic reconcile tick, `RECONCILE_INTERVAL`, default 5 s) but can never cause a gap.
- **Ordering.** Events apply in `(block_number, log_index)` order within the single `BatchWriter`
  stage. There is no parallel writing — at our scale (one Ganache node, AMM trades) the
  bottleneck is RPC latency, not the database, and a single writer makes ordering trivial.
- **Reorg stance.** Ganache (chain 1337) does not reorg, so MVP confirmation depth is 0. The
  pipeline nevertheless records each block's hash and verifies the parent-hash chain; a mismatch
  triggers rollback-to-last-matching-block logic. ethbacknode's own confirmation tracking
  (mempool → confirmed states) becomes useful on a real network, where `CONFIRMATION_DEPTH=N`
  delays indexing until depth N. On Ganache the only "reorg" is a full chain reset (Docker
  recreate), detected by a genesis-hash change → truncate schema, reindex. This same code path
  is the Base migration story (Section 8).

### 4.3 Data model (schema `indexer`)

```sql
-- append-only event log (source of truth)
events_market_created (block_number, block_time, tx_hash, log_index,
                       market_addr, amm_addr, creator, question_id, close_time,
                       PRIMARY KEY (tx_hash, log_index))
events_trade          (block_number, block_time, tx_hash, log_index,
                       market_addr, trader, outcome, side,
                       collateral_amount NUMERIC(78,0), share_amount NUMERIC(78,0),
                       PRIMARY KEY (tx_hash, log_index))
events_market_resolved(block_number, block_time, tx_hash, log_index,
                       market_addr, winning_outcome, resolver,
                       PRIMARY KEY (tx_hash, log_index))
events_redeemed       (block_number, block_time, tx_hash, log_index,
                       market_addr, redeemer, share_amount NUMERIC(78,0),
                       payout_amount NUMERIC(78,0),
                       PRIMARY KEY (tx_hash, log_index))

-- derived current state (rebuildable from the event tables)
markets   (market_addr PRIMARY KEY, amm_addr, creator, question_id, close_time,
           state,            -- open | closed | resolved
           winning_outcome, total_volume NUMERIC(78,0), last_trade_block)
positions (market_addr, account, outcome, share_balance NUMERIC(78,0),
           cost_basis NUMERIC(78,0), PRIMARY KEY (market_addr, account, outcome))

-- bookkeeping
checkpoint (singleton: last_block, last_block_hash, genesis_hash, updated_at)
```

Exact event field lists follow the Phase-0 Solidity event catalog (ARCH-2 deliverable,
[team-composition.md](team-composition.md) Section 4) — the columns above are the working
assumption and must be reconciled when that catalog freezes.

### 4.4 Sync endpoint (HTTP :8090)

| Endpoint | Purpose |
|----------|---------|
| `GET /healthz` | Liveness: process up, DB reachable, ethbacknode reachable (`ping`). |
| `GET /status` | `{ "chain_head": N, "indexed": M, "lag_blocks": N-M, "genesis": "0x…" }`. |
| `GET /synced?block=N&timeout=30s` | **Long-polls** until `indexed ≥ N`, then returns 200; 504 on timeout. |
| `POST /callbacks/ethbacknode` | Receiver for ethbacknode `blockEvent` / `transactionEvent` callbacks; enqueues a `RangePlanner` trigger and returns 200 immediately. Bound to the internal network only. |

`/synced` is the "indexer caught up" synchronization helper that
[testing-integration.md](testing-integration.md) §6 requires instead of sleeps: an integration
test submits a trade, takes the transaction's block number from the receipt, calls
`GET /synced?block=N`, and only then asserts on Market Data / Portfolio responses.

---

## 5. Repository layout

Standard Go service layout; one module, no shared internal packages with other repos:

```
chain-indexer/
├── cmd/indexer/main.go        # wiring: config, pipeline assembly (pysyun.Pipe),
│                              # HTTP server, graceful shutdown
├── internal/
│   ├── stages/                # go_pysyun_pipeline Processors:
│   │   ├── planner.go         #   RangePlanner — triggers → block ranges
│   │   ├── fetcher.go         #   LogFetcher — eth_getLogs, parent-hash check
│   │   ├── decoder.go         #   LogDecoder — topic dispatch over generated bindings
│   │   └── writer.go          #   BatchWriter — batching, transactions, checkpoint
│   ├── ebn/                   # ethbacknode JSON-RPC 2.0 client (ping, infoGetBlockNum,
│   │                          # addressSubscribe) + callback payload types
│   ├── store/                 # pgx repositories, migrations (embedded, golang-migrate)
│   └── httpapi/               # /healthz /status /synced /callbacks/ethbacknode
├── bindings/                  # abigen output — GENERATED, regenerated from frozen ABIs
├── migrations/                # SQL migrations for schema `indexer`
├── Dockerfile                 # multi-stage, distroless final image
└── Makefile                   # make bindings | test | integration-test | lint
```

ethbacknode itself is deployed from its own repository
(<https://github.com/ITProLabDev/ethbacknode>) as a separate process, configured via its
`config.json`; it is a deployment dependency, not a code dependency (the indexer talks to it
over JSON-RPC 2.0 and receives its HTTP callbacks).

## 6. Technology stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Language | **Go ≥ 1.22** | single static binary |
| Node interaction | **[ethbacknode](https://github.com/ITProLabDev/ethbacknode)** sidecar (JSON-RPC 2.0 + HTTP callbacks) | block/transaction monitoring, confirmations, watchdog; deployed monitoring-only — transfer/key methods unused and not network-reachable |
| Pipeline composition | **[go_pysyun_pipeline](https://github.com/pysyun/go_pysyun_pipeline)** (`Chainable`, `ChainableGroup`, `PipelineNode`) | `go get github.com/pysyun/go_pysyun_pipeline`; LGPL-2.1 — used as an unmodified imported library |
| Log decoding | `github.com/ethereum/go-ethereum` (`ethclient`, `abigen`) | bindings regenerated from the Phase-0 ABI artifact; generated code is committed; also used for direct `eth_getLogs` backfill |
| Database | PostgreSQL via `jackc/pgx/v5` | same PostgreSQL instance as the rest of the platform (`docker-compose.yaml`), dedicated schema |
| Migrations | `golang-migrate`, embedded via `embed.FS` | indexer migrates its own schema on start |
| HTTP | `net/http` (stdlib) | four endpoints do not justify a framework |
| Config | environment variables only | `RPC_URL`, `ETHBACKNODE_URL`, `CALLBACK_LISTEN_ADDR`, `DATABASE_URL`, `CONTRACT_ADDRESSES_FILE` (the Phase-0 deployed-address artifact), `RECONCILE_INTERVAL`, `MAX_BLOCK_RANGE`, `FETCH_CONCURRENCY`, `CONFIRMATION_DEPTH` |
| Observability | `log/slog` JSON logs; Prometheus metrics (`indexer_lag_blocks`, `indexer_events_total{type}`, `indexer_rpc_errors_total`, `indexer_callbacks_total`); per-stage `Delta` profiling in the test harness | `indexer_lag_blocks` is the alerting signal |

## 7. Failure modes

| Failure | Behavior |
|---------|----------|
| RPC down / flaky | Exponential backoff with jitter, retry forever; `/healthz` degrades, lag metric grows. Never skip a range. |
| ethbacknode down / restarting | Callbacks stop; the periodic reconcile tick keeps planning ranges directly from `eth_getLogs`, so indexing degrades to polling instead of stopping. `/healthz` reports the sidecar as degraded (`ping` fails). On recovery, missed callbacks are irrelevant (§4.2 — callbacks are triggers, not data). |
| Lost / duplicate / reordered callbacks | By design (at-least-once): duplicates plan empty ranges; losses are covered by the reconcile tick; ordering is irrelevant since ranges are checkpoint-anchored. |
| DB down | Same backoff; the pipeline run fails at `BatchWriter` and the range is re-planned (natural backpressure — no checkpoint advance, no loss). |
| Process crash / redeploy | Resume from `checkpoint`; replays are idempotent (§4.2). |
| Ganache recreated (fresh chain) | Genesis-hash mismatch → truncate `indexer` schema, reindex from block 0, log loudly. ethbacknode must be restarted alongside the node (its subscriptions reference the old chain). |
| Unknown event from watched contract | Fatal: exit non-zero. ABI/catalog divergence must fail loudly in CI, not skip silently in prod (no-silent-drop rule). |
| Consumer reads while behind | Consumers' responsibility: `/status.lag_blocks` is exposed; the UI requirement for freshness is an open product gap ([functional-requirements.md](functional-requirements.md) Section 15, item 12 — live-update channel). |

## 8. Ganache → Base migration notes

Per the platform decision ([README.md](README.md), Architectural decisions), the MVP targets
Ganache; this service is the component most affected by the move to Base (chain 8453):

1. **Finality:** set `CONFIRMATION_DEPTH` > 0 and rely on the parent-hash/rollback path already
   built (§4.2) — reorgs become real. ethbacknode's confirmation tracking (mempool → confirmed
   transaction states) carries most of this for free.
2. **Transport:** ethbacknode is designed to run **on the same host as the node over IPC**
   (`geth.ipc`) — its recommended production topology. On Base this means co-locating ethbacknode
   with the node (or pointing it at a provider's RPC), while the indexer keeps receiving the same
   callbacks; the indexer's own `eth_getLogs` backfill remains the source of truth across any
   disconnects. Note ethbacknode's Docker support is deferred because of the IPC dependency —
   the production topology must account for that (host process or shared network namespace).
3. **Provider limits:** public RPC providers cap `eth_getLogs` ranges and rates;
   `MAX_BLOCK_RANGE` and backoff are already configurable.
4. **Throughput:** if event volume outgrows the single writer, raise `FETCH_CONCURRENCY`
   (fan out `LogFetcher` over disjoint ranges via `ChainableGroup`) and, if writing itself
   becomes the bottleneck, partition `BatchWriter` by `market_addr` (per-market ordering is the
   only ordering consumers actually need).

Nothing in the consumer contract (schema + sync endpoint) changes.

## 9. Testing strategy (summary)

Aligned with [testing-integration.md](testing-integration.md); a full test plan is the
test-strategy-architect's deliverable.

- **Unit:** each pipeline stage is a plain `Processor` — unit-testable in isolation by calling
  `Process` with fixture inputs, no harness needed (a key payoff of the pipeline library).
  Decoder against fixture logs generated from the bindings; writer idempotency (double-apply a
  batch, assert identical state); checkpoint/rollback logic with simulated parent-hash
  mismatches; `RangePlanner` against duplicate/out-of-order callback fixtures. Use
  `go-ethereum`'s `simulated` backend where a live chain is overkill.
- **Integration (Docker Compose):** run the real ethbacknode sidecar against Ganache, deploy
  contracts, emit each cataloged event, assert rows and state tables; kill -9 the indexer
  mid-range and assert gapless resume; stop ethbacknode and assert the reconcile tick keeps
  indexing; recreate Ganache and assert clean reindex. The harness assembles the same stages in
  `PipelineNode` graph form to expose per-stage `Delta` timings when diagnosing `/synced`
  timeouts.
- **CI gate:** the indexer's integration suite runs in the same pipeline stage as the API
  integration tests, since those tests depend on `/synced`.

## 10. Open items

1. Final event field lists await the Phase-0 Solidity event catalog (ARCH-2,
   [team-composition.md](team-composition.md) Section 4) — §4.3 must be reconciled then.
2. Whether Notifications API tails the event tables (`LISTEN/NOTIFY`) or polls is BE-13's call;
   the indexer commits per-batch either way.
3. Decimals/rounding conventions ([functional-requirements.md](functional-requirements.md)
   Section 15, item 13) — the indexer stores raw base units regardless, but consumer-facing
   semantics need the convention frozen.
4. **ethbacknode containerization.** The MVP environment is `docker-compose.yaml`, but
   ethbacknode defers Docker support due to its IPC-first design. Against Ganache (HTTP RPC,
   `:8545`) it must be validated over HTTP transport in a container; if that proves unsupported,
   the fallback is running ethbacknode as a host process beside Compose, or dropping the sidecar
   for MVP and letting the reconcile tick drive the pipeline alone (the design degrades to that
   mode anyway — Section 7).
5. **ethbacknode callback contract.** The `blockEvent`/`transactionEvent` payload schemas are
   now pinned from `API.md` in
   [reference-upstream-go-components.md](reference-upstream-go-components.md) §1.6 (key
   consequence: `transactionEvent` carries value transfers, not contract logs, so `blockEvent`
   is the primary trigger). Still open: the service-registration flow that issues
   `serviceId`/`apiToken`, the API.md-vs-DOC.md divergences, and the upstream license on the
   pinned release (the repo metadata and README badge currently disagree: MIT vs GPLv3).
6. **go_pysyun_pipeline error/envelope convention.** The `Result` envelope of §4.1 is our
   convention on top of the library's `any → any` contract; it must be specified in the repo's
   CONTRIBUTING notes so all stages implement short-circuiting uniformly. The library is
   LGPL-2.1 — fine as an unmodified import; modifications would have to be published.
