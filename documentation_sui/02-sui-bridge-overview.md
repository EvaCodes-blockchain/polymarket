# Sui Bridge Overview — connecting Sui markets to the EVM network

**Document:** 02-sui-bridge-overview.md  
**Status:** Design (separate project, forward-looking)  
**Related:** [00-sui-polymarkets-overview.md](./00-sui-polymarkets-overview.md) | [01-move-market-contracts.md](./01-move-market-contracts.md) | [03-wormhole-adapter-and-interop.md](./03-wormhole-adapter-and-interop.md)

---

## 1. Goal — unified liquidity across Sui and EVM

The Sui bridge solves the same problem as the EVM bridge set (see [`documentation_bridge/00-overview.md`](../documentation_bridge/00-overview.md)): **liquidity fragmentation by chain for the same event**. Where the EVM bridge unifies Arc, Base, Ethereum, Polygon, and BSC into one logical market per event, the Sui bridge extends that unification **across the EVM/non-EVM boundary** — connecting Sui markets to the existing EVM home/proxy network.

Two integration directions:

### 1.1 Sui as a PROXY chain (recommended initial path)

- **Home market:** lives on an EVM chain (e.g., Arc, Base, Ethereum) with its `PredictionMarket`, `MarketAMM`, collateral pool, and `OracleResolver`.
- **Sui proxy:** a lightweight Move package on Sui that accepts Sui USDC, locks it, emits a bridge message (buy/sell intent) to the EVM home market via Wormhole, receives confirmation, and mints a **wrapped position receipt** on Sui representing the outcome shares held in the EVM AMM pool.
- **Result:** Sui users trade on markets created on EVM chains, contributing liquidity to the same unified AMM that EVM users trade against. One price per outcome per event — Sui and EVM see the same depth.

**Why this first:** the EVM home-market stack is already built and deployed (Phase 2 of the EVM roadmap). Adding Sui as a proxy reuses that infrastructure — the AMM, the oracle resolver, the collateral accounting — without rebuilding it in Move. Sui becomes another spoke in the hub-and-spoke topology anchored on the EVM home.

### 1.2 Sui as a HOME chain (future path)

- **Home market:** lives on Sui, implemented natively in Move (see [01-move-market-contracts.md](./01-move-market-contracts.md)) with its object-centric AMM, Coin-based collateral, and oracle module.
- **EVM proxies:** lightweight Solidity `MarketProxy` contracts on Arc/Base/Ethereum/Polygon/BSC that forward intents to the Sui home market via Wormhole, receive confirmations, and mint wrapped position receipts representing Sui-native outcome shares.
- **Result:** Sui hosts the canonical market state and collateral pool; EVM users bridge in to trade against a Move-based AMM.

**Why later:** this path requires (a) the full Move market stack (AMM, factory, oracle) to be built and audited on Sui, (b) Wormhole adapters on both Sui and EVM sides tested for Sui→EVM message flow, and (c) operational confidence in Sui's finality and object model for cross-chain settlement. The Sui proxy path (1.1) validates the bridge architecture first with lower risk.

**This document focuses on the Sui-as-proxy direction (1.1) as the initial design.** The architecture is symmetric — the same patterns apply to Sui-as-home with minor role reversals.

---

## 2. Architecture — mirroring the EVM bridge with a non-EVM adapter

The Sui bridge keeps the **same architectural pattern as the EVM bridge** (which is inspired by Chainlink CCIP — see [`documentation_bridge/00-overview.md`](../documentation_bridge/00-overview.md) §3). The layers:

| Layer                                  | EVM bridge (CCIP)                                      | Sui bridge (Wormhole)                                      | Role                                                                                                                                                   |
|----------------------------------------|--------------------------------------------------------|------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Chain-local entrypoint**             | `MarketProxy.sol` (Solidity)                           | `market_proxy` module (Move on Sui)                        | The user-facing contract/module on the proxy chain. Accepts local collateral (USDC/Coin), locks it, emits bridge intents.                             |
| **Adapter interface / seam**           | `IBridgeAdapter` (Solidity interface)                  | `IBridgeAdapter`-equivalent trait in Move                  | Abstract send/receive interface decoupling the entrypoint from the concrete transport. One interface, many transports.                                 |
| **Concrete adapter (sender/receiver)** | `CcipBridgeAdapter.sol` (wraps Chainlink CCIP Router)  | `WormholeBridgeAdapter` module (wraps Wormhole `TokenBridge` and `Messenger`) | Transport-specific implementation: encodes messages on source, relays via the transport, decodes on destination.                                       |
| **Message transport**                  | Chainlink CCIP DON (decentralized oracle network)      | Wormhole Guardians (19-node Guardian network, 13-of-19 VAA consensus) | Off-chain infrastructure that observes source-chain events, reaches consensus, and delivers messages to the destination chain.                         |
| **Risk / circuit-breaker layer**       | Chainlink RMN (Risk Management Network)                | Wormhole's own Guardian quorum + Justify's per-route exposure caps | Independent monitoring layer that can halt message execution on anomaly detection. Justify's circuit breaker (see doc 04) wraps the Guardian security. |

