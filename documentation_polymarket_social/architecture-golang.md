# Chain Event Indexer — Go Component Architecture

**Document version:** 1.0

**Date:** 2026-06-11

**Sources:** [uml-components-smart-contracts.puml](uml-components-smart-contracts.puml),
[uml-components-api.puml](uml-components-api.puml),
[testing-integration.md](testing-integration.md) §6 ("Event-indexing latency"),
[team-composition.md](team-composition.md) (seat BE-11),
[architecture-polymarket-platform-reference.md](architecture-polymarket-platform-reference.md)

This document specifies the **Chain Event Indexer** (working name: `chain-indexer`) — a small,
standalone backend service written in **Go** that is the single bridge between the on-chain world
and the off-chain read path. It subscribes to the contract events emitted on the Ganache EVM node
(`MarketCreated`, `Trade`, `MarketResolved`, `Redeemed` — see
[uml-components-smart-contracts.puml](uml-components-smart-contracts.puml)), decodes them, and
persists them into an indexer-owned database schema that the Market Data, Portfolio, Markets, and
Notifications APIs read from.

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
one. At the same time the service is deliberately **small**: it has one input (JSON-RPC), one
output (its own DB schema plus a sync endpoint), and no business logic beyond decode-and-store.
That combination — tiny surface, total criticality — is what makes it worth isolating and
hardening as its own component.

### Why Go

- **Concurrency model fits the workload exactly:** one goroutine per subscription/poll loop, one
  per consumer notification fan-out, communicating over channels — no async framework needed.
- **First-class EVM tooling:** `go-ethereum` is the reference Ethereum implementation;
  `abigen` generates type-safe Go bindings directly from the frozen contract ABIs (Phase-0
  artifact, [team-composition.md](team-composition.md) Section 4), so decoding bugs become
  compile-time errors.
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
        │  JSON-RPC: eth_getLogs / eth_blockNumber
        ▼
┌────────────────────────────┐
│   chain-indexer (Go)       │
│  fetch → decode → persist  │
└────────────────────────────┘
        │                       │
        ▼                       ▼
 PostgreSQL                HTTP :8090
 schema `indexer`          /healthz, /status, /synced
        │
        ▼
 Market Data API · Portfolio API · Markets API · Notifications API
 (read-only consumers of the `indexer` schema)
