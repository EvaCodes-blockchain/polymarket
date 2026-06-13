# Security and Risk Management — Justify Bridge Layer

**Document:** 06-security-and-risk-management.md  
**Status:** Designed (Phase 3 — bridge-proxied markets)  
**Related:** [Whitepaper §5.2 & §7](../documentation_justify_whitepaper/justify-whitepaper.md) | [01-bridge-adapter-interface.md](./01-bridge-adapter-interface.md) | [02-chainlink-ccip-adapter.md](./02-chainlink-ccip-adapter.md) | [03-marketproxy-and-home-market.md](./03-marketproxy-and-home-market.md) | [05-cross-chain-resolution.md](./05-cross-chain-resolution.md)

---

## 1. Trust model and attack surface

### 1.1 The fundamental dependency stack

A cross-chain position in Justify depends on the integrity of **five layers**:

```
┌─────────────────────────────────────────────────────┐
│  Home Chain Safety & Liveness                       │  ← Must produce blocks, finalize, not reorg
├─────────────────────────────────────────────────────┤
│  Home Market Contracts (MarketAMM, OracleResolver)  │  ← Must price/settle correctly
├─────────────────────────────────────────────────────┤
│  Bridge Adapter Transport (CCIP DON, LayerZero)     │  ← Must deliver messages honestly, in order
├─────────────────────────────────────────────────────┤
│  MarketProxy Contract (lock/mint/redemption logic)  │  ← Must escrow collateral, honor settlements
├─────────────────────────────────────────────────────┤
│  Proxy Chain Safety & Liveness                      │  ← Must finalize user transactions, not reorg
└─────────────────────────────────────────────────────┘
```

**Whitepaper §5.2 trust model:** "A proxy position is as safe as the **weakest of** (home chain, bridge adapter)." This is the honest statement: cross-chain positions inherit the risk of **both** the home settlement layer **and** the bridge transport. Where a single-chain position depends on one chain's liveness, a proxied position depends on two chains + the bridge integrity.

### 1.2 Quantifying the added attack surface

| Attack vector                        | Single-chain market                      | Bridge-proxied market                                                                                     |
|--------------------------------------|------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| **Chain liveness failure**           | 1 chain (home)                           | 2 chains (home + proxy); if either halts, new positions freeze (but redemptions still possible via pull) |
| **Chain reorg / finality violation** | 1 chain (home)                           | 2 chains; reorg on either can cause message replay or state divergence                                    |
| **Contract bug**                     | Home market contracts                    | Home market + proxy contracts + bridge adapter contracts                                                  |
| **Oracle manipulation**              | Home chain resolver only                 | Home chain resolver (resolution propagates outward, so no new attack but inherited risk)                  |
| **Censorship / MEV**                 | Home chain validators                    | Home chain + proxy chain + bridge relay operators (3 censorship points)                                   |
| **Bridge transport failure**         | N/A                                      | Message loss, replay, reordering, or malicious message injection by compromised bridge                    |
| **Collateral custody**               | 1 pool (home AMM)                        | Collateral escrowed on proxy + collateral in home AMM (larger blast radius if proxy is compromised)       |

**The honest assessment:** Bridge-proxied markets trade **distribution** (users trade from any chain) for **complexity** (more failure modes). The safety architecture below mitigates the added risk but does not eliminate it.

---

## 2. Threat catalog with mitigations