### 2.1 ASCII diagram — Sui proxy to EVM home

```
┌─────────────────────────────────────────────────────────────────────┐
│                    HOME MARKET (EVM — e.g. Arc 5042002)              │
│                                                                       │
│  ┌────────────────┐   ┌─────────────┐   ┌──────────────┐           │
│  │ PredictionMar  │   │  MarketAMM  │   │  OracleRes   │           │
│  │ ket.sol        │◀──│  .sol       │◀──│  olver.sol   │           │
│  │ (Solidity)     │   │  (CPMM pool │   │  (settles on │           │
│  │                │   │   YES/NO)   │   │   EVM home)  │           │
│  └────────────────┘   └──────▲──────┘   └──────────────┘           │
│                              │                                       │
│                     Collateral pool (ERC-20 USDC)                    │
│                     Outcome tokens: ERC-1155 YES/NO                  │
│                                                                       │
│  ┌──────────────────────────────────────────────────────┐           │
│  │ HomeMarketGateway.sol (Solidity)                     │           │
│  │   receives Wormhole VAAs from Sui                    │           │
│  │   decodes BuyIntent → calls MarketAMM.buy()          │           │
│  │   encodes FillConfirmation → emits for Wormhole      │           │
│  └──────────────────────────────────────────────────────┘           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                   ┌───────────┴────────────┐
                   │   Wormhole transport   │
                   │  (Guardians, VAAs)     │
                   │                        │
                   │  Sui chain 21          │
                   │  EVM chain 2 (Ethereum)│
                   │  or 10004 (Base), etc. │
                   └───────────┬────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SUI PROXY CHAIN                              │
│                                                                       │
│  ┌──────────────────────────────────────────────────────┐           │
│  │ market_proxy module (Move)                           │           │
│  │   user calls: buy(market_id, outcome, sui_usdc_coin) │           │
│  │   locks Coin<USDC> in escrow                         │           │
│  │   emits: BuyIntent event                             │           │
│  └────────────┬─────────────────────────────────────────┘           │
│               │                                                      │
│               ▼                                                      │
│  ┌──────────────────────────────────────────────────────┐           │
│  │ wormhole_bridge_adapter module (Move)                │           │
│  │   encodes BuyIntent into Wormhole payload (BCS)      │           │
│  │   calls Wormhole publish_message                     │           │
│  │   pays Wormhole fee in SUI                           │           │
│  └──────────────────────────────────────────────────────┘           │
│               │                                                      │
│               └───→ Wormhole core bridge on Sui                     │
│                     emits Wormhole message                           │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
        ▲
        │
   User on Sui
   (trades with Sui USDC Coin, receives wrapped position receipt)
```

### 2.2 Resolution flow — EVM home to Sui proxy

```
HOME (EVM): OracleResolver.resolve(marketId, outcome) → emits MarketResolved

         │
         ▼
    Bridge dispatcher (watches MarketResolved on EVM)
         │
         └─→ HomeMarketGateway emits ResolutionBroadcast
                  │
                  ▼
            Wormhole Guardians
         (VAA signed 13-of-19)
                  │
                  ▼
         Sui: wormhole_bridge_adapter.receive_resolution(vaa)
                  │
                  └─→ market_proxy.mark_resolved(market_id, outcome)
                           │
                           └─→ users call market_proxy.redeem(receipt_id)
                                  burns wrapped receipt
                                  transfers Sui USDC Coin to user
```

---

## 3. Chainlink-CCIP-inspired layering — explicit and retained across the EVM/non-EVM boundary

**Acknowledge the inspiration, explicitly:** The Sui bridge architecture is **directly inspired by the Chainlink CCIP layering model** — the same separation of chain-local entrypoint, per-route adapter seam, message-carrying transport, and independent risk layer that the EVM bridge uses (see [`documentation_bridge/00-overview.md`](../documentation_bridge/00-overview.md) §3). This is **by design, not coincidence**: Justify adopts Chainlink's proven architectural pattern as the foundation for all cross-chain integrations, EVM and non-EVM alike.

