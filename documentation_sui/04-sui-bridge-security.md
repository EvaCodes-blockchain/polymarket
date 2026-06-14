# Sui Bridge — Security and Risk Management

**Document:** 04-sui-bridge-security.md
**Status:** Designed (separate project — Sui-based PolyMarkets + Sui bridge)
**Related:** [README.md](./README.md) | [02-sui-bridge-overview.md](./02-sui-bridge-overview.md) | [03-wormhole-adapter-and-interop.md](./03-wormhole-adapter-and-interop.md) | EVM analog: [../documentation_bridge/06-security-and-risk-management.md](../documentation_bridge/06-security-and-risk-management.md)

This document is the Sui counterpart of the EVM bridge's security model. It keeps
the **same Chainlink-CCIP-inspired defense-in-depth philosophy** as the EVM set,
but adapts every layer to the **EVM↔Sui boundary** and to **Wormhole** as the
concrete transport. Where the EVM bridge leans on a Chainlink CCIP lane (and its
Risk Management Network), the Sui bridge leans on the **Wormhole Guardian
network** — a different trust model that this document analyzes honestly.

> **Honesty note.** Several Wormhole parameters cited below (Guardian quorum,
> Global Accountant / governor limits) change over time and across mainnet vs
> testnet. Values are given as "confirm current value" where they are not safe to
> hard-code. Nothing here is deployed; this is the target safety design.

---

## 1. Trust model and attack surface

### 1.1 The dependency stack

A cross-chain position opened from Sui (Sui-as-proxy, EVM home — the recommended
initial topology, see [02](./02-sui-bridge-overview.md)) depends on the integrity
of **five layers**:

```
┌─────────────────────────────────────────────────────────────┐
│  EVM Home Chain Safety & Liveness                            │  ← must finalize, not reorg
├─────────────────────────────────────────────────────────────┤
│  EVM Home Market Contracts (MarketAMM, OracleResolver)       │  ← must price / settle correctly
├─────────────────────────────────────────────────────────────┤
│  Wormhole transport (Guardian network + VAAs + relays)       │  ← must attest messages honestly, once
├─────────────────────────────────────────────────────────────┤
│  Sui MarketProxy (Move): lock / mint receipt / redemption    │  ← must escrow Coin<USDC>, honor settlement
├─────────────────────────────────────────────────────────────┤
│  Sui Chain Safety & Liveness                                 │  ← must finalize user txs, not equivocate
└─────────────────────────────────────────────────────────────┘
```

**The honest statement** (same shape as whitepaper §5.2): a Sui-proxied position
is **as safe as the weakest of (EVM home chain, Wormhole transport, Sui chain)**.
A single-chain Sui market depends on one chain's safety; a bridged position
inherits the risk of **two chains plus the Guardian set**.

### 1.2 Added attack surface vs single-chain — and vs an EVM-native CCIP lane

| Vector | Single-chain Sui market | Sui↔EVM bridged (Wormhole) | Note vs EVM-native CCIP lane |
|--------|-------------------------|----------------------------|------------------------------|
| Chain liveness | 1 chain | 2 chains (Sui + EVM home); either halting freezes *new* intents (redemptions stay pull-able) | Same 2-chain exposure |
| Reorg / equivocation | 1 chain | 2 chains; finality differences (Sui Mysticeti vs EVM finality) widen the replay window | Comparable |
| Transport trust | none | **Wormhole Guardian quorum** (m-of-n multisig of named operators) | **CCIP's RMN is an independent oracle network + DON, not a fixed multisig** — a different, arguably broader trust base. This is the main trust delta of choosing Wormhole for Sui today. |
| Contract bug | market objects | market + proxy + adapter (Move) + EVM home gateway + EVM adapter | More code, two languages (Move + Solidity) |
| Encoding | none | **BCS (Sui) ↔ abi (EVM)** mismatch is a new, bridge-specific failure class | Not present intra-EVM |
| Censorship/MEV | Sui validators | Sui + EVM validators + Wormhole relayers | One extra relay point |

**Why we accept the Guardian-set trust delta:** Sui has no mature Chainlink CCIP
lane today, and Wormhole is the established general-message bridge with
first-class Move/Sui support. The architecture keeps the transport **pluggable
behind the Move adapter seam** ([03](./03-wormhole-adapter-and-interop.md)), so a
future Sui CCIP lane can replace Wormhole without redesigning the application
layer — at which point this trust delta closes.

---

## 2. Threat catalog with mitigations