| Threat                                                       | Attack scenario                                                                                                                                                   | Mitigation                                                                                                                                                                                                                |
|--------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Malicious bridge message**                                 | A compromised or malicious bridge adapter sends a fabricated `FillConfirmation` to mint unbacked wrapped receipts on a proxy, draining the collateral pool.       | **Adapter allowlist per route** (§6). Only governance-approved adapters can send messages. CCIP's Risk Management Network (§3) provides a second blessing layer for CCIP routes.                                          |
| **Message replay attack**                                    | An attacker re-sends a valid historical message (e.g., a `BuyIntent`) multiple times to drain collateral or double-mint receipts.                                 | **On-chain idempotency** (§2.4 of doc 01). Each message ID is hashed and stored in `processedMessages` mapping; duplicate IDs revert. Per-trader nonces enforce ordering.                                                |
| **Source chain reorg**                                       | Proxy chain reorgs after a `BuyIntent` is sent; the intent never actually happened on-chain, but the home market already filled it.                               | **Finality delay on proxy.** Proxy only sends intents after the transaction reaches finality (e.g., 64 blocks on Ethereum). CCIP enforces finality thresholds before accepting messages.                                  |
| **Home chain reorg**                                         | Home market fills an intent, sends `FillConfirmation`, then reorgs; the fill is undone but the proxy already minted receipts.                                     | **Finality delay on home.** Proxies only accept confirmations after home-chain finality. CCIP's OffRamp enforces this. Manual disaster recovery if a deep reorg occurs (pause, reconcile, redeploy if necessary).         |
| **Bridge adapter bug / compromise**                          | A bug in the CCIP adapter or LayerZero adapter allows message forgery or message loss.                                                                            | **Per-route exposure caps** (§6). Each route has a max outstanding collateral cap; once hit, new intents revert. Limits blast radius. + **Adapter allowlist:** only audited, governance-approved adapters.                |
| **Oracle / resolution manipulation**                         | A malicious resolver settles a market incorrectly on the home chain; the bad resolution propagates to all proxies.                                                | **Inherited from home chain OracleResolver.** Bridge adds no new attack surface here (resolution is home-authoritative). Future: decentralized resolution via CRE (doc 05) + dispute escalation removes single point.     |
| **Liquidity drain via a bad route**                          | An attacker exploits a low-security bridge route (e.g., a newly added, poorly audited adapter) to drain proxy collateral into the home market, then extracts it. | **Per-route exposure caps** (§6). Each route is capped independently; a bad route can only drain up to its cap, not the entire protocol. + **Allowlist:** only vetted adapters per route.                                 |
| **Griefing via stuck intents**                               | An attacker sends many small intents that intentionally fail on the home market (e.g., max slippage = 0), locking collateral on the proxy and forcing refunds.   | **Refund gas cost borne by attacker.** Intentionally failing intents still pay bridge fees. Protocol can set a minimum intent size to make griefing uneconomical. Circuit breaker trips on anomalous refund rate (§4).    |
| **Front-running / MEV on bridge messages**                   | A validator or relayer observes a large `BuyIntent` in the bridge queue and front-runs it on the home AMM to move the price.                                      | **Slippage bounds in intent.** User's `maxSlippage` parameter enforces bounded fill or refund; attacker cannot force a worse-than-quoted fill. Home AMM is CPMM (no order book), so front-running is limited to sandwich. |
| **Circuit breaker manipulation**                             | An attacker triggers the circuit breaker (§4) to halt new proxy intents, griefing users.                                                                          | **High anomaly thresholds.** Circuit breaker only trips on statistically significant deviations (e.g., >5% of intents refunded in 1 hour). Governance can tune thresholds per route.                                      |
| **Collateral token compromise (proxy chain)**                | Proxy chain's USDC contract is compromised or frozen; escrowed collateral is lost.                                                                                | **Chain-canonical stablecoins only** (whitepaper §7). Justify only uses Circle USDC (where available) or audited, widely adopted stablecoins. + Per-route exposure caps bound loss.                                       |
| **Smart contract upgrade attack (malicious proxy upgrade)**  | If proxies were upgradeable, a malicious admin could upgrade the logic to steal escrowed collateral.                                                              | **No upgradeable contracts** (whitepaper §7, injected-dependency pattern). Proxies are immutable; a bad parameter is fixed by redeploying a *new* proxy, not by upgrading. Admin keys cannot mutate deployed logic.      |

---

## 3. The Chainlink Risk Management Network parallel — defense-in-depth inspiration

### 3.1 Chainlink CCIP's Risk Management Network (RMN)

Chainlink CCIP has an **independent Risk Management Network** — a separate set of nodes that monitors all cross-chain messages and provides a second validation layer:

- **Blessing:** The RMN independently verifies that a message from an OnRamp is legitimate (not forged, not replayed, within rate limits). The OffRamp only executes messages that are *both* delivered by the Decentralized Oracle Network (DON) *and* blessed by the RMN.
- **Cursing:** If the RMN detects anomalies (e.g., a DON delivering messages that violate lane rate limits or finality rules), it can **curse** a lane, halting all message delivery on that route until governance intervenes.
- **Per-lane rate limits:** CCIP enforces token-transfer caps per lane (e.g., max 1M USDC/hour on Base → Ethereum). The RMN monitors these; exceeding the cap triggers a curse.

**The result:** Even if the CCIP DON is compromised, the RMN acts as a secondary check. An attacker must compromise *both* the DON and the RMN to inject a malicious message — defense-in-depth.

### 3.2 Justify's bridge safety architecture — RMN-inspired, application-layer

**Justify's bridge layer is explicitly inspired by Chainlink CCIP's defense-in-depth model (Risk Management Network + per-lane rate limits).** Where CCIP operates at the transport layer (blessing/cursing messages), Justify adds **application-layer guards** on top:

```
┌─────────────────────────────────────────────────────────────────┐
│  CCIP Transport (inherited RMN protection)                      │
│  - RMN blesses/curses messages                                  │
│  - Per-lane token-pool rate limits (e.g., 1M USDC/hour)         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Justify uses CCIP as first adapter
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Justify Application-Layer Guards (added on top)                │
│  1. Per-route exposure caps (§6)       ← CCIP lane limits       │
│  2. Allowlist of adapters per route (§6) ← CCIP adapter vetted  │
│  3. Circuit breaker (§4)               ← Anomaly detection      │
│  4. Idempotency + nonce ordering (doc 01) ← Replay protection   │
└─────────────────────────────────────────────────────────────────┘
```

**By using CCIP as the transport, Justify INHERITS the RMN's protection** (messages already blessed by an independent network), **THEN ADDS** its own application-specific defenses:

1. **Per-route exposure caps** (analogous to CCIP lane rate limits, but at the Justify protocol layer).
2. **Adapter allowlists** (only governance-approved adapters can route messages into Justify markets).
3. **Circuit breaker** (pauses new proxy intents on anomaly detection, never blocks redemptions).
4. **On-chain idempotency and nonce ordering** (prevents replays and enforces per-trader ordering).

**The philosophy:** Trust the bridge transport (CCIP, LayerZero), but verify at the application layer. Even if a bridge adapter is compromised, Justify's caps and circuit breaker bound the blast radius.

---

## 4. The circuit breaker — pause new intents, never block redemptions

### 4.1 Design invariant

**Whitepaper §7:** "A circuit-breaker pausing new proxy intents but NEVER blocking redemptions."

**The non-negotiable rule:** Users can **always exit their positions**, even if the bridge is compromised or the circuit breaker has tripped. The circuit breaker halts new *entries* (new buy/sell intents from proxies) but never stops redemptions (unwinding positions after settlement).

### 4.2 What trips the circuit breaker

The circuit breaker monitors **anomaly signals** per route:

| Anomaly threshold                                      | Action                                   | Rationale                                                                                                                     |
|--------------------------------------------------------|------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| **Refund rate > 5% of intents in 1-hour window**      | Trip breaker for that route              | Normal refund rate due to slippage is ~0.1–0.5%. A spike to >5% suggests AMM manipulation, bridge message corruption, or attack. |
| **Outstanding collateral > route exposure cap**       | Revert new intents (automatic, no trip)  | Hard cap per route (§6); once hit, no new intents until outstanding collateral drops below cap.                              |
| **Home market fails to confirm > 50% of intents in 1h** | Trip breaker for that route              | Suggests home-chain liveness failure or bridge message loss.                                                                  |
| **Manual governance intervention**                     | Trip breaker globally or per route       | Emergency response to detected compromise or anomaly not covered by automated thresholds.                                     |

**When tripped:** The proxy's `buy()` and `sell()` functions revert with `CircuitBreakerTripped()` error. Existing positions are unaffected; users can still redeem after settlement (redemption is local to the proxy, no bridge message required in the pull-based model — see §4.3).

### 4.3 Redemption invariant — always exit-able

**Two redemption paths:**