### 3.1 The pattern (CCIP-inspired, transport-agnostic)

| Architectural layer            | CCIP term (EVM)                | Sui bridge equivalent           | Responsibility                                                                                                                                          |
|--------------------------------|--------------------------------|---------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Entrypoint**                 | Router                         | `market_proxy` module           | User-facing entry point on the proxy chain. Accepts collateral, locks it, emits intents.                                                                |
| **Adapter seam**               | IRouterClient / CCIPReceiver   | `IBridgeAdapter` trait (Move)   | Abstract interface decoupling entrypoint from transport. `send_intent()`, `receive_confirmation()`, `receive_resolution()` methods.                     |
| **Concrete adapter**           | OnRamp / OffRamp + CCIP Router | `wormhole_bridge_adapter` (Move + Solidity) | Transport-specific logic: encodes payloads (BCS on Sui, abi.encode on EVM), calls Wormhole, verifies VAAs, decodes on destination.                      |
| **Transport / consensus**      | CCIP DON (Decentralized Oracle Network) | Wormhole Guardians (19-node network, 13-of-19 quorum) | Off-chain message relay: observes source-chain events, reaches consensus (VAA signature), delivers to destination.                                      |
| **Risk management**            | RMN (Risk Management Network)  | Wormhole Guardian quorum + Justify circuit breaker | Independent verification layer that can halt execution on anomaly detection. Justify's per-route exposure caps wrap the underlying transport security. |

### 3.2 The difference: concrete transport, not the pattern

The **architectural pattern** is identical between the EVM bridge and the Sui bridge. The **difference** is the **concrete transport** — the technology that actually carries messages:

| Aspect                   | EVM bridge (CCIP)                                                                                     | Sui bridge (Wormhole)                                                                                     | Why the difference                                                                                                                                                                          |
|--------------------------|-------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Transport**            | Chainlink CCIP (Router, OnRamp, OffRamp, DON, RMN)                                                   | Wormhole (Guardians, VAAs, TokenBridge, Messenger modules)                                               | CCIP has no mature Sui lane as of 2026-06; Sui is non-EVM, Move-native. Wormhole has first-class Sui support (Move SDK, Sui-native modules).                                              |
| **Consensus model**      | CCIP DON (decentralized oracle committee) commits Merkle roots; RMN blesses/curses                   | Wormhole Guardians (19 nodes, 13-of-19 threshold multisig) sign VAAs (Verifiable Action Approvals)       | Both are decentralized quorum models; CCIP uses Merkle roots, Wormhole uses threshold signatures. Security profiles differ in details (see doc 04), but both are production-grade.         |
| **Message finality**     | CCIP waits for source-chain probabilistic finality (e.g., 15 blocks) before DON commits              | Wormhole Guardians observe Sui finality (~400ms) or EVM finality per chain; VAA issued after confirmation | Sui's single-leader consensus finalizes faster than EVM chains; Wormhole exploits this. Bridge time Sui→EVM can be <1 min vs CCIP's 10–15 min for EVM→EVM.                                 |
| **Pluggability**         | `IBridgeAdapter` interface allows swapping CCIP for other transports (LayerZero, Wormhole)           | `IBridgeAdapter` trait allows swapping Wormhole for a future Sui CCIP lane once available                | The **seam is the same** — Move's trait system plays the role of Solidity's interface. The adapter is a parameter, not a commitment.                                                        |

**Key point:** When Chainlink CCIP adds a mature Sui lane (Sui testnet/mainnet support, production DON, RMN coverage), Justify can swap `WormholeBridgeAdapter` for `CcipBridgeAdapter` **without changing the `market_proxy` entrypoint or the message payloads** — just deploy a new adapter that implements the same `IBridgeAdapter` trait. The architecture is **transport-agnostic by design**, even though the initial deployment uses Wormhole.

### 3.3 Why the CCIP-inspired pattern matters for Sui

1. **Separation of concerns:** The `market_proxy` module knows nothing about Wormhole — it only knows the adapter trait. Swapping transports (Wormhole → future Sui CCIP) is an adapter replacement, not a protocol rewrite.
2. **Defense in depth:** Justify's circuit breaker (per-route exposure caps, pause on anomaly) wraps the Wormhole Guardian security, the same way the EVM bridge's circuit breaker wraps CCIP's RMN. The adapter is trusted-but-verified.
3. **Unified architecture:** Engineers working on the EVM bridge and the Sui bridge see the **same conceptual model** — entrypoint, adapter seam, transport, risk layer. The only difference is Move vs Solidity syntax and Wormhole vs CCIP concretely. This lowers cognitive load and design surface.
4. **Proven at scale:** CCIP's architecture has secured billions in cross-chain value. By adopting its pattern (not reimplementing CCIP, but mirroring its layering), Justify inherits design rigor tested in production.