```

Boundary rules (inherits the global guardrails of
[team-composition.md](team-composition.md) Section 3):

- The indexer **only reads** from the chain (`eth_getLogs`, `eth_blockNumber`,
  `eth_call` for enrichment). It never sends transactions, never signs anything, and holds no
  keys. Trade submission stays in the Orders API; market resolution stays with the trusted
  resolver account.
- The indexer **owns** the `indexer` PostgreSQL schema and its migrations (guardrail G4: one
  schema namespace per service). Consumers get read-only grants on it; they never write to it.
- Consumers needing derived aggregates (candlesticks, leaderboards) compute them on their side
  from the raw tables — the indexer stores facts, not projections, so consumer-specific logic
  cannot creep into the critical path.

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

1. Track the chain head and ingest every log emitted by the deployed contracts from the
   deployment block onward — no gaps, no duplicates (effective exactly-once via idempotent writes).
2. Decode logs with `abigen`-generated bindings for the four cataloged events:
   `MarketCreated`, `Trade`, `MarketResolved`, `Redeemed`.
3. Persist decoded events plus a per-block checkpoint in one transaction.
4. Maintain current-state convenience tables (`markets`, `positions`) derived only from those
   events, updated in the same transaction.
5. Expose sync status over HTTP for health checks and for the integration-test
   "indexer caught up" helper ([testing-integration.md](testing-integration.md) §6).
6. Survive restarts and Ganache restarts: resume from the checkpoint, or detect a chain reset
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

Three stages connected by bounded channels, each a goroutine group:

```
[fetcher] --blocks--> [decoder] --batch--> [writer]
```

- **Fetcher** — polls `eth_blockNumber` (default every 500 ms; Ganache mines instantly on
  transaction, so WebSocket subscriptions add complexity without benefit at MVP) and requests
  `eth_getLogs` for the address set over `[checkpoint+1, head]`, chunked to at most
  `MAX_BLOCK_RANGE` (default 2 000) blocks per call.
- **Decoder** — matches each log's `topics[0]` against the generated bindings and produces typed
  event records. An unrecognized log from a watched address is a **fatal error**, not a skip:
  it means the deployed ABI and the frozen event catalog have diverged, and continuing would
  silently corrupt downstream data.
- **Writer** — batches decoded events per block range and commits **one database transaction**
  per batch: insert events, upsert state tables, advance the checkpoint. The checkpoint moving
  only inside the same transaction as the data is the core correctness mechanism.

### 4.2 Delivery guarantees

- **At-least-once fetch, exactly-once effect.** Every event row has a natural primary key
  `(tx_hash, log_index)`; replays after a crash become `ON CONFLICT DO NOTHING` no-ops, and
  state-table updates are derived inside the same transaction, so they apply at most once.
- **Ordering.** Events apply in `(block_number, log_index)` order within a single writer
  goroutine. There is no parallel writing — at our scale (one Ganache node, AMM trades) the
  bottleneck is RPC latency, not the database, and a single writer makes ordering trivial.
- **Reorg stance.** Ganache (chain 1337) does not reorg, so MVP confirmation depth is 0. The
  fetcher nevertheless records each block's hash and verifies the parent-hash chain; a mismatch
  triggers rollback-to-last-matching-block logic. On Ganache the only "reorg" is a full chain
  reset (Docker recreate), detected by a genesis-hash change → truncate schema, reindex. This
  same code path, with `CONFIRMATION_DEPTH=N`, is the Base migration story (Section 8).

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
| `GET /healthz` | Liveness: process up, DB reachable, RPC reachable. |
| `GET /status` | `{ "chain_head": N, "indexed": M, "lag_blocks": N-M, "genesis": "0x…" }`. |
| `GET /synced?block=N&timeout=30s` | **Long-polls** until `indexed ≥ N`, then returns 200; 504 on timeout. |

`/synced` is the "indexer caught up" synchronization helper that
[testing-integration.md](testing-integration.md) §6 requires instead of sleeps: an integration
test submits a trade, takes the transaction's block number from the receipt, calls
`GET /synced?block=N`, and only then asserts on Market Data / Portfolio responses.

---

## 5. Repository layout

Standard Go service layout; one module, no shared internal packages with other repos:

```
chain-indexer/
├── cmd/indexer/main.go        # wiring: config, pipeline, HTTP server, graceful shutdown
├── internal/
│   ├── fetcher/               # head tracking, eth_getLogs chunking, parent-hash check
│   ├── decoder/               # topic dispatch over generated bindings
│   ├── writer/                # batching, transactions, checkpoint
│   ├── store/                 # pgx repositories, migrations (embedded, golang-migrate)
│   └── httpapi/               # /healthz /status /synced
├── bindings/                  # abigen output — GENERATED, regenerated from frozen ABIs
├── migrations/                # SQL migrations for schema `indexer`
├── Dockerfile                 # multi-stage, distroless final image
└── Makefile                   # make bindings | test | integration-test | lint
```

## 6. Technology stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Language | **Go ≥ 1.22** | single static binary |
| Chain access | `github.com/ethereum/go-ethereum` (`ethclient`, `abigen`) | bindings regenerated from the Phase-0 ABI artifact; generated code is committed |
| Database | PostgreSQL via `jackc/pgx/v5` | same PostgreSQL instance as the rest of the platform (`docker-compose.yaml`), dedicated schema |
| Migrations | `golang-migrate`, embedded via `embed.FS` | indexer migrates its own schema on start |
| HTTP | `net/http` (stdlib) | three endpoints do not justify a framework |
| Config | environment variables only | `RPC_URL`, `DATABASE_URL`, `CONTRACT_ADDRESSES_FILE` (the Phase-0 deployed-address artifact), `POLL_INTERVAL`, `MAX_BLOCK_RANGE`, `CONFIRMATION_DEPTH` |
| Observability | `log/slog` JSON logs; Prometheus metrics (`indexer_lag_blocks`, `indexer_events_total{type}`, `indexer_rpc_errors_total`) | `indexer_lag_blocks` is the alerting signal |

## 7. Failure modes

| Failure | Behavior |
|---------|----------|
| RPC down / flaky | Exponential backoff with jitter, retry forever; `/healthz` degrades, lag metric grows. Never skip a range. |
| DB down | Same backoff; fetcher blocks on the full channel (natural backpressure). |
| Process crash / redeploy | Resume from `checkpoint`; replays are idempotent (§4.2). |
| Ganache recreated (fresh chain) | Genesis-hash mismatch → truncate `indexer` schema, reindex from block 0, log loudly. |
| Unknown event from watched contract | Fatal: exit non-zero. ABI/catalog divergence must fail loudly in CI, not skip silently in prod (no-silent-drop rule). |
| Consumer reads while behind | Consumers' responsibility: `/status.lag_blocks` is exposed; the UI requirement for freshness is an open product gap ([functional-requirements.md](functional-requirements.md) Section 15, item 12 — live-update channel). |

## 8. Ganache → Base migration notes

Per the platform decision ([README.md](README.md), Architectural decisions), the MVP targets
Ganache; this service is the component most affected by the move to Base (chain 8453):

1. **Finality:** set `CONFIRMATION_DEPTH` > 0 and rely on the parent-hash/rollback path already
   built (§4.2) — reorgs become real.
2. **Transport:** switch the fetcher from polling to WebSocket `eth_subscribe` for heads, keeping
   `eth_getLogs` backfill as the catch-up path (subscriptions miss events across disconnects;
   the log-range scan is always the source of truth).
3. **Provider limits:** public RPC providers cap `eth_getLogs` ranges and rates;
   `MAX_BLOCK_RANGE` and backoff are already configurable.
4. **Throughput:** if event volume outgrows the single writer, partition by `market_addr`
   (per-market ordering is the only ordering consumers actually need).

Nothing in the consumer contract (schema + sync endpoint) changes.

## 9. Testing strategy (summary)

Aligned with [testing-integration.md](testing-integration.md); a full test plan is the
test-strategy-architect's deliverable.

- **Unit:** decoder against fixture logs generated from the bindings; writer idempotency
  (double-apply a batch, assert identical state); checkpoint/rollback logic with simulated
  parent-hash mismatches. Use `go-ethereum`'s `simulated` backend where a live chain is overkill.
- **Integration (Docker Compose):** deploy contracts to Ganache, emit each cataloged event,
  assert rows and state tables; kill -9 the indexer mid-range and assert gapless resume;
  recreate Ganache and assert clean reindex.
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