1. **Home-chain redemption:** Users with native home-market positions (no proxy) redeem directly on the home chain after `OracleResolver.resolve()` — no bridge dependency.
2. **Proxy-chain redemption:** Users with wrapped receipts on a proxy redeem *after* the home-market resolution is bridged to the proxy (doc 05). If the bridge is down, the proxy has a **pull-based redemption fallback**:

   ```solidity
   // Fallback: user provides Merkle proof of home-market resolution
   // (sourced from home chain via off-chain indexer or explorer)
   function redeemWithProof(
       uint256 marketId,
       uint8 winningOutcome,
       bytes32[] calldata merkleProof
   ) external {
       // Verify proof against root stored by governance
       require(verifyResolutionProof(marketId, winningOutcome, merkleProof), "Invalid proof");
       // Burn wrapped receipt, release collateral
       _redeem(msg.sender, marketId, winningOutcome);
   }
   ```

**Result:** Even if the bridge is permanently compromised and the circuit breaker trips forever, users can exit via the pull-based proof path. Redemptions are **never blocked**.

### 4.4 Recovery and reset

After the circuit breaker trips:

1. **Diagnosis:** Governance investigates the anomaly (on-chain forensics, bridge adapter audit, home-market state check).
2. **Remediation:** If a bug is found, deploy a patched adapter or proxy; if an attack is detected, blacklist the malicious adapter.
3. **Reset:** Governance calls `CircuitBreaker.reset(routeId)` to re-enable new intents on that route.
4. **Post-mortem:** Document the incident, tune thresholds if false positive, publish transparency report.

---

## 5. Governance and access control

### 5.1 Role model (consistent with AccessControl.sol)

Justify's contracts use OpenZeppelin's `AccessControl` for role-based permissions. The bridge layer extends this:

| Role                  | Powers                                                                                                             | Holder(s)                                                    |
|-----------------------|--------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------|
| `DEFAULT_ADMIN_ROLE`  | Can grant/revoke all roles; top-level governance.                                                                  | Deployer (initially), then multisig or DAO (future).         |
| `RESOLVER_ROLE`       | Can call `OracleResolver.resolve()` to settle markets on home chain.                                               | Authorized resolver service (manual in MVP, CRE in future).  |
| `FACTORY_ROLE`        | Can call `MarketFactory.createMarket()` to deploy new markets.                                                     | Backend service (validates market-creation requests).        |
| `BRIDGE_ADMIN_ROLE`   | Can allowlist/denylist bridge adapters per route; set per-route exposure caps; trip/reset circuit breaker.         | Governance multisig (3/5 or DAO).                            |
| `TREASURY_ROLE`       | Can withdraw fees from `FeeTreasury`.                                                                              | Protocol treasury multisig.                                  |

**New role for bridge phase:** `BRIDGE_ADMIN_ROLE` controls the bridge safety parameters. This role is separate from `RESOLVER_ROLE` and `FACTORY_ROLE` to enforce separation of concerns (bridge operations vs. market operations).

### 5.2 Adapter allowlist and per-route registration

Each bridge route (e.g., Arc → Base via CCIP, Base → Polygon via LayerZero) requires explicit governance approval:

```solidity
// In BridgeRegistry (deployed once per chain)
struct RouteConfig {
    address adapter;           // IBridgeAdapter implementation
    uint256 exposureCap;       // Max outstanding collateral for this route (USDC units)
    bool enabled;              // Circuit breaker state
    uint64 homeChainSelector;  // CCIP chain selector for home chain
    uint64 proxyChainSelector; // CCIP chain selector for proxy chain
}

mapping(bytes32 => RouteConfig) public routes;

// Only BRIDGE_ADMIN_ROLE can call
function registerRoute(
    bytes32 routeId,
    address adapter,
    uint256 exposureCap,
    uint64 homeChainSelector,
    uint64 proxyChainSelector
) external onlyRole(BRIDGE_ADMIN_ROLE) {
    require(adapter != address(0), "Invalid adapter");
    require(exposureCap > 0, "Cap must be positive");
    routes[routeId] = RouteConfig({
        adapter: adapter,
        exposureCap: exposureCap,
        enabled: true,
        homeChainSelector: homeChainSelector,
        proxyChainSelector: proxyChainSelector
    });
    emit RouteRegistered(routeId, adapter, exposureCap);
}

function disableRoute(bytes32 routeId) external onlyRole(BRIDGE_ADMIN_ROLE) {
    routes[routeId].enabled = false;
    emit RouteDisabled(routeId);
}
```