**Honest statement:** Justify's Sui bridge is **not a Chainlink CCIP integration** (because CCIP doesn't support Sui lanes yet), but it is **a Chainlink-CCIP-inspired architecture using Wormhole as the concrete transport**. The seam (`IBridgeAdapter`), the entrypoint pattern, and the risk-management layering are all lifted from the CCIP model. Wormhole is the best available transport for Sui today; the architecture is ready to adopt CCIP once Sui lanes are production-ready.

---

## 4. Why Wormhole for Sui (and how it differs from CCIP)

### 4.1 Wormhole's Sui support

**Wormhole** is a general-message bridge with first-class support for **Sui and Move**:

- **Sui-native modules:** Wormhole's Sui integration includes Move modules (`wormhole::core`, `wormhole::token_bridge`, `wormhole::messenger`) deployed on Sui mainnet and testnet. These are not EVM ports; they are idiomatic Move code using Sui's object model.
- **VAAs (Verifiable Action Approvals):** Wormhole's consensus primitive is a signed attestation (VAA) produced by the Guardian network. A VAA is a cryptographic proof that "this message was emitted on chain X and observed/signed by 13 of 19 Guardians." The destination chain verifies the VAA signatures on-chain before executing the message.
- **Guardian network:** 19 independent nodes run by institutions (Jump, Coinbase, Staked, etc.). 13-of-19 threshold for VAA issuance — Byzantine-fault-tolerant as long as fewer than 7 Guardians are compromised.
- **Sui chain ID:** Wormhole assigns Sui chain ID **21**. EVM chains have their own Wormhole IDs (Ethereum=2, BSC=4, Polygon=5, Base=10004, Arc=custom if supported). The adapter translates between Justify's EVM chain IDs and Wormhole IDs.

**Key difference from CCIP:**

| Aspect                  | Chainlink CCIP                                  | Wormhole                                     | Implication for Justify                                                                                      |
|-------------------------|-------------------------------------------------|----------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| **Consensus primitive** | Merkle root commitment + DON attestation        | Threshold-signed VAA (13-of-19 Guardians)    | Wormhole VAAs are self-contained (no on-chain Merkle tree verification); CCIP is Merkle-proof-based.       |
| **Finality model**      | CCIP waits for source-chain finality            | Wormhole waits for finality per chain config | Both safe; Wormhole's latency on Sui→EVM can be faster (Sui finalizes ~400ms).                              |
| **Message format**      | `Client.EVM2AnyMessage` (ABI-encoded)           | BCS (Binary Canonical Serialization) on Sui, ABI-encoded on EVM | Cross-boundary messages must transcode: BCS on Sui side, abi.encode on EVM side. Adapter handles this.      |
| **Token transfers**     | CCIP Token Pools (lock-mint or burn-mint)       | Wormhole TokenBridge (lock-mint or native pools) | Both support USDC bridging. Wormhole integrates with Circle CCTP on supported lanes for native USDC minting. |
| **Risk management**     | Independent RMN layer (bless/curse)             | Guardian quorum (no separate RMN equivalent) | Justify's circuit breaker (exposure caps, pause) wraps Guardian security — similar to how it wraps CCIP RMN. |

### 4.2 Why Wormhole is the right choice today

1. **Sui support exists:** Wormhole has production-deployed Move modules on Sui mainnet. CCIP does not (as of 2026-06).
2. **Move-native:** Wormhole's Sui SDK is idiomatic Move (objects, `Coin<T>`, `TxContext`), not a Solidity mindset forced onto Move. This makes the adapter cleaner.
3. **Battle-tested on Sui:** Wormhole has bridged billions through Sui (Portal Bridge for tokens, cross-chain apps like Mayan Finance). The Guardian network has Sui finality figured out.
4. **General-purpose messaging:** Wormhole supports arbitrary payloads (not just token transfers), which Justify needs for `BuyIntent`, `FillConfirmation`, `ResolutionBroadcast` messages.
5. **CCTP integration:** Wormhole integrates with Circle CCTP on EVM lanes, so USDC can move Sui→EVM as native USDC (not wrapped), the same as the EVM bridge's CCIP+CCTP strategy.

