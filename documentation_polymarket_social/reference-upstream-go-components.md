# Upstream Go Components — Technical Reference

**Document version:** 1.0

**Date:** 2026-06-11

**Sources (fetched 2026-06-11):**

- ethbacknode [README.md](https://github.com/ITProLabDev/ethbacknode/blob/main/README.md),
  [DOC.md](https://github.com/ITProLabDev/ethbacknode/blob/main/DOC.md),
  [API.md](https://github.com/ITProLabDev/ethbacknode/blob/main/API.md)
- go_pysyun_pipeline [corpus.md](https://github.com/pysyun/go_pysyun_pipeline/blob/main/corpus.md)

This document pins the technical contracts of the two upstream Go components that the
**Chain Event Indexer** ([architecture-golang.md](architecture-golang.md)) is built on, so the
`ebn` client package and the pipeline-stage conventions can be designed against a recorded
snapshot rather than a moving upstream. It directly addresses open items 4–6 of
[architecture-golang.md](architecture-golang.md) §10.

---

## 1. ethbacknode

### 1.1 What it is

EthBackNode (version **0.1.3dev**, Go **1.24**) is a backend microservice that sits between an
application backend and an Ethereum/EVM node. It exposes a **JSON-RPC 2.0 API over HTTP(S)**
(`Content-Type: application/json`) for address management, transaction monitoring, balance
queries, and transfers, and pushes asynchronous blockchain events to a configured client
callback URL. Declared target use cases: payment processing backends, custodial wallets,
blockchain event notification systems, DeFi backends, multi-address monitoring.

Status caveats from upstream: *"Project is under active development. Interfaces and internal
behavior may change."* The README's API overview ends with *"A detailed method specification
will be provided in the API documentation"* — API.md is that specification, but it contains
duplicated sections in two formats (some methods documented twice with slightly different field
lists), so payloads should be re-verified against the pinned release when the `ebn` package
freezes.

### 1.2 Internal architecture

Request/data flow (from DOC.md):

```
Client backend
   │ JSON-RPC 2.0
   ▼
endpoint/ (fasthttp JSON-RPC server)
   ├── address/        Address Manager (generation, pool, Badger DB)
   ├── subscriptions/  Subscriptions Manager (subscribers.json, transactions.db)
   └── txcache/        TxCache Manager (cached transactions, BadgerHold)
   ▼
watchdog/   Block/Transaction monitoring loop (state.json = last processed block)
   ▼
clients/ethclient/  Ethereum chain client
   ▼
clients/urpc/       Universal RPC client — HTTP-RPC or IPC socket transport
   ▼
Ethereum node (geth, Nethermind, …)
```

Event flow: the **watchdog** polls for new blocks; per block it fires `BlockEvent` handlers,
then per transaction `TransactionEvent` handlers; the **subscriptions manager** filters by
subscribed addresses and service config and POSTs JSON-RPC callbacks to each service's
`eventUrl`; the **txcache manager** caches transaction data.

Key packages beyond the above: `types/` (core interfaces), `storage/` (Badger, BadgerHold,
file storage), `security/` (API token auth), `abi/` (known-contract registry,
`data/abi/known_contracts.json`), `crypto/` + `common/bip32|bip39|bip44|rlp` (in-house ECDSA/
SECP256K1, Keccak, RFC-6979 nonces, RLP, HD wallets — `m/44'/60'/0'/0/index`).

Notable direct dependencies: `valyala/fasthttp` (server), `dgraph-io/badger` v1 +
`timshannon/badgerhold` (storage), `holiman/uint256` (amounts), `hashicorp/hcl/v2` (config),
`tyler-smith/go-bip39`.

### 1.3 Configuration

Primary format is HCL (`config.hcl`); JSON (`config.json`) is supported as legacy. Run as
`./ethbacknode -config config.hcl` (defaults to `config.hcl` in the current directory).

| Key | Example | Meaning |
|-----|---------|---------|
| `nodeUrl` / `nodePort` / `nodeUseSSL` | `"localhost"` / `"8545"` / `false` | HTTP-RPC connection to the node |
| `nodeUseIPC` / `nodeIPCSocket` | `true` / `"/var/tmp/geth.ipc"` | IPC transport (recommended by upstream) |
| `rpcAddress` / `rpcPort` | `"localhost"` / `"21280"` | ethbacknode's own JSON-RPC listen address |
| `dataPath` | `"data"` | Root of the data directory (Badger DBs, state files) |
| `debugMode` | `true` | Debug logging |
| `burnAddress` | `0x0000…0000` | For token tracking |
| `paramsInt.confirmations` | `12` | Confirmation depth |
| `additionalHeaders` | `X-Client = "EthBackNode/0.1.3dev"` | Extra HTTP headers toward the node |

Persistent state lives under `dataPath`: `watchdog/state.json` (**last processed block** —
relevant for restart behavior), `subscriptions/subscribers.json` + `transactions.db`,
`address/addresses.db` (includes private keys when supplied), `txcache/txcache.db`,
`security/config.json`, `abi/known_contracts.json`.

### 1.4 JSON-RPC method surface

Methods relevant to the indexer (monitoring-only deployment) are marked ✅; the
transfer/key-handling surface that the indexer **must keep unreachable** is marked ⛔
(see [architecture-golang.md](architecture-golang.md) §2 boundary rules).

| Method | Purpose | Notes |
|--------|---------|-------|
| ✅ `ping` | Health check | Returns `{result: "pong", timestamp}` — timestamp is **nanoseconds** Unix time |
| ✅ `info` | Chain + token info | `{blockchain, id, symbol, decimals, protocols[], tokens[]}` |
| ✅ `infoGetTokenList` | Supported assets | Array of `{name, symbol, decimals, contractAddress, token?}` |
| ✅ `infoGetBlockNum` | Current head | `{blockNumber: int64}` |
| ✅ `serviceConfigSet` | Configure event delivery | See §1.5; `serviceConfigGet` is **reserved/unimplemented** |
| ✅ `addressSubscribe` | Subscribe address for notifications | Use `watchOnly: true`; idempotent (`"Address already known"`) |
| ⛔ `addressGetNew` | Generate + subscribe new address | May return `privateKey` and `mnemonic` (`fullInfo: true`) |
| ⛔ `addressRecover` | Mnemonic → address + private key | Recovery only, creates **no** subscription |
| ✅ `addressGetBalance` | Balances | `{symbol: balance}` map; `formatted` (default true) switches decimal vs big-int |
| ✅ `transferInfo` | Transaction details by hash | `amountsFormatted` (default **true**) switches decimal vs big-int |
| ✅ `transferInfoForAddress` | Transaction list for an address | Address must be subscribed/generated first |
| ⛔ `transferAssets` | Send ETH / ERC-20 | Signs with stored or supplied `privateKey`; `force` overrides watchOnly |
| ⛔ `transferGetEstimatedFee` | Fee estimate | Returns big-int fee in smallest units |

DOC.md's method table differs from API.md in places — it lists `serviceRegister` /
`serviceConfig` (vs API.md's `serviceConfigSet`) and an `addressGenerate` method, and marks
some methods as **Secured** (requiring an `X-Api-Token` header): `addressGenerate`,
`serviceConfig`, `transferInfoForAddress`, `transferAssets`, `transferGetEstimatedFee`.
API.md mentions an `apiToken` parameter on `serviceConfigSet` ("required if issued").
This API.md-vs-DOC.md divergence must be resolved against the pinned release
(open item: §3.1 below).

Standard JSON-RPC 2.0 error envelope with the usual codes (−32700 parse, −32600 invalid
request, −32601 method not found, −32602 invalid params, −32603 internal).

### 1.5 Service registration and event configuration

Event delivery is configured per **service** (a registered client backend) via
`serviceConfigSet`:

| Field | Type | Meaning |
|-------|------|---------|
| `serviceId` | int | Issued during service registration (registration flow itself is under-documented — see §3.1) |
| `apiToken` | string | Required if issued for the service |
| `eventUrl` | string | Client callback endpoint (`http(s)://host[:port][/path]`) |
| `reportNewBlock` | bool | Emit `blockEvent` per new block |
| `reportIncomingTx` / `reportOutgoingTx` | bool | Emit `transactionEvent` for subscribed addresses |
| `reportMainCoin` | bool | Filter for native currency (defaults to **true** if omitted) |
| `reportTokens` | string[] | Token-symbol filter for notifications |
| `gatherToMaster` / `masterList` | bool / string[] | Auto-sweep received funds to master addresses (⛔ unused by us; only applies when `watchOnly` is disabled) |

⚠️ Unspecified booleans default to `false` (except `reportMainCoin`). The response echoes the
stored configuration (without `apiToken`).

### 1.6 Event callbacks (the contract that matters to the indexer)

Delivery model:

- Events are **HTTP POST** requests to `eventUrl`, body is a **JSON-RPC 2.0 notification-style
  call** (`method` + `params`).
- The receiver must answer **HTTP 200** to acknowledge; non-200 may trigger retries per
  internal policy.
- Delivery is **at-least-once** — receivers must deduplicate (the indexer's
  checkpoint-anchored `eth_getLogs` design absorbs this; callbacks are triggers, not data).
- Events for the same address/transaction are delivered in chronological order; a transaction
  may be delivered **multiple times** as its state changes (mempool → confirmed); dedup key is
  `txId`.
- Upstream explicitly advises: do not trust event payloads blindly — cross-check via query
  methods (`transferInfo`); keep webhook endpoints off the public network.

**`blockEvent`** (sent when `reportNewBlock` is enabled):

```json
{
  "jsonrpc": "2.0",
  "method": "blockEvent",
  "params": {
    "chainId": "ethereum",
    "blockNum": 1341,
    "blockId": "0x7f60066663da144904b1792cfd0991912342bdbbae0181b52368d72dfd5f7fe5"
  },
  "id": 1
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `chainId` | string | Blockchain identifier (string id, e.g. `"ethereum"` — **not** the numeric EVM chain id) |
| `blockNum` | int | Block number |
| `blockId` | string (hex) | Block header hash |

Upstream marks block events as *advisory* (no confirmation implied); cross-check with
`infoGetBlockNum` if needed. `blockId` is usable as the parent-hash-chain input for the
indexer's reorg check.

**`transactionEvent`** (incoming and outgoing share one format):

```json
{
  "jsonrpc": "2.0",
  "method": "transactionEvent",
  "params": {
    "chainId": "ethereum",
    "txId": "0x4b1e…e02e",
    "timestamp": 1718803312,
    "blockNum": 0,
    "success": true,
    "transfer": true,
    "nativeCoin": true,
    "symbol": "ETH",
    "from": "0x74Fe…D8F3",
    "to": "0x2a54…a6A9",
    "amount": 10000000000000000000,
    "fee": 441000000000000,
    "inPool": true,
    "confirmed": false,
    "confirmations": 0
  },
  "id": 1
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `txId` | string (hex) | Transaction hash (dedup key) |
| `timestamp` | int | Unix time of mempool entry or block inclusion |
| `blockNum` | int | `0` while still in mempool |
| `success` | bool | Execution result — upstream: **must be checked** |
| `transfer` | bool | Value transfer flag (marked legacy/deprecated) |
| `nativeCoin` / `symbol` | bool / string | Native vs token transfer |
| `amount` / `fee` | big int | Smallest units; formatting is the client's job |
| `inPool` / `confirmed` / `confirmations` | bool / bool / int | Confirmation state machine |
| `userId` / `invoiceId` | optional | Echo of identifiers given at `addressSubscribe` time |

⚠️ **Scope caveat for the indexer:** `transactionEvent` is a **value-transfer** notification
(native coin and supported ERC-20 tokens to/from subscribed addresses) — it does **not** carry
decoded contract event logs. Calls into our market/AMM contracts may carry zero value and may
not surface as transfer events at all. Therefore the indexer's reliable trigger is
**`blockEvent`** (`reportNewBlock: true`); `transactionEvent` subscriptions on the contract
addresses are at most a secondary hint. The actual `MarketCreated`/`Trade`/`MarketResolved`/
`Redeemed` data always comes from the indexer's own `eth_getLogs` backfill — which the
architecture already mandates ("callbacks are triggers, not data",
[architecture-golang.md](architecture-golang.md) §4.2).

A second, shorter `transactionEvent` shape appears in DOC.md (`txHash`/`amount`-as-string
fields); API.md's richer shape above is taken as authoritative pending release pinning.

### 1.7 Deployment posture and constraints

- **IPC-first design.** Upstream recommends running on the **same host as geth** and
  connecting via `geth.ipc` (lower latency, no exposed node RPC, smaller attack surface).
  HTTP-RPC is supported (`nodeUseIPC = false`) — this is the mode we need against Ganache's
  `:8545`.
- **Docker support is intentionally postponed** (IPC socket mapping complexity; outbound
  callback networking). README: *"not a universal solution"* for highly containerized /
  serverless environments. For our Compose-based MVP environment this remains open item 4 of
  [architecture-golang.md](architecture-golang.md) §10 — validate HTTP transport in a
  container, else run as a host process or fall back to reconcile-tick-only operation.
- **Explicit non-use-cases** (README): frontend exposure, one-off scripts, multi-chain
  aggregation in one process, custodial setups without strict key controls.
- **Security posture:** private keys/mnemonics are stored in Badger when supplied
  (`addressSubscribe` with `privateKey`, `addressGetNew`); secured methods use `X-Api-Token`;
  upstream warns to never expose signing endpoints publicly. Our deployment is
  **monitoring-only**: subscribe with `watchOnly: true`, never pass private keys, keep the
  RPC port reachable from the indexer host only.
- **Restart behavior:** the watchdog persists its last processed block (`watchdog/state.json`),
  and subscriptions persist in `data/`. On a Ganache recreate the persisted state references a
  dead chain — ethbacknode's data directory must be reset alongside (matches the
  architecture's failure-mode table).
- **Roadmap (unchecked TODO items relevant to us):** env-var configuration, CI pipeline,
  structured logging, IPC-safe Docker model, security review of outbound callbacks. Only
  token-based API authorization is checked off.

### 1.8 License status

⚠️ Conflicting signals, re-verified 2026-06-11:

- GitHub repository metadata (`license` field via API): **MIT**.
- README badge and DOC.md header: **GPLv3** ("GNU General Public License v3.0").

Since we use ethbacknode as a **separate process over JSON-RPC** (deployment dependency, not
linked code), even GPLv3 imposes no obligations on our codebase — but the discrepancy must be
resolved (and the LICENSE file checked) on the release we pin
([architecture-golang.md](architecture-golang.md) §10 item 5).

---

## 2. go_pysyun_pipeline

### 2.1 What it is

A compact Go port of the PySyun pipeline ecosystem (module
`github.com/pysyun/go_pysyun_pipeline`, import alias `pysyun`; recommended Go ≥ 1.19):

- **Linear pipelines** (port of `pysyun_chain`): `Chainable` (synchronous composition) and
  `ChainableGroup` (parallel per-item fan-out).
- **Graph pipelines** (port of `pysyun-timeline`): `PipelineNode` with fan-out and simple
  per-activation profiling (`Delta`).

Goroutines + `sync.WaitGroup` replace Python's asyncio/ThreadPoolExecutor.

### 2.2 Public API

```go
type Processor interface { Process(data any) any }
type ProcessorFunc func(data any) any            // functional adapter

type Chainable struct{ /* … */ }
func NewChainable(p Processor) *Chainable
func (c *Chainable) Process(data any) any
func (c *Chainable) Pipe(next *Chainable) *Chainable

type ChainableGroup struct{ /* … */ }
func NewChainableGroup(concurrency int) *ChainableGroup
func (g *ChainableGroup) Pipe(next *Chainable) *ChainableGroup
func (g *ChainableGroup) Process(data []any) []any

type Delta struct {
    ItemDelta int           // output count − input count (only when both are []any)
    Duration  time.Duration
}

type PipelineNode struct {
    LastDelta Delta
}
func NewPipelineNode(p Processor) *PipelineNode
func (n *PipelineNode) Add(neighbor *PipelineNode) *PipelineNode
func (n *PipelineNode) Write(data any)
func (n *PipelineNode) Read() any
func (n *PipelineNode) Activate()

func Pipe(stages ...*Chainable) *Chainable        // variadic chaining helper
```

Usage shape: `pysyun.Pipe(pysyun.NewChainable(&StageA{}), pysyun.NewChainable(&StageB{}))`,
then `pipeline.Process(input)`. Graph form: build `PipelineNode`s, `Add` neighbors, `Write`
to the source, `Activate`, `Read` from sinks, inspect `LastDelta` per node.

### 2.3 Behavioral guarantees and limitations (verbatim contract)

- `Pipe()` with **no arguments** returns an identity (pass-through) stage.
- `ChainableGroup` **panics** (nil dereference) if `Process` is called before at least one
  `Pipe(...)`.
- `ChainableGroup` preserves **input order** in its output slice (results written to indexed
  positions); concurrency is bounded by a buffered-semaphore channel; `concurrency <= 0`
  means one goroutine per input item.
- `ChainableGroup` stages are **per-item** processors (operate on a single element);
  `Chainable` pipelines in the examples are **batch** style (`[]any` in/out). Bridging the
  two requires adapter stages; the library does not enforce either convention.
- `PipelineNode.Activate` is **synchronous and single-threaded** — do not call concurrently
  on one node; fan-out is a simple broadcast that writes the **same output reference** to all
  neighbors (defensive copies needed if neighbors mutate).
- `ItemDelta` profiling computes only when input/output are `[]any`; otherwise 0.
- **No built-in error channel** — `Process` is `any → any`. Upstream's recommended patterns:
  carry a `struct { Val T; Err error }` per item, or wrap processors with logging adapters.
  (The indexer standardizes this as the `Result{Value, Err}` short-circuit envelope —
  [architecture-golang.md](architecture-golang.md) §4.1.)
- **No context propagation / cancellation** — pass `context.Context` inside the data payload
  or cancel at a coordinator above `Process`.
- **No streaming / backpressure** — `ChainableGroup` fans out over a fully materialized slice;
  the only gate is the concurrency semaphore. Streaming topologies must be built around the
  library (channels/actors). The indexer's "blocking channels give backpressure" property
  therefore comes from how stages are *driven* (one pipeline run per planned range), not from
  the library itself.
- Thread-safety is the stage author's responsibility inside `ChainableGroup` (no shared
  mutable state, or guard with mutex/atomics).

### 2.4 Performance notes (upstream)

Near-linear speedup for CPU-bound or latency-heavy per-item stages up to CPU/I-O limits;
choose a bounded concurrency to avoid oversubscription (`0` = spawn-per-item only for small
or highly I/O-bound inputs); minimize allocations in hot per-item processors.

### 2.5 License status

corpus.md states **LGPL-2.1** ("aligned with pysyun_chain"); GitHub's license detection finds
**no license file** in the repository (checked 2026-06-11). LGPL-2.1 as an unmodified imported
library is acceptable for us (modifications would have to be published), but the missing
LICENSE file should be raised upstream or the license confirmed before the dependency is
frozen ([architecture-golang.md](architecture-golang.md) §10 item 6).

---

## 3. Consequences for the Chain Event Indexer

### 3.1 What this snapshot settles, and what remains open

**Settled by this reference:**

1. **Callback payload schemas** (`blockEvent`, `transactionEvent`) are now pinned (§1.6) —
   the `ebn` package's callback types can be written against them.
2. **Trigger choice:** `reportNewBlock: true` / `blockEvent` is the primary pipeline trigger;
   `transactionEvent` does not carry contract logs and cannot replace `eth_getLogs` (§1.6
   scope caveat).
3. **Subscription mode:** `addressSubscribe` with `watchOnly: true` and no `privateKey` is
   the only subscription form the indexer may use (§1.4, §1.7).
4. **Pipeline conventions:** identity `Pipe()`, ChainableGroup panic-without-stages, order
   preservation, single-writer constraint compatibility, and the absence of built-in
   error/context/backpressure are confirmed (§2.3) — the `Result` envelope convention stands.

**Still open (carried in [architecture-golang.md](architecture-golang.md) §10):**

- The **service registration flow** that issues `serviceId`/`apiToken` is referenced but not
  specified in API.md (DOC.md hints at `serviceRegister`); must be pinned from the release or
  source.
- **API.md vs DOC.md divergences** (method names `serviceConfigSet` vs `serviceConfig`,
  secured-method list, the two `transactionEvent` shapes) — resolve on the pinned release.
- **ethbacknode in Docker** against Ganache over HTTP transport — still needs validation
  (upstream defers Docker support; §1.7).
- **Licenses** — MIT-vs-GPLv3 metadata conflict for ethbacknode; missing LICENSE file for
  go_pysyun_pipeline (§1.8, §2.5).

### 3.2 Quick mapping table

| Indexer concern | Upstream fact | Where |
|-----------------|---------------|-------|
| Health check of sidecar | `ping` → `pong` + ns timestamp | §1.4 |
| Head discovery without polling loop | `blockEvent.blockNum` push; `infoGetBlockNum` pull | §1.6, §1.4 |
| Reorg check input | `blockEvent.blockId` (header hash) | §1.6 |
| Dedup requirement | Delivery is at-least-once; state-change re-delivery; dedup by `txId` | §1.6 |
| Callback receiver contract | HTTP POST, JSON-RPC 2.0 body, must return 200 | §1.6 |
| Monitoring-only deployment | `watchOnly: true` subscriptions; ⛔ methods unreachable; `X-Api-Token` for secured methods | §1.4, §1.7 |
| Compose environment risk | Docker support postponed upstream (IPC-first) | §1.7 |
| Ganache-recreate handling | ethbacknode persists chain state in `data/` — reset it together with the node | §1.3, §1.7 |
| Stage error handling | No error channel in pipeline lib → `Result` envelope convention | §2.3 |
| Backfill fan-out | `ChainableGroup(concurrency)`, order-preserving | §2.2–2.3 |
| Per-stage timing in tests | `PipelineNode.LastDelta` (`Duration`, `ItemDelta`) | §2.2 |