**Process for adding a new route:**

1. Governance proposal: "Add Base → Polygon route via LayerZero adapter X at 500k USDC exposure cap."
2. Audit the adapter contract + integration test + testnet trial.
3. Governance multisig calls `BridgeRegistry.registerRoute()`.
4. Route is live; proxies on Polygon can now forward intents to Base home markets.

### 5.3 Upgrade and redeployment philosophy (whitepaper §7)

**No upgradeable god-contracts.** Justify follows the **injected-dependency pattern**:

- Contracts are **immutable** (no `delegatecall` proxies, no admin functions that mutate core logic).
- External dependencies (collateral token, bridge adapter, fee treasury) are **constructor parameters**, not storage slots an admin can rewrite.
- If a parameter is wrong (e.g., a bad adapter), the fix is to **redeploy a new contract** with the correct parameter, not to upgrade the existing one.

**Why:** Upgradeable contracts create a trust assumption (users trust the admin key not to rug). Immutable contracts + redeployment removes that trust vector. The cost is operational (redeployment requires migrating state or deprecating the old contract), but the security gain is worth it.

**For bridges specifically:**

- A bad `MarketProxy` is deprecated (circuit breaker tripped, users migrate to a new proxy with a patched adapter).
- A bad `IBridgeAdapter` is removed from the allowlist; a new audited adapter is registered.
- The home market is never upgraded (resolution is final; no do-overs). A bug in the home market is a protocol-level incident requiring governance intervention (e.g., deploy a replacement market, compensate affected users via treasury).

---

## 6. Per-route exposure caps — bounding the blast radius

### 6.1 The threat model

Each bridge route is an **independent attack surface**. A newly added route with a less-audited adapter (e.g., a new LayerZero-class bridge) carries higher risk than a mature CCIP route. Without caps, a compromised route could drain the entire protocol's collateral.

**Per-route exposure caps bound the blast radius:** if a route's adapter is compromised and fabricates a malicious message, it can only extract collateral up to that route's cap, not the entire protocol TVL.

### 6.2 How exposure is tracked

Each `MarketProxy` tracks **outstanding collateral** for its route:

```solidity
// In MarketProxy
uint256 public outstandingCollateral; // Total collateral locked in pending/filled intents

function buy(uint8 outcomeIndex, uint256 collateralIn, uint256 maxSlippage) external {
    // Check exposure cap (BridgeRegistry enforces this)
    require(
        outstandingCollateral + collateralIn <= bridgeRegistry.getExposureCap(routeId),
        "Route exposure cap exceeded"
    );

    // Lock collateral, increment outstanding
    collateral.transferFrom(msg.sender, address(this), collateralIn);
    outstandingCollateral += collateralIn;

    // Send BuyIntent to home market
    bytes32 messageId = bridgeAdapter.sendMessage(...);
    emit IntentSent(messageId, outcomeIndex, collateralIn);
}

function _onFillConfirmation(FillConfirmation memory fill) internal {
    // Mint wrapped receipt, decrement outstanding
    wrappedReceipts[fill.trader][fill.outcomeIndex] += fill.sharesOut;
    outstandingCollateral -= fill.collateralIn; // (collateral now "converted" to shares)
    emit Filled(fill.trader, fill.sharesOut);
}

function _onRefund(RefundNotice memory refund) internal {
    // Unlock collateral, decrement outstanding
    collateral.transfer(refund.trader, refund.refundAmount);
    outstandingCollateral -= refund.refundAmount;
    emit Refunded(refund.trader, refund.refundAmount);
}
```

**Outstanding collateral decreases** when:
- A fill confirmation arrives (collateral converted to wrapped receipts).
- A refund notice arrives (collateral unlocked).
- A redemption happens (wrapped receipts burned, collateral paid out).

**Outstanding collateral increases** only on new intents (buy/sell).

### 6.3 Suggested parameters