**The trade-off:** Wormhole's Guardian model is a 19-node multisig (albeit a large, geographically distributed one), whereas CCIP's DON + RMN is a two-layer decentralized consensus model. Justify's circuit breaker (per-route exposure caps, governance pause) mitigates this — if the Guardian set is compromised, the blast radius is capped by per-route limits (see [04-sui-bridge-security.md](./04-sui-bridge-security.md)).

### 4.3 Future: Sui CCIP lane

When Chainlink ships a production Sui CCIP lane (Sui Router, OnRamp/OffRamp contracts in Move, DON support for Sui finality, RMN coverage), Justify can:

1. Implement a `CcipBridgeAdapter` (Move module) that wraps the Sui CCIP Router, matching the `IBridgeAdapter` trait.
2. Deploy the CCIP adapter alongside the Wormhole adapter (same seam, different transport).
3. Let governance/users choose per market: "Bridge via CCIP" or "Bridge via Wormhole."
4. Deprecate Wormhole for new markets once CCIP coverage reaches feature parity.

**The adapter seam makes this swap architectural, not surgical.** The `market_proxy` module doesn't change; only the injected adapter changes.

---

## 5. Core flows — Sui proxy to EVM home (conceptual)

Detailed flow diagrams are in [03-wormhole-adapter-and-interop.md](./03-wormhole-adapter-and-interop.md). High-level:

### 5.1 Cross-chain buy (Sui user → EVM home market)

1. **User on Sui:** calls `market_proxy::buy(market_id, outcome_index, sui_usdc_coin, max_slippage)`.
2. **Proxy locks collateral:** transfers the `Coin<USDC>` into an escrow object on Sui, records a pending intent.
3. **Intent bridged to EVM home:** `wormhole_bridge_adapter` encodes the intent (`BuyIntent` struct) into BCS, calls `wormhole::publish_message()` on Sui, pays fee in SUI. Wormhole Guardians observe the message, sign a VAA.
4. **EVM home receives intent:** `HomeMarketGateway.sol` on the EVM chain (e.g., Arc) calls `wormhole::parseAndVerifyVM()` to validate the VAA, decodes the BCS payload into Solidity types, calls `MarketAMM.buy()` against the unified pool.
5. **Fill confirmation bridged back:** `HomeMarketGateway` emits `FillConfirmation`, which Wormhole Guardians observe and sign as a return VAA. The Sui `wormhole_bridge_adapter` receives the VAA, verifies it, decodes the confirmation.
6. **Proxy mints wrapped receipt:** `market_proxy` mints a Sui object (an outcome position receipt) to the user's address. The user's USDC is locked on Sui; the receipt entitles them to redeem for USDC (or nothing) after resolution, based on the EVM home market's outcome.

**Result:** Sui user contributes USDC to the EVM AMM pool without leaving Sui. The AMM depth is unified — Sui users and EVM users trade against the same reserves.

### 5.2 Cross-chain sell (future — detail TBD)

Symmetric to buy: user on Sui burns their wrapped receipt, `market_proxy` emits `SellIntent`, EVM home sells the underlying shares, collateral unlocked on Sui.

### 5.3 Cross-chain resolution (EVM home → Sui proxy)

1. **EVM home resolves:** `OracleResolver.resolve(marketId, outcome)` on the EVM chain (called by the CRE resolver or manual operator). Emits `MarketResolved`.
2. **Resolution broadcast:** Bridge dispatcher (off-chain service watching `MarketResolved`) calls `HomeMarketGateway.broadcastResolution(marketId, outcome)`. Wormhole Guardians sign a VAA.
3. **Sui proxy receives resolution:** `wormhole_bridge_adapter` on Sui verifies the VAA, decodes the `ResolutionBroadcast`, calls `market_proxy::mark_resolved(market_id, outcome)`.
4. **Users redeem on Sui:** `market_proxy::redeem(receipt_id)` burns the wrapped receipt, transfers the locked USDC to the user if their outcome won, else no payout.

**Property:** One resolution on the EVM home chain settles every proxy (Sui + all EVM proxies). No proxy can disagree with home state.

---

## 6. Differences vs the EVM bridge — forced by the non-EVM boundary

