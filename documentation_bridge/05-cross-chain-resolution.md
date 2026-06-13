# Cross-chain resolution — one resolution settles all chains

How Justify markets resolve once on the home chain and propagate to every proxy
chain, unifying settlement across **Arc, Base, Ethereum, Polygon, and BSC**. This
design is **built on two Chainlink products working together**: Chainlink CRE
(automation + off-chain compute resolving the home market) and Chainlink CCIP
(carrying the resolution broadcast across chains).

---

## Table of contents

- [1. Principle](#1-principle)
- [2. Architecture](#2-architecture)
- [3. The Chainlink foundation](#3-the-chainlink-foundation)
- [4. Resolution flow](#4-resolution-flow)
- [5. Idempotency and safety](#5-idempotency-and-safety)
- [6. Current state and future work](#6-current-state-and-future-work)
- [References](#references)

---

## 1. Principle

From [whitepaper §5.3](../documentation_justify_whitepaper/justify-whitepaper.md)
(Phase 3):

> Resolution executes **once, on the home chain**, and is propagated to all
> proxies via the same bridge adapters used for order flow — so decentralizing
> resolution on one chain decentralizes it everywhere at once.

The core property: **one resolution event settles all chains.** No proxy chain
can disagree with home-market state; every proxy unlocks redemption only after
receiving the home resolution broadcast.

In the bridge phase:
- A market has **one home chain** (e.g. Arc) where its `PredictionMarket`, AMM,
  and collateral pool live.
- That market has **proxy contracts** on every other supported chain (Base,
  Ethereum, Polygon, BSC) that forward orders to the home AMM and hold wrapped
  position receipts for remote traders.
- When the home market resolves, a `ResolutionBroadcast` message is sent
  (exactly once) via the `IBridgeAdapter` to every proxy chain.
- Each `MarketProxy` marks itself resolved and enables users to redeem their
  wrapped receipts for local collateral according to the home resolution outcome.

**No multi-chain coordination is needed**; proxies are stateless receivers of the
home truth. The home chain is the single source of resolution authority.

---

## 2. Architecture

```
                             HOME CHAIN (e.g. Arc)
                        ┌──────────────────────────────┐
                        │  OracleResolver.resolve()    │ ← CRE resolver calls once
                        │    marketId: 42              │
                        │    winningOutcome: 0 (YES)   │
                        │    oracleProofUrl            │
                        │  ───────────────────────────│
                        │  emit MarketResolved(...)    │
                        └──────────┬───────────────────┘
                                   │
                       ┌───────────▼──────────────┐
                       │ CRE → Bridge dispatcher  │  (watches MarketResolved)
                       │ Compose ResolutionBroad- │
                       │ cast for this marketId   │
                       └───────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │  IBridgeAdapter    │  IBridgeAdapter    │  IBridgeAdapter
              │  (CCIP to Base)    │  (CCIP to Polygon) │  (CCIP to BSC)
              ▼                    ▼                    ▼
       ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
       │ MarketProxy  │    │ MarketProxy  │    │ MarketProxy  │
       │ on Base      │    │ on Polygon   │    │ on BSC       │
       │              │    │              │    │              │
       │ mark resolved│    │ mark resolved│    │ mark resolved│
       │ unlock redeem│    │ unlock redeem│    │ unlock redeem│
       └──────────────┘    └──────────────┘    └──────────────┘
              ▲                    ▲                    ▲
         users redeem          users redeem        users redeem
         wrapped receipts      wrapped receipts    wrapped receipts
         for local USDC        for local USDC      for local USDC
```

### Key components

| Component | Role | Lives on |
|-----------|------|----------|
| `OracleResolver` | Authoritative resolver; `resolve(marketId, outcome, proofUrl)` records the winning outcome and emits `MarketResolved` | Home chain |
| CRE resolver service | Automated off-chain service (see [`cre-resolver-plan.md`](../docs/delivery/cre-resolver-plan.md)) that fetches price data, decides outcome, and calls `OracleResolver.resolve()` signed by the oracle key (mnemonic idx 1, `RESOLVER_ROLE`) | Off-chain (Go) |
| Bridge dispatcher | Watches `MarketResolved` on home chain, composes a `ResolutionBroadcast` message, and sends it via `IBridgeAdapter.sendResolution(...)` to every known proxy chain | Off-chain or keeper |
| `IBridgeAdapter` (CCIP) | Sends the resolution message cross-chain; first production adapter is Chainlink CCIP (see [02-chainlink-ccip-adapter.md](./02-chainlink-ccip-adapter.md)) | Per-lane contracts |
| `MarketProxy` | On each proxy chain, receives `ResolutionBroadcast`, verifies the home origin, marks itself resolved, and unlocks redemption of wrapped position receipts | Proxy chains |

---

## 3. The Chainlink foundation

This resolution architecture is **inspired by and built on Chainlink** products:

### 3.1 Chainlink CRE — resolving the home market

**Chainlink Compute / CRE** (off-chain compute, on-chain write) is the automation
layer that decides market outcomes without human intervention.

From [`cre-resolver-plan.md`](../docs/delivery/cre-resolver-plan.md):

```
 price API (e.g. Coingecko, or Chainlink Data Feeds / Functions)
        │  fetch
        ▼
 [decision]  compare price vs market.target (gt/lt) at/after resolutionAt
        │  outcome = YES(0) | NO(1)
        ▼
 [write]  OracleResolver.resolve(marketId, outcome, proofUrl)
        │  signed by oracle key (RESOLVER_ROLE, mnemonic idx 1)
        │  emits MarketResolved(marketId, outcome, proofUrl)
```

The CRE resolver is a Go service that:
- Fetches external data (price APIs, or alternatively **Chainlink Data Feeds** for
  on-chain price references; Chainlink Functions for more complex compute).
- Compares the data against the market's resolution rule (e.g. "ETH > $3000 by
  date Y").
- Calls `OracleResolver.resolve()` on the **HOME chain only** when the condition
  is met and the resolution time has passed.
- Records the `oracleProofUrl` as an audit trail (the price-API URL or Chainlink
  Functions request ID).

This is **automated, decentralized resolution** per whitepaper §5.3 Phase 2.
The human operator is removed from the loop for objectively verifiable events.

**Key property:** CRE resolves the home market **once**. The on-chain
`isResolved()` guard prevents double-resolution. The `MarketResolved` event is the
trigger for the next step: cross-chain propagation.

### 3.2 Chainlink CCIP — propagating resolution cross-chain

**Chainlink CCIP** (Cross-Chain Interoperability Protocol) is the transport layer
that carries the `ResolutionBroadcast` from the home chain to every proxy chain.

From [02-chainlink-ccip-adapter.md](./02-chainlink-ccip-adapter.md):

> Justify's bridge layer is explicitly and directly inspired by the architecture
> of Chainlink CCIP. The `IBridgeAdapter` interface maps to CCIP's Router →
> OnRamp → DON → OffRamp flow.

The resolution broadcast:
- Originates on the home chain (the bridge dispatcher composes it after watching
  `MarketResolved`).
- Is sent via `IBridgeAdapter.sendResolution(toChainId, proxyAddress, marketId,
  outcome, proofUrl)`.
- The CCIP adapter translates this into a CCIP `router.ccipSend()` call, targeting
  the `MarketProxy` on the destination chain.
- CCIP's Decentralized Oracle Network (DON) delivers the message; CCIP's Risk
  Management Network (RMN) provides an independent verification layer (parallel to
  Justify's circuit breaker — see [06-security-and-risk-management.md](./06-security-and-risk-management.md)).
- The `MarketProxy` on the destination chain receives the message via its
  `ccipReceive()` implementation, verifies the sender is the allowlisted home
  chain / home market, and marks itself resolved.

**Why CCIP?** The same properties that make CCIP suitable for cross-chain token
transfers make it suitable for resolution broadcasts:
- **Guaranteed delivery** (or explicit revert on the source if undeliverable).
- **Verifiable origin** (proxy can cryptographically verify the home chain sent it).
- **Auditable** (CCIP message IDs are on-chain, CCIP explorers show cross-chain flow).
- **Production-ready** across the target networks (Arc, Base, Ethereum, Polygon, BSC).

### 3.3 Chainlink as the committed price source (optional, future)

Chainlink Data Feeds (e.g. ETH/USD, BTC/USD) or Chainlink Functions (custom
compute) can serve as the **resolution data source** for the CRE resolver:
- Instead of polling Coingecko, the CRE service reads the on-chain Chainlink
  price feed at the market's `resolutionAt` timestamp.
- This makes resolution **fully on-chain-verifiable**: the proof URL points to
  the Chainlink aggregator contract + block number, not an external API endpoint.

This is an **optional enhancement** (not MVP). The architecture supports it: the
CRE resolver is data-source-agnostic; the `oracleProofUrl` field records whatever
source was used.

**Summary:** Chainlink is the foundation of Justify's decentralized resolution
architecture — CRE for the decision, CCIP for the propagation, optionally Data
Feeds for the input.

---

## 4. Resolution flow

### 4.1 End-to-end sequence

```
Time: market.resolutionAt has passed, price condition met

1. CRE resolver (Go):
     fetch price from API / Chainlink Feed
     compare vs market rule → decide outcome (YES=0 / NO=1)
     check isResolved(marketId) → false
     sign + send: OracleResolver.resolve(marketId, outcome, proofUrl)

2. HOME chain (OracleResolver.sol):
     verify msg.sender has RESOLVER_ROLE
     verify !resolutions[marketId].resolved
     store: resolutions[marketId] = {resolved: true, outcome, proofUrl}
     emit MarketResolved(marketId, outcome, proofUrl)

3. Bridge dispatcher (watches MarketResolved):
     parse event: marketId=42, outcome=0, proofUrl="..."
     lookup proxy chains for this market (Base, Polygon, BSC)
     for each proxy chain:
       IBridgeAdapter.sendResolution(toChainId, proxyAddress, 42, 0, proofUrl)

4. CCIP adapter (per destination):
     compose CCIP message: data=abi.encode(marketId, outcome, proofUrl)
     call router.ccipSend(destChainSelector, message)
     pay LINK fee
     emit ResolutionSent(messageId, toChain, marketId)

5. CCIP DON + RMN:
     attest message
     deliver to destination OffRamp

6. PROXY chain (MarketProxy.ccipReceive):
     verify sender = allowlisted home chain / home market
     verify !_resolved (dedup by marketId)
     store: _resolved = true, _outcome = outcome
     emit ProxyResolved(marketId, outcome, proofUrl)

7. Users on proxy chain:
     call MarketProxy.redeem(wrappedReceiptTokenId, amount)
     contract burns wrapped receipt
     if outcome matches receipt's position → transfer local collateral
     else → no payout (losing outcome)
```

### 4.2 On-chain function signatures

```solidity
// HOME chain — OracleResolver.sol
function resolve(uint256 marketId, uint8 winningOutcome, string calldata oracleProofUrl) external;
  // gated: acl.hasRole(RESOLVER_ROLE, msg.sender)
  // reverts AlreadyResolved if resolutions[marketId].resolved

event MarketResolved(uint256 indexed marketId, uint8 winningOutcome, string oracleProofUrl);

function isResolved(uint256 marketId) external view returns (bool);
```

```solidity
// HOME chain — IBridgeAdapter (dispatcher calls this)
function sendResolution(
    uint256 toChainId,
    address proxyAddress,
    uint256 marketId,
    uint8 outcome,
    string calldata proofUrl
) external payable returns (bytes32 messageId);
```

```solidity
// PROXY chain — MarketProxy.sol
function receiveResolution(uint256 marketId, uint8 outcome, string calldata proofUrl) internal;
  // called by ccipReceive after sender verification
  // marks _resolved = true, unlocks redeem()

function redeem(uint256 wrappedReceiptId, uint256 amount) external;
  // requires _resolved == true
  // burns wrapped receipt, pays out local collateral if outcome matches
```

---

## 5. Idempotency and safety

### 5.1 Home-chain deduplication

`OracleResolver.resolve()` is idempotent on-chain:
- The `resolutions[marketId].resolved` flag is checked before every write.
- A second call for the same `marketId` reverts with `AlreadyResolved()`.
- The CRE resolver can pre-check `isResolved(marketId)` to skip already-resolved
  markets in batch runs (no wasted gas).

### 5.2 Proxy-chain deduplication

Each `MarketProxy` tracks its own `_resolved` state per market:
- The first `receiveResolution(marketId, ...)` marks `_resolved = true`.
- Subsequent broadcasts for the same `marketId` are ignored (no revert; silent no-op).
- CCIP message IDs are logged in the `ProxyResolved` event for audit trails; the
  contract does not store them (resolution is final, no replay needed).

This protects against:
- Accidental double-send from the bridge dispatcher.
- CCIP retry/redelivery (unlikely but theoretically possible).

### 5.3 Proxy unavailability — pull-based redemption

**What happens if a proxy chain is down or the CCIP lane is paused at broadcast time?**

The resolution broadcast is **asynchronous and retriable**:
- If the CCIP send fails (destination chain halted, gas spike, lane paused), the
  dispatcher logs the failure and retries later (exponential backoff).
- Users on the unreachable proxy chain **cannot redeem yet** (their
  `MarketProxy._resolved` is still false), but their wrapped receipts remain
  valid — no loss of funds.
- Once the lane reopens and the broadcast succeeds, redemption unlocks.

**Pull-based safety:** redemption is a **pull operation** initiated by the user
(`MarketProxy.redeem()`), not a push from the home chain. The proxy never needs
to "call home" to settle; it waits for the broadcast, then settles locally. This
decouples settlement availability from real-time bridge liveness.

### 5.4 Circuit breaker does NOT block redemptions

From [06-security-and-risk-management.md](./06-security-and-risk-management.md):

> The circuit breaker can pause **new proxy intents** (new buys/sells) but NEVER
> blocks redemptions.

Even if the circuit breaker is triggered (anomaly detection, bridge exploit), users
can always redeem **already-resolved** positions. The `MarketProxy.redeem()`
function is explicitly excluded from the pause gate.

Why: redemption is the safety valve. If a bridge is compromised, freezing
user funds on the proxy chain makes the damage worse. Allow exit.

### 5.5 Misordered broadcasts

Markets resolve in wall-clock order (when their `resolutionAt` time passes), but
CCIP delivery times vary per lane (Base may be 30s, BSC may be 2min). This is fine:
- Each `MarketProxy` resolves independently; there is no cross-market dependency.
- A market's resolution on proxy chain A does not block redemption of a different
  market on proxy chain B.
- Users see "Resolved — pending bridge confirmation" UI until their proxy receives
  the broadcast; then redemption unlocks.

---

## 6. Current state and future work

### 6.1 Current (MVP / Arc phase)

From [`cre-resolver-plan.md`](../docs/delivery/cre-resolver-plan.md):

> Landmine 1 — there are TWO unconnected `resolve()`
> - `OracleResolver.resolve(id, outcome, proof)` → records + emits, gated by
>   `RESOLVER_ROLE`. **← CRE resolver calls this.**
> - `PredictionMarket.resolve(outcome)` → moves the market state machine
>   Open→Closed→Resolved, gated `onlyCreator`. **Different contract, different gate.**
>
> These are NOT linked. Calling OracleResolver does **not** advance the
> PredictionMarket state, so payout/redeem won't trigger.

**Current scope (single-chain, Chainlink CRE track):**
- The CRE resolver Go service exists and calls `OracleResolver.resolve()` on the
  home chain (Arc testnet).
- The `MarketResolved` event is emitted on-chain; the transaction is visible in
  Arcscan (audit trail).
- **Gap:** resolution is recorded but not yet wired to `PredictionMarket.resolve()`,
  so redemption/payout does not trigger automatically.

This is **sufficient for the CRE Chainlink prize** (automated off-chain compute →
on-chain write, meaningfully used). The full lifecycle is Phase 3 work.

### 6.2 Future work (bridge phase)

**To complete cross-chain resolution:**
1. **Wire `OracleResolver` → `PredictionMarket`**: when `OracleResolver.resolve()`
   is called, trigger `PredictionMarket.resolve()` or vice versa. One write, both
   states updated. Design options:
   - `OracleResolver` holds a reference to `PredictionMarket` and calls it.
   - `PredictionMarket.resolve()` requires oracle confirmation (two-phase commit).
   - `MarketFactory` wires them at market creation.
2. **Implement the bridge dispatcher**: off-chain service (or keeper contract) that
   watches `MarketResolved` events on the home chain, looks up all proxy addresses
   for that market (from the backend's bridge registry), and calls
   `IBridgeAdapter.sendResolution(...)` for each.
3. **Deploy `MarketProxy` contracts**: one per proxy chain per market (or a
   singleton proxy per chain that handles multiple markets). Implement
   `ccipReceive()` to accept resolution broadcasts and unlock `redeem()`.
4. **CCIP adapter production config**: fund LINK, allowlist lanes, set gas limits
   per [04-per-chain-bridge-playbook.md](./04-per-chain-bridge-playbook.md).
5. **End-to-end test**: create a market on Arc, proxy it to Base, trade on both,
   resolve via CRE on Arc, verify the broadcast reaches Base, redeem on both chains.

### 6.3 Honest scope note

**The bridge phase is designed but not yet built.** The contracts exist
(`OracleResolver`, the `IBridgeAdapter` interface is specced, `MarketProxy` is
designed), the CRE resolver exists and works on the home chain, and the Chainlink
CCIP adapter design is documented. The **integration** (wiring resolution to
payout, multi-chain broadcast, proxy redemption) is Phase 3 work per the
[whitepaper roadmap](../documentation_justify_whitepaper/justify-whitepaper.md) §8.

This document defines the **target architecture** so that when the bridge phase
is built, the seams are already frozen and the contracts can be written against
this spec.

---

## References

- [Justify whitepaper §5.3](../documentation_justify_whitepaper/justify-whitepaper.md) —
  resolution Phase 1 (manual) → Phase 2 (CRE automated) → Phase 3 (bridge propagated).
- [CRE resolver plan](../docs/delivery/cre-resolver-plan.md) — the existing Go
  service, `RESOLVER_ROLE`, oracle key, `OracleResolver.resolve()` signature.
- [OracleResolver.sol](../contracts/src/OracleResolver.sol) — the on-chain contract.
- [02-chainlink-ccip-adapter.md](./02-chainlink-ccip-adapter.md) — CCIP as the
  bridge transport.
- [03-marketproxy-and-home-market.md](./03-marketproxy-and-home-market.md) —
  proxy contract design, wrapped receipts, redemption flow.
- [06-security-and-risk-management.md](./06-security-and-risk-management.md) —
  circuit breaker, exposure caps, redemption always allowed.

---

**Status:** Designed (Phase 3). The CRE resolver (Chainlink track) is built and
working on the home chain; cross-chain propagation is future work. This document
is the integration contract for that phase.