| Route                     | Exposure cap (USDC) | Rationale                                                                                                                 |
|---------------------------|---------------------|---------------------------------------------------------------------------------------------------------------------------|
| **Arc → Base (CCIP)**     | 5M                  | Highest security (CCIP + RMN); largest expected volume; Arc as home for stablecoin-native UX.                            |
| **Base → Ethereum (CCIP)**| 10M                 | Ethereum is deepest liquidity; CCIP + RMN protection; high cap justified.                                                 |
| **Polygon → Base (CCIP)** | 2M                  | Polygon has high retail volume; CCIP route; moderate cap.                                                                 |
| **BSC → Base (LayerZero)**| 500k                | BSC has large user base but LayerZero adapter is newer; conservative cap until proven. Raise cap after 3 months incident-free. |
| **Testnet routes**        | 100k (testnet USDC) | Low cap for testing; unlimited upside risk is acceptable on testnet.                                                      |

**Governance can adjust caps** via `BridgeRegistry.setExposureCap(routeId, newCap)` (requires `BRIDGE_ADMIN_ROLE`). Caps should be raised gradually as routes prove reliability.

### 6.4 Relation to CCIP lane rate limits

Chainlink CCIP enforces **per-lane token-pool rate limits** (e.g., max 1M USDC/hour Base → Ethereum). Justify's per-route exposure caps are **complementary, not redundant**:

- **CCIP lane limit:** Bounds the *flow rate* (tokens/hour) across the bridge transport. Enforced by CCIP's token pools + RMN.
- **Justify exposure cap:** Bounds the *total outstanding* collateral locked in a route at any time. Enforced by Justify's `MarketProxy`.

**Example:**
- CCIP lane limit: 1M USDC/hour Base → Ethereum.
- Justify exposure cap: 10M USDC Base → Ethereum.
- Scenario: 10M USDC worth of intents are sent in the first hour (allowed by Justify cap), but CCIP lane limit only allows 1M to flow in that hour. Result: intents queue up; CCIP processes 1M/hour until all 10M are delivered. The exposure cap still binds total risk; the lane limit throttles the rate.

**The two limits work together:** CCIP lane limits prevent denial-of-service (flooding the bridge), Justify exposure caps prevent over-exposure to a single route's risk.

---

## 7. Operational runbook — monitoring, incident response, recovery

### 7.1 Monitoring signals (off-chain indexer / alerting service)

| Signal                                                  | Alert threshold                         | Action                                                    |
|---------------------------------------------------------|-----------------------------------------|-----------------------------------------------------------|
| **Refund rate anomaly**                                 | >5% refunds in 1-hour window per route  | Page on-call; investigate home-market state + bridge logs |
| **Outstanding collateral near cap**                     | >90% of exposure cap                    | Notify governance; consider raising cap or throttling     |
| **Intent confirmation latency**                         | >10 minutes (CCIP normal: 2-5 min)      | Check bridge adapter health; alert bridge provider        |
| **Unprocessed intents (stuck messages)**                | Intent sent >1 hour ago, no confirmation| Manual replay via bridge explorer / adapter debug tool    |
| **Circuit breaker trip**                                | Any route disabled                      | Page on-call; diagnose, remediate, document               |
| **Home-market resolution not propagated**               | Resolution on home chain >2 hours, no proxy broadcast | Manually trigger resolution broadcast (doc 05)            |
| **Large single intent (whale alert)**                   | Intent >100k USDC                       | Monitor for front-running / MEV; normal operation, log only|

### 7.2 Incident response — trip the breaker, diagnose, recover

**Phase 1: Detection and containment (minutes)**

1. Automated monitoring detects anomaly (e.g., refund rate spike).
2. Circuit breaker auto-trips (if threshold exceeded) OR on-call admin manually trips via `BridgeRegistry.disableRoute(routeId)`.
3. New intents halt; existing positions and redemptions unaffected.

**Phase 2: Diagnosis (hours)**

4. On-call team pulls logs from:
   - Proxy contract events (`IntentSent`, `Filled`, `Refunded`).
   - Bridge adapter (CCIP Explorer, LayerZero Scan).
   - Home market events (`Trade`, `Resolved`).