| Aspect                     | EVM bridge (CCIP, EVM↔EVM)                                      | Sui bridge (Wormhole, Sui↔EVM)                                      | Why the difference                                                                                                                                                                             |
|----------------------------|-----------------------------------------------------------------|---------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Bytecode/ABI**           | Both chains speak Solidity ABI; payloads are `abi.encode(...)` | Sui uses BCS (Binary Canonical Serialization); EVM uses ABI-encode | No shared type system across Move and Solidity. Messages must be serialized to a chain-neutral format (BCS on Sui side, decoded to Solidity types on EVM side, or vice versa).                |
| **Address format**         | 20-byte `address` on all EVM chains                             | Sui uses 32-byte object IDs and account addresses                   | Adapter must map or embed addresses. E.g., Sui user address is hashed/encoded into the Wormhole payload; EVM side decodes it as `bytes32`, not `address`.                                     |
| **Collateral type**        | ERC-20 USDC on all EVM chains                                   | Sui uses `Coin<USDC>` (Sui's native coin standard)                  | Wormhole TokenBridge or CCTP maps Sui USDC Coin ↔ EVM ERC-20 USDC. The value leg is separate from the message leg (same as the EVM bridge's CCIP+CCTP split).                                 |
| **Finality model**         | EVM finality (PoS epochs, OP Stack L1 finality, etc.)           | Sui: single-leader BFT, ~400ms finality                             | Wormhole waits for Sui finality before Guardians sign VAA; latency Sui→EVM can be faster than EVM→EVM CCIP. Sui users may see fills in <1 min vs 10–15 min for EVM users bridging via CCIP. |
| **Smart contract language** | Solidity on both sides                                          | Move on Sui, Solidity on EVM                                        | Adapter logic must be written twice: `wormhole_bridge_adapter.move` on Sui, `HomeMarketGateway.sol` on EVM. The **seam** (`IBridgeAdapter`) is the same conceptually, syntax differs.         |
| **Message transport**      | CCIP Router, OnRamp, OffRamp (EVM-native contracts)             | Wormhole core bridge (Move module on Sui, Solidity on EVM)          | Wormhole's cross-VM design handles the Sui/EVM boundary. CCIP's current architecture is EVM-only (no Move support yet).                                                                        |

### 6.1 Serialization: BCS ↔ ABI-encode

**BCS (Binary Canonical Serialization)** is Move's canonical serialization format (like Protobuf or RLP). Sui contracts emit BCS-encoded structs; the Wormhole payload carries raw bytes.

**On the EVM side:** `HomeMarketGateway.sol` receives the Wormhole VAA, extracts the payload (bytes), and **decodes BCS by hand** (or uses a Solidity BCS library if available) into Solidity types (`uint256 marketId`, `uint8 outcome`, etc.).

**On the Sui side:** `wormhole_bridge_adapter.move` receives the VAA, extracts the payload, decodes it from ABI-encoded bytes (if coming from EVM) into Move structs using a BCS deserializer.

**Implication:** The adapter on each side is responsible for serialization/deserialization. The message schema (field order, types, encoding) is a **frozen integration contract** documented in [03-wormhole-adapter-and-interop.md](./03-wormhole-adapter-and-interop.md).

### 6.2 Address translation

Sui addresses are 32 bytes; EVM addresses are 20 bytes. Wormhole payloads use **32-byte `bytes32`** as the universal address format:

- **Sui → EVM:** Sui user's address (32 bytes) is passed as-is in the Wormhole payload. EVM side stores it as `bytes32`, uses it as the key for wrapped receipts (or hashes it to 20 bytes if an EVM address is needed — design choice per [03-wormhole-adapter-and-interop.md](./03-wormhole-adapter-and-interop.md)).
- **EVM → Sui:** EVM user's address (20 bytes) is left-padded to 32 bytes in the Wormhole payload. Sui side truncates or stores as `vector<u8>`.

### 6.3 Value leg: Coin<USDC> vs ERC-20

Sui collateral is `Coin<USDC>`, not ERC-20. The value leg is handled by:

1. **Wormhole TokenBridge** (lock-mint model): user locks `Coin<USDC>` on Sui, Wormhole mints wrapped USDC on EVM, or vice versa.
2. **Circle CCTP** (burn-mint native USDC): where CCTP supports Sui (future — CCTP is adding Sui testnet support as of mid-2026), native Sui USDC can be burned on Sui, minted as native EVM USDC on the destination.

**Current recommendation:** Wormhole TokenBridge for MVP (supported today), migrate to CCTP once Sui CCTP lanes are production-ready. The adapter seam abstracts this; the `market_proxy` doesn't care which bridge moves the USDC.

### 6.4 Object-centric receipts

On Sui, the wrapped position receipt is a **Sui object** (not a fungible token ID). The `market_proxy` module mints an object (e.g., `PositionReceipt { market_id, outcome, shares, owner }`) and transfers it to the user's address. Redemption burns the object.

On EVM, wrapped receipts are ERC-1155 or ERC-20 tokens. The semantic is the same (proof of claim on home-chain shares), but the implementation differs due to Sui's object model.

