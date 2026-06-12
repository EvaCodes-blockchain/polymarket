# CRE Resolver — Go service spec (CHAINLINK track, $6,000)

Spec for the Go engineer. Owns the **CHAINLINK — CRE resolve** prize track.
Written from the actual contracts on branch `mvp` (not from memory).

**Thesis.** Write a small, standalone Go service from scratch. It fetches a
price, compares it to a market's target, and calls
`OracleResolver.resolve(...)` signed by the oracle key. It is almost fully
decoupled from the TS backend — talks to the chain, nothing else. EVM + ABI +
RPC means **Arc and Base "just work"** by swapping RPC/chainId; no code change.

---

## Scope (what this service does, end to end)

```
 price API (e.g. Coingecko)
        │  fetch
        ▼
 [decision]  compare price vs market.target (gt/lt) at/after resolutionAt
        │  outcome = YES(0) | NO(1)
        ▼
 [write]  OracleResolver.resolve(marketId, outcome, proofUrl)   ← signed, oracle key
        │  emits MarketResolved(marketId, outcome, proofUrl)
        ▼
 (the ABI indexer node — separate component — catches the event → updates DB status)
```

This service is **write + decision**. It does NOT read events back / touch the
DB — that is the separate ABI-indexer node's job. The two Go components are
decoupled: they communicate only through the chain (this emits, the node
listens). Build this independently; do not block on the indexer.

---

## What already exists (the seams you consume)

### Contract: `OracleResolver` (contracts/src/OracleResolver.sol)
The only write you make:
```solidity
function resolve(uint256 marketId, uint8 winningOutcome, string calldata oracleProofUrl) external;
//   winningOutcome: 0 = YES, 1 = NO
//   gated by acl.hasRole(RESOLVER_ROLE, msg.sender)  → revert NotResolver()
//   reverts AlreadyResolved() if resolutions[marketId].resolved
event MarketResolved(uint256 indexed marketId, uint8 winningOutcome, string oracleProofUrl);
function isResolved(uint256 marketId) external view returns (bool);
```
- **Caller must hold `RESOLVER_ROLE`.** That role is granted to the
  `oracleResolver` account = **mnemonic addressIndex 1** (see artifact
  `accounts.oracleResolver`). Sign with that key. Separate nonce space from the
  TS backend (deployer=0, creator=6) → no nonce races.
- Idempotency is on-chain: a second `resolve` for the same id reverts
  `AlreadyResolved`. Check `isResolved(marketId)` first, or treat that revert as
  "already done, skip".

### Deployment artifact (contracts/deployments/ganache.json)
Single source of truth for addresses + ABI. Top-level keys:
`chainId, deployedAt, contracts{...}, seededMarket, accounts`.
- `contracts.OracleResolver.address` + `.abi` ← load these.
- `accounts.oracleResolver` ← the resolver address (sanity-check your derived key matches).
- On Arc the **same artifact shape** is regenerated with Arc addresses. Read the
  path from `DEPLOYMENTS_FILE` env (the ARC migration owns regenerating it).

### Network (env-driven — Arc/Base swap is config only)
- Local now: Ganache chain `1337`, RPC `http://localhost:8545` (in compose `http://ganache:8545`).
- Target: **Arc testnet** — chain ID `5042002`, RPC `https://rpc.testnet.arc.network`,
  gas token **USDC** (native, 18 decimals). You develop against Ganache today;
  flip `RPC_URL` + artifact at the end. Note: on a real network you pay gas — the
  oracle account needs a one-time gas top-up (faucet.circle.com on Arc).

---

## ⚠️ Two landmines — read before coding

### Landmine 1 — there are TWO unconnected `resolve()`
- `OracleResolver.resolve(id, outcome, proof)` → records + emits, gated by
  `RESOLVER_ROLE`. **← you call this. It is the CRE prize.**
- `PredictionMarket.resolve(outcome)` → moves the market state machine
  Open→Closed→Resolved, gated `onlyCreator`. **Different contract, different gate.**

These are NOT linked. Calling OracleResolver does **not** advance the
PredictionMarket state, so payout/redeem won't trigger. **For the demo that is
fine** — the on-chain `MarketResolved` event + Arcscan tx = "meaningfully used".
**Out of scope:** redeem / full lifecycle / bridging the two resolvers. Do not
spend time wiring PredictionMarket.