5. Identify root cause:
   - Bridge message corruption? → Adapter bug or transport issue.
   - Home AMM manipulation? → Front-running, liquidity drain, price oracle failure.
   - Malicious actor? → Trace attacker address, freeze if possible (collateral still escrowed).

**Phase 3: Remediation (days)**

6. If adapter bug: deploy patched adapter, audit, register as new route, deprecate old route.
7. If transport issue: coordinate with bridge provider (Chainlink, LayerZero) for fix.
8. If attack: blacklist malicious adapter, compensate affected users from treasury if necessary.

**Phase 4: Recovery (days to weeks)**

9. Once remediated, governance resets circuit breaker: `BridgeRegistry.enableRoute(routeId)` or `registerRoute(newRouteId, patchedAdapter, newCap)`.
10. Post-mortem published (transparency report): what happened, how fixed, parameter changes.
11. Resume normal operations; monitor for recurrence.

### 7.3 Recovery tools

**For stuck intents (bridge message lost or delayed):**

- **Manual replay:** Governance can call `BridgeAdapter.replayMessage(messageId)` to resend a lost intent. Requires off-chain verification that the message was legitimately sent but not delivered.
- **Pull-based confirmation:** If the bridge is permanently down, users can submit a Merkle proof (sourced from home-chain state) to finalize their intent on the proxy (similar to redemption fallback in §4.3).

**For compromised route:**

- **Route deprecation:** Disable the route, deploy a new proxy with a patched adapter. Users migrate positions to the new proxy via a "migration market" (governance can create a 1:1 swap market to move wrapped receipts from old proxy to new proxy without price risk).

**For home-market bug:**

- **No on-chain recovery** (contracts are immutable). Governance can:
  - Deploy a replacement market.
  - Use treasury to compensate affected users (if bug caused incorrect settlement).
  - Document as protocol incident; transparency report; adjust future market parameters.

---

## 8. Summary — defense-in-depth, RMN-inspired, exit-always

Justify's bridge security model is built on **six pillars**:

1. **Inherited CCIP RMN protection:** By using Chainlink CCIP as the primary transport, Justify inherits the Risk Management Network's blessing/cursing and per-lane rate limits — a proven defense-in-depth architecture (§3).
2. **Application-layer exposure caps:** Per-route caps bound the blast radius of a compromised adapter, independent of CCIP's lane limits (§6).
3. **Adapter allowlists:** Only governance-approved, audited adapters can route messages into Justify markets (§5).
4. **Circuit breaker:** Automated anomaly detection trips a breaker to halt new intents while preserving redemptions — the user's exit is never blocked (§4).
5. **Immutable contracts + injected dependencies:** No upgradeable god-contracts; a bad parameter is fixed by redeployment, not mutation — removes admin-key rug risk (§5.3).
6. **On-chain idempotency + nonce ordering:** Prevents replay attacks and enforces per-trader message ordering (doc 01, §4).

**The honest trade-off:** Cross-chain positions are "as safe as the weakest of (home chain, bridge adapter)" (§1). Justify's architecture does not eliminate bridge risk — it **bounds, monitors, and mitigates** it. Users who cannot tolerate bridge risk can trade natively on the home chain with zero bridge dependency.

**The non-negotiable invariant (whitepaper §7):** Users can **always exit their positions**, even if the bridge fails, the circuit breaker trips, or the protocol is in disaster-recovery mode. Redemptions are never blocked.

---

**Forward links:**

- **[02-chainlink-ccip-adapter.md](./02-chainlink-ccip-adapter.md)** — The CCIP adapter that provides RMN protection and lane rate limits at the transport layer.
- **[03-marketproxy-and-home-market.md](./03-marketproxy-and-home-market.md)** — How `MarketProxy` enforces exposure caps and circuit breaker checks on buy/sell.
- **[05-cross-chain-resolution.md](./05-cross-chain-resolution.md)** — Resolution propagation and the pull-based redemption fallback.

---

**Status:** Designed. Not deployed. This document defines the safety architecture for Phase 3 (bridge-proxied markets). The MVP (Phase 0) is single-chain; the multi-chain native phase (Phase 2) has no bridge dependency. This spec is the blueprint for when Justify bridges markets across Arc, Base, Ethereum, Polygon, and BSC.