---

## 7. Glossary delta — new terms for the Sui bridge

These terms supplement the EVM bridge glossary ([`documentation_bridge/00-overview.md`](../documentation_bridge/00-overview.md) §5).

| Term                            | Definition                                                                                                                                                                                                     |
|---------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **VAA**                         | Verifiable Action Approval — Wormhole's consensus primitive. A threshold-signed message (13-of-19 Guardians) attesting that an event occurred on a source chain. The destination chain verifies VAA signatures on-chain before executing. |
| **Guardian**                    | One of 19 independent nodes in the Wormhole network that observe cross-chain messages and sign VAAs. Threshold: 13-of-19 required for a VAA to be valid.                                                      |
| **Wormhole chain ID**           | Wormhole-specific chain identifier (distinct from EVM chain IDs). Sui = 21, Ethereum = 2, BSC = 4, Polygon = 5, Base = 10004. Adapter maintains a mapping registry.                                           |
| **Emitter**                     | The source contract/module that publishes a Wormhole message. On Sui: the `wormhole_bridge_adapter` module. On EVM: the `HomeMarketGateway` contract.                                                         |
| **BCS**                         | Binary Canonical Serialization — Move's standard serialization format (like Protobuf or RLP). Sui contracts emit BCS-encoded structs; the Wormhole payload carries BCS bytes decoded on the EVM side.         |
| **Coin<T>**                     | Sui's native fungible token standard. `Coin<USDC>` is Sui's representation of USDC. Wormhole TokenBridge or CCTP maps `Coin<USDC>` ↔ ERC-20 USDC on EVM chains.                                               |
| **Object (Sui)**                | Sui's first-class blockchain primitive. A wrapped position receipt on Sui is an object (not a token ID). Objects are owned by addresses, transferred via `transfer::transfer`, and can be destroyed (burned). |
| **HomeMarketGateway**           | Solidity contract on the EVM home chain that receives Wormhole VAAs from Sui, decodes intents, calls the AMM, and emits fill confirmations back to Sui. The Sui↔EVM translation layer.                       |

---

## 8. Forward links

The Sui bridge design is detailed across four documents (including this overview):

| # | Document                                         | What it covers                                                                                                                                      |
|---|--------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
| 02 | **02-sui-bridge-overview.md** (this document)     | The problem (Sui liquidity isolation), the home/proxy model on Sui, Chainlink-CCIP-inspired layering, Wormhole as the concrete transport.          |
| 03 | **03-wormhole-adapter-and-interop.md**            | The Wormhole adapter (Move + Solidity sides), VAA structure, Sui↔EVM message and value flow, BCS↔ABI-encode transcoding, wrapped receipts.         |
| 04 | **04-sui-bridge-security.md**                     | Security model: Wormhole Guardians vs Chainlink RMN, per-route exposure caps, circuit breaker, object-ownership safety, finality guarantees.        |

Additionally, the Move market contracts (the Sui-as-home path, future) are covered in:

| # | Document                                         | What it covers                                                                                                                                      |
|---|--------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
| 00 | **00-sui-polymarkets-overview.md**                | Why Sui; the object-centric prediction-market model; product parity with the EVM stack.                                                             |
| 01 | **01-move-market-contracts.md**                   | The Move package: factory, AMM, outcome coins, oracle — object-model design.                                                                        |

---

## 9. Status and integration with the Justify roadmap

**Current phase (as of 2026-06-13):** Phase 1 (Arc testnet deployment) is in progress for the **EVM stack**. The Sui bridge is a **separate project** — designed forward-looking, not yet deployed.

**Sui bridge phase:** This documentation set defines the target architecture for integrating Sui markets into the Justify network. The work sequences as:

1. **Phase 1 (EVM-only, separate):** Deploy the Move market stack on Sui independently (local Sui testnet, seeded markets, manual oracle). Validate the Move AMM math, object-model safety, `Coin<USDC>` accounting. No bridge yet.
2. **Phase 2 (Sui proxy to EVM home):** Build the Wormhole adapter (Sui + EVM sides), deploy `market_proxy` on Sui, stand up one test lane (Sui testnet → Base testnet or Arc testnet). End-to-end: Sui user buys a share on an EVM home market, receives wrapped receipt, redeems after resolution. This is the **Sui-as-proxy path** (§1.1).
3. **Phase 3 (Sui as home, EVM proxies):** Flip the direction: deploy a Move market on Sui mainnet as the home, deploy Solidity `MarketProxy` contracts on Base/Ethereum/Polygon, bridge EVM intents to the Sui AMM. This is the **Sui-as-home path** (§1.2), unlocking Sui as a first-class home chain in the Justify network.