### Landmine 2 — there is NO machine-readable target in the data (YOU ARE BLOCKED on this)
The `Market` model (prisma) has `question, oracleProofUrl, closeTime, status` —
but **no field that says "ETH > $3000 by date Y"**. Only the human question
text. You have nothing to compare a price against.

**This seam is owned by the backend engineer, not you**, and must be cut before
you can resolve real markets. Required additive fields on `Market`:

| field | example | meaning |
|-------|---------|---------|
| `resolutionSource` | `coingecko:ethereum` | which price feed |
| `resolutionOperator` | `gt` / `lt` | comparison |
| `resolutionTarget` | `3000` | threshold |
| `resolutionAt` | ISO datetime | when it becomes resolvable |

Until those exist, unblock yourself with a **local config map** `marketId → rule`
for 2-3 demo CLASSIC markets (zero DB dependency). Switch to the DB fields when
the backend ships them. Flag this dependency to the orchestrator on day 1.

---

## Service design (from scratch, Go)

Keep it one binary, one compose service. Suggested layout under **`cre/`** (you
own this dir exclusively — zero file conflicts):
```
cre/
  main.go            # CLI: --once (one pass) / --loop (poll)
  config.go          # env loading
  artifact.go        # load OracleResolver address+abi from DEPLOYMENTS_FILE
  oracle.go          # signer (mnemonic idx 1), resolve() call, isResolved() check
  price.go           # price API client (Coingecko)
  decision.go        # compare price vs target → outcome 0/1
  rules.go           # market→rule source (local map now; DB later)
  go.mod
  Dockerfile
```
Use `go-ethereum` (`ethclient`, `abigen` or `bind`) or any EVM lib you prefer.
`--once` for CI/demo determinism, `--loop` with a poll interval for live.

**One pass:** load rules → for each unresolved market whose `resolutionAt` has
passed → fetch price → decide outcome → `resolve(id, outcome, proofUrl)` → log
tx hash. Skip on `isResolved` / `AlreadyResolved`. Exit 0 even if nothing to do.

---

## Env contract (additive — new vars only, don't touch existing)
```
RPC_URL                # reuse existing; ganache now, Arc later
DEPLOYMENTS_FILE       # path to ganache.json artifact (reuse existing)
GANACHE_MNEMONIC       # reuse; derive oracle signer at addressIndex 1
CRE_PRICE_API_BASE     # e.g. https://api.coingecko.com/api/v3
CRE_PRICE_API_KEY      # if the feed needs one
CRE_POLL_INTERVAL      # for --loop, e.g. 5m
```
The oracle proof URL passed to `resolve()` can be the price-API request URL used
for the decision — that doubles as the audit trail ("how was this resolved").

---

## Deploy / compose seam (devops owns the wiring, you provide the Dockerfile)
- New compose service `cre-resolver` under a profile (like `market-generator`).
- Runs `--once` in the deploy pass (after markets exist) or `--loop` as a daemon.
- One line in `deploy-dev.yml` — devops adds it; you just hand over a working
  `cre/Dockerfile` + the service definition snippet.

---

## Definition of done (the prize requirements)
- [ ] `--once` run resolves at least one market on-chain → tx hash in the explorer
      (Arcscan on Arc). This is "Successful simulation via CRE CLI / live deploy".
- [ ] Decision is data-driven (price API → compare → outcome), not hard-coded
      outcome. "Integrate blockchain + external API/data → price API → EVM write."
- [ ] Resolution is the market's real lifecycle step (`MarketResolved` emitted).
      "Meaningfully used in project."
- [ ] Public GitHub (this monorepo) + README section for the CRE service.
- [ ] Screen-recorded in the master demo video.

## What you must NOT do
- Don't rewrite `chain.ts` or touch the TS backend's chain code (ARC track owns it).
- Don't touch `schema.prisma` (backend owns the target fields).
- Don't wire PredictionMarket.resolve / redeem (out of scope).
- Don't depend on the ABI-indexer node — decouple via the chain event.

> Refs: `contracts/src/OracleResolver.sol`, `contracts/src/AccessControl.sol`,
> `contracts/deployments/ganache.json`, `docs/delivery/hackathon-prize-plan.md`,
> `docs/delivery/agentic-sprint-contracts.md` (seam discipline), `CLAUDE.md`
> (file ownership).