| # | Threat | Layer | Mitigation |
|---|--------|-------|------------|
| 1 | **Forged / invalid VAA** (fake settlement or fill) | Transport | Verify every VAA against the on-chain Guardian set via the Wormhole core contract before acting; reject on signature/quorum failure. The adapter never trusts payload bytes that did not arrive inside a verified VAA. |
| 2 | **Guardian-set compromise** (≥ quorum of Guardians collude/keys stolen) | Transport | Cannot be fully mitigated at the app layer — this is the irreducible Wormhole trust assumption. Bound the damage with **per-route exposure caps** (§6) and the **circuit breaker** (§4) so a single forged batch cannot drain more than a route's cap. Monitor Guardian liveness/governance (§7). |
| 3 | **VAA replay** (re-submitting a valid VAA to double-credit) | Transport / Proxy | On-chain **consumed-VAA set**: store each redeemed VAA hash (Wormhole `vaa::digest`) in a shared object; reject if already present. Per-emitter **sequence numbers** enforce ordering. Effectively-once = at-least-once delivery + on-chain idempotency. |
| 4 | **Sui reorg / equivocation** | Sui chain | Wait for Sui **finality (checkpoint commitment)** before publishing a cross-chain intent; the proxy only emits the Wormhole message after the locking tx is final. Symmetrically, the EVM side waits for its own finality before acting on a Sui-origin VAA. |
| 5 | **Move object-ownership bug** (escrow drained / receipt minted without lock) | Proxy (Move) | Resource-typed escrow: locked collateral lives as a `Balance<USDC>` field inside the shared `Market`/`Proxy` object; it cannot be copied or dropped (Move resource safety). Receipts mint **only** in the same function that took custody, guarded by the conservation invariant (§ below). Capability-gated admin paths. Audit + formal-spec the escrow module. |
| 6 | **Emitter spoofing** (a different contract claims to be the home gateway) | Transport / Proxy | **Emitter allowlist per route**: the proxy accepts VAAs only from the registered `(wormhole_chain_id, emitter_address)` of the EVM home adapter; any other emitter is rejected. Symmetric allowlist on the EVM side for the Sui emitter. |
| 7 | **BCS ↔ abi deserialization mismatch** (encoding drift corrupts a payload) | Encoding | A **frozen wire spec** (see [03](./03-wormhole-adapter-and-interop.md)) with a `version` byte and explicit per-field width; cross-language round-trip test vectors in CI; reject unknown versions. A mismatch fails closed (revert/abort), never silently mis-credits. |
| 8 | **Liquidity drain via a bad/poisoned route** | App | Per-route **exposure cap** (§6) bounds the most a single route can owe; route registration is capability-gated; new routes start with a low cap and ramp. |
| 9 | **Stuck intents / griefing** (locked collateral, no fill/refund) | App | Every BuyIntent carries a deadline; past it the user can **pull a refund** of locked Coin<USDC> on Sui without any counter-message (the home side, if it filled, reconciles via its own confirmation). Refund path is never pausable. |
| 10 | **Oracle / resolution manipulation** | Home | Resolution happens **once on the EVM home** via `OracleResolver` with the public oracle-proof commitment, then propagates to Sui as a `ResolutionBroadcast` VAA. No new oracle attack surface is introduced on Sui — the Sui side only *applies* a verified home resolution; it never decides outcomes. |
| 11 | **Relayer withholding** (a VAA is signed but not delivered) | Transport | VAAs are **pull-redeemable**: anyone (the user, a Justify relayer, a watchtower) can submit the VAA to the destination. Withholding delays, it cannot censor, because the signed VAA is public on the Guardian gossip layer. |
| 12 | **Global Accountant / governor stall** (Wormhole rate-limits a large transfer) | Transport | Expected behavior, not an attack: surface the delay in the UI; the value leg completes when the governor window clears. Keep per-trade sizes within the governor limit where known (confirm current limits). |

---

## 3. The Chainlink RMN parallel — defense-in-depth inspiration

### 3.1 What Chainlink CCIP provides (the model we inherit conceptually)

Chainlink CCIP layers an **independent Risk Management Network (RMN)** beneath the
DON: a separate set of nodes, with separate code and operators, that **blesses**
(approves) committed message roots and can **curse** (halt) a lane on detecting an
anomaly — a second, independent validation of the same messages. CCIP also
enforces **per-lane rate limits** (token-pool caps) that bound throughput.

### 3.2 Wormhole's analog — and how it differs

| Concern | Chainlink CCIP | Wormhole (Sui transport) |
|---------|----------------|--------------------------|
| Message attestation | DON commits a Merkle root | **Guardian network** signs a VAA (quorum, e.g. ~13-of-19 — *confirm current quorum*) |
| Independent second check | **RMN** blesses/curses, separate node set | The Guardian quorum **is** the attestation; there is no fully separate "second network" — closer to a single m-of-n multisig of reputable operators |
| Throughput limit | per-lane rate limits | **Global Accountant** + **governor** caps per chain/asset (*confirm current params*) |
| Trust shape | oracle network + independent risk net | named-operator multisig quorum |