**Design freeze:** These documents define the target so that when Phase 2 begins, the `IBridgeAdapter` trait, the Wormhole message schema, and the `market_proxy`↔EVM home integration can be built against a stable specification. The interfaces and payloads are the **integration contract** between the Sui bridge and the EVM home stack.

**Related documentation:**
- **Whitepaper §8** ([`documentation_justify_whitepaper/justify-whitepaper.md`](../documentation_justify_whitepaper/justify-whitepaper.md)) — the "chain is a parameter" claim extended to non-EVM chains.
- **EVM bridge set** ([`documentation_bridge/`](../documentation_bridge/)) — the home/proxy model, `IBridgeAdapter`, Chainlink CCIP adapter, resolution propagation — the patterns this Sui bridge mirrors.
- **CRE resolver plan** ([`docs/delivery/cre-resolver-plan.md`](../docs/delivery/cre-resolver-plan.md)) — the Chainlink-based automated resolver that, in the bridge phase, settles the EVM home market once and propagates to Sui (and all EVM proxies).

---

## 10. Properties and trade-offs recap

| Property                      | Consequence / design choice                                                                                                                                                                                      |
|-------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Unified liquidity**         | Sui users and EVM users trade against the **same AMM pool** (on the home chain). One price per outcome per event — no Sui-vs-EVM arbitrage, no liquidity fragmentation by VM.                                   |
| **Single source of truth**    | The home market (EVM or Sui, depending on direction) resolves once; proxies mirror that resolution. Sui proxies cannot disagree with an EVM home's outcome.                                                      |
| **Asynchronous fills**        | A bridged buy from Sui confirms in Wormhole time (~1–5 min Sui→EVM, depending on EVM finality). UI quotes a guaranteed-bounds fill (max slippage) at intent time; home AMM fills within it or refunds.          |
| **Bridge trust**              | A Sui proxy position is as safe as min(Sui security, EVM home security, Wormhole Guardian quorum). Per-route exposure caps limit blast radius if Guardians are compromised (see doc 04).                        |
| **Transport pluggability**    | The `IBridgeAdapter` trait (Move equivalent of the EVM bridge's Solidity interface) lets Justify swap Wormhole for a future Sui CCIP lane without changing `market_proxy` or the message schemas.               |
| **Cross-VM message format**   | BCS on Sui, ABI-encode on EVM. Adapters handle transcoding. The payload schema (field order, types) is frozen and versioned — a breaking change requires a new adapter deployment or migration.                 |
| **Sui finality advantage**    | Sui's ~400ms finality means Sui→EVM bridge time can be faster than EVM→EVM CCIP (which waits for EVM finality ~15 min). Sui users may see sub-minute fills vs 10–15 min for EVM users.                          |
| **Object-centric receipts**   | Wrapped position receipts on Sui are Sui objects (not ERC-1155 token IDs). This leverages Sui's ownership model for safety — the receipt can't be "approved" away like an ERC-20; transfer is explicit and safe. |
| **Progressive rollout**       | Sui-as-proxy first (reuses EVM home stack), Sui-as-home later (requires Move AMM audit, operational confidence). The architecture supports both in parallel.                                                    |

---

## 11. Next steps

Readers new to the Sui bridge should proceed in document order:

1. **03-wormhole-adapter-and-interop.md** — the Wormhole adapter (Move + Solidity), VAA structure, message and value flow, BCS↔ABI-encode transcoding.
2. **04-sui-bridge-security.md** — Wormhole Guardians vs Chainlink RMN, per-route exposure caps, circuit breaker, object-ownership safety.

Engineers building the Sui bridge should treat the `IBridgeAdapter` trait (Move equivalent of the Solidity `IBridgeAdapter` interface) and the Wormhole message schema (doc 03) as the frozen integration contract.

**Relation to the EVM bridge:** The Sui bridge is **architecturally parallel** to the EVM bridge. The **pattern** (entrypoint → adapter seam → transport → risk layer) is identical, inspired by Chainlink CCIP. The **difference** is the concrete transport (Wormhole for Sui vs CCIP for EVM) and the cross-VM translation (BCS↔ABI-encode, Coin↔ERC-20). When Chainlink ships a Sui CCIP lane, Justify can adopt it by swapping the Wormhole adapter for a CCIP adapter — no change to the `market_proxy` module or the message payloads.

---

**End of overview.** Proceed to `03-wormhole-adapter-and-interop.md` for the Wormhole adapter specification and Sui↔EVM message flow.