**Honest comparison.** CCIP's RMN gives a *structurally independent* second
validation; Wormhole's security rests on the **diversity and honesty of the
Guardian set** plus the Accountant's rate limits. Wormhole's is a narrower trust
base than RMN's "two independent networks" design. We accept it because it is what
ships on Sui today, and we **compensate at the application layer** (§3.3) and keep
the transport swappable.

### 3.3 Justify's RMN-inspired, application-layer guards (same philosophy as EVM)

Exactly as the EVM bridge does, the Sui bridge does **not** rely on the transport
alone. On top of Wormhole it adds:

1. **Per-route exposure caps** (§6) — bound the blast radius of *any* transport
   failure, including a Guardian-set compromise.
2. **Emitter/adapter allowlist per route** (§2 #6) — only the registered home
   gateway can settle a given proxy market.
3. **Circuit breaker** (§4) — pause *new* intents on anomaly, never block exits.
4. **On-chain idempotency** (consumed-VAA set, §2 #3).

This is the Chainlink-CCIP-inspired **defense-in-depth** stance: transport-level
risk controls (Guardians + Accountant ≈ RMN + rate limits) **plus** independent
application-level controls we own and can tune per route.

---

## 4. The circuit breaker — pause new intents, never block redemptions

### 4.1 Design invariant

> The breaker may pause **new cross-chain intents** in either direction.
> It must **never** block **redemption / exit** of an already-settled or
> refundable position on either chain.

A user who has locked collateral or holds a wrapped receipt must always be able to
get out — via the home settlement they are owed, or via the deadline refund.

### 4.2 What trips it

- Cross-route **refund rate** exceeds a threshold (e.g. > 5% of intents in a
  window) — signals encoding/route trouble.
- **Outstanding owed** on a route approaches its exposure cap (§6).
- **Confirmation/fill failures** spike (home side rejecting Sui-origin intents).
- **VAA verification failures** spike (possible forged-VAA probing).
- **Guardian liveness** alert (quorum at risk) — confirm via Wormhole status.

Tripping can be automatic (on-chain counters crossing a threshold) or manual
(BridgeAdmin, §5).

### 4.3 Move-side implementation

A shared `BridgeConfig` object holds the breaker state; the entry that opens a new
intent checks it, the redemption entry does not.

```move
module justify_bridge::config {
    use sui::object::UID;

    /// Shared object; one per deployment. Gated by AdminCap for mutation.
    public struct BridgeConfig has key {
        id: UID,
        paused_intents: bool,      // breaker: blocks NEW intents only
        // per-route caps & outstanding tracked in a Table keyed by route id
    }

    /// Called by the proxy BEFORE locking collateral / publishing a Wormhole msg.
    public fun assert_intents_live(cfg: &BridgeConfig) {
        assert!(!cfg.paused_intents, E_INTENTS_PAUSED);
    }

    // NOTE: there is deliberately NO `assert_*` guard on the redemption /
    // refund path — exit is always permitted. The breaker is one-directional.
}
```

The redemption and deadline-refund entries in the proxy **never call**
`assert_intents_live`, structurally guaranteeing the exit invariant.

### 4.4 Recovery / reset

Un-pausing is capability-gated (BridgeAdminCap) and should follow a checklist:
root cause identified, outstanding reconciled, caps reviewed. Optionally a
timelock on re-enabling a route after a trip.

---

## 5. Governance and access control (Move capability pattern)

### 5.1 Capabilities replace role mappings

EVM `AccessControl.sol` uses role → address mappings. Sui/Move uses **capability
objects**: holding the object *is* the authorization (no global mapping to check,
no role-grant griefing). Building on [01](./01-move-market-contracts.md):

| Capability (owned object) | Authorizes | Held by |
|---------------------------|------------|---------|
| `AdminCap` | top-level admin of the markets package | protocol multisig |
| `BridgeAdminCap` | allowlist emitters/routes; set exposure caps; trip/reset breaker | bridge governance multisig |
| `ResolverCap` | apply a verified `ResolutionBroadcast` on Sui | the bridge adapter (delegated), not a human |

Capabilities are transferable to a multisig / governance object; revocation = move
the cap to a burn/escrow object. No single EOA holds god power.

### 5.2 Who allowlists what

- **Routes & emitters:** `BridgeAdminCap` registers each `(wormhole_chain_id,
  emitter_address) → route` pair. An unregistered emitter's VAA is rejected (§2
  #6). New routes start paused / low-cap and ramp.
- **Exposure caps:** `BridgeAdminCap` sets and adjusts per-route caps (§6).
- **Breaker:** `BridgeAdminCap` trips/resets (§4).

### 5.3 Upgrade philosophy — and Sui's package-upgrade reality

Whitepaper §7: no upgradeable god-contract; fix a bad parameter by **redeploying a
market**, not by mutating the protocol. Two Sui-specific honesty points:

- Sui packages can be **immutable** or **upgradeable** (UpgradeCap). We prefer
  **immutable market logic** with parameters in mutable *shared objects* (caps,
  allowlists, breaker) — so behavior is tuned via data, not code, and the code
  surface is frozen and auditable.
- Where upgradeability is genuinely needed, the `UpgradeCap` is held by the same
  governance multisig and its policy (e.g. `additive`/`dep-only`) should be
  restricted; document any upgradeable package explicitly. Confirm the chosen
  policy against the current Sui framework version.

---

## 6. Per-route exposure caps — bounding the blast radius

### 6.1 Threat model

Caps exist so that *no single transport or route failure* — including a
Guardian-set compromise — can cost more than a bounded amount. The cap is the hard
ceiling on **outstanding collateral owed across a route** at any time.

### 6.2 How exposure is tracked

For each route, the proxy maintains `outstanding` in the `BridgeConfig` table:

- **+** when a BuyIntent locks collateral and is in-flight to the home market.
- **−** when a FillConfirmation or RefundNotice for that route is applied.
- A new intent **aborts** if `outstanding + amount > cap`.

```move
public fun reserve_route_capacity(cfg: &mut BridgeConfig, route: u16, amount: u64) {
    let used = current_outstanding(cfg, route);
    assert!(used + amount <= route_cap(cfg, route), E_ROUTE_CAP_EXCEEDED);
    set_outstanding(cfg, route, used + amount);
}
```

### 6.3 Suggested parameters (illustrative — tune in production)

| Route | Transport | Suggested initial cap |
|-------|-----------|-----------------------|
| Sui → EVM home (Arc/Base) | Wormhole | start small (e.g. 250k USDC), ramp with confidence |
| EVM home → Sui (settlement) | Wormhole | settlement is pull-based; cap the *new-intent* direction, not exits |

Ramp caps as the route accrues a clean track record; never set a cap above the
**Wormhole governor limit** for the asset (confirm current limit) — the governor
would throttle anyway.

### 6.4 Relation to Wormhole governor limits

The Wormhole **Global Accountant / governor** already rate-limits large
transfers per chain/asset. Justify's per-route caps are **complementary, not
redundant**: the governor is global and protocol-wide; our caps are
**per-market-route and tunable by us**, and trip our own breaker — giving an
independent, faster, application-owned control surface.

---

## 7. Operational runbook (stub)

### 7.1 Monitoring signals

- **VAA latency** Sui→EVM and EVM→Sui (publish → redeem); alert on tail spikes.
- **Guardian liveness / quorum health** (confirm via Wormhole status feeds).
- **Refund rate** per route (breaker input, §4.2).
- **Outstanding vs cap** per route (approaching-cap alert).
- **VAA verification failures** (forged-VAA probing).
- **Consumed-VAA set growth** vs expected message volume (replay attempts).

### 7.2 Incident response

1. **Trip the breaker** (`BridgeAdminCap`) — pauses new intents both directions;
   exits remain open (§4.1).
2. **Diagnose** — encoding mismatch? emitter anomaly? Guardian alert? home-side
   rejection? Use the monitoring signals + the VAA hash to trace a specific
   message.
3. **Contain** — if one route is implicated, lower its cap to 0 (route-level
   pause) while leaving healthy routes live.

### 7.3 Recovery

- **Replay redeemable VAAs** — signed VAAs are public; anyone can resubmit a
  withheld settlement VAA to unstick a position (§2 #11).
- **Pull-based exit** — users redeem settled receipts / claim deadline refunds
  with no dependency on the breaker state.
- **Reset** — un-pause per §4.4 after root cause + reconciliation.

---

## 8. Summary

The Sui bridge keeps the EVM bridge's **Chainlink-CCIP-inspired defense-in-depth**:
rely on the transport's own risk layer — here the **Wormhole Guardian quorum +
Global Accountant**, the analog of CCIP's **RMN + rate limits** — and **add
independent application-layer guards** Justify owns: per-route exposure caps, an
emitter/adapter allowlist per route, on-chain VAA idempotency, and a
one-directional circuit breaker that pauses new intents but **never blocks exit**.

The honest trade-off of choosing Wormhole for Sui is a **narrower transport trust
base** than a Chainlink CCIP lane's RMN. We bound that risk with caps + breaker and
keep the transport **swappable behind the Move adapter seam**, so a future Sui CCIP
lane closes the gap without an application rewrite.

> Designed, not deployed. Wormhole quorum/governor parameters and Sui package-
> upgrade policy must be confirmed against current Wormhole and Sui framework
> versions before any deployment.
