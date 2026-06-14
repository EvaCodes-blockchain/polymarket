# IBridgeAdapter — The Cross-Chain Transport Seam

**Document:** 01-bridge-adapter-interface.md  
**Status:** Designed (Phase 3 — bridge-proxied markets)  
**Related:** [Whitepaper §5](../documentation_justify_whitepaper/justify-whitepaper.md) | [02-chainlink-ccip-adapter.md](./02-chainlink-ccip-adapter.md) | [03-marketproxy-and-home-market.md](./03-marketproxy-and-home-market.md)

---

## 1. Design principle — injected transport dependency

The `IBridgeAdapter` follows the **injected-dependency pattern** established throughout Justify's contract architecture. Just as `MarketFactory` accepts the collateral token as a constructor parameter (not a hard-coded address), and just as `MarketAMM` receives the fee treasury as a deployment argument, the bridge transport is **a parameter, not a commitment**.

```solidity
// MarketFactory — collateral injected at deploy
constructor(
    address _acl,
    address _outcomeToken,
    address _collateral,        // ← injected dependency
    address _feeTreasury
) { ... }

// MarketProxy — bridge adapter injected at deploy
constructor(
    uint256 _homeMarketId,
    uint64 _homeChainSelector,
    address _bridgeAdapter,     // ← injected dependency
    address _collateral
) { ... }
```

**Result:** Justify can deploy `MarketProxy` contracts with different adapters for different routes:

- CCIP adapter for Arc ↔ Base (Chainlink CCIP messaging + Circle CCTP for USDC)
- LayerZero adapter for Base ↔ Polygon (LayerZero V2 messaging)
- Wormhole adapter for Ethereum ↔ BSC (Wormhole-class messaging)

One interface. Many transports. The bridge is **configuration**, not architecture.

---

## 2. Interface sketch — Chainlink CCIP-inspired

Justify's `IBridgeAdapter` is **directly inspired by Chainlink CCIP's messaging model**: a Router/Client pattern where senders construct typed message payloads, call a router that returns a message ID, and receivers implement a callback invoked by the off-ramp upon message delivery.

Chainlink CCIP's architecture:

- **`Client.EVM2AnyMessage`** — a typed struct carrying the destination chain selector, receiver address, data payload, and token transfer instructions.
- **`IRouterClient.ccipSend`** — the send function; returns a `bytes32 messageId`.
- **`ccipReceive`** — the callback interface; destination contracts implement `IAny2EVMMessageReceiver` and process incoming messages in `ccipReceive`.
- **Chain selectors** — 64-bit identifiers for each supported chain, decoupling the protocol from raw chain IDs.

Justify adopts the same structure:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IBridgeAdapter
/// @notice Cross-chain messaging interface for Justify bridge-proxied markets.
///         Inspired by Chainlink CCIP's Router/Client model: typed payloads,
///         destination chain selectors, message-ID returns, and receiver callbacks.
///
///         One interface, many implementations: CCIP, LayerZero-class, CCTP for
///         USDC value legs. The adapter is an injected dependency (constructor
///         parameter to MarketProxy), never compiled into the protocol.
interface IBridgeAdapter {
    /// ═══════════════════════════════════════════════════════════════════════
    ///  Message payload types
    /// ═══════════════════════════════════════════════════════════════════════

    /// @notice A cross-chain BUY intent from a proxy chain to the home market.
    struct BuyIntent {
        uint256 marketId;       // Home market ID
        address trader;         // Trader address on proxy chain
        uint8 outcomeIndex;     // 0 = YES, 1 = NO
        uint256 collateralIn;   // Amount in collateral units (USDC 6-decimal)
        uint256 maxSlippage;    // Maximum acceptable slippage in basis points
        uint256 nonce;          // Per-trader nonce for ordering/idempotency
    }

    /// @notice A cross-chain SELL intent from a proxy chain to the home market.
    struct SellIntent {
        uint256 marketId;       // Home market ID
        address trader;         // Trader address on proxy chain
        uint8 outcomeIndex;     // 0 = YES, 1 = NO
        uint256 sharesIn;       // Shares to sell
        uint256 minPayout;      // Minimum acceptable payout (slippage guard)
        uint256 nonce;          // Per-trader nonce
    }

    /// @notice Confirmation of fill execution on the home market → proxy.
    struct FillConfirmation {
        bytes32 intentMessageId; // The original intent's message ID
        uint256 marketId;
        address trader;
        uint8 outcomeIndex;
        uint256 sharesOut;       // For buy: shares minted; for sell: collateral out
        uint256 executionPrice;  // Actual price in collateral per share (6-decimal)
    }

    /// @notice Resolution broadcast from home market to all proxies.
    struct ResolutionBroadcast {
        uint256 marketId;
        uint8 winningOutcome;    // 0 = YES, 1 = NO, 255 = INVALID
        uint256 resolvedAt;      // Timestamp
    }

    /// @notice Refund notice when a fill fails (slippage exceeded, market closed).
    struct RefundNotice {
        bytes32 intentMessageId; // The original intent's message ID
        uint256 marketId;
        address trader;
        uint256 refundAmount;    // Collateral to refund on proxy chain
        uint8 reason;            // 1 = slippage, 2 = market closed, 3 = other
    }

    /// ═══════════════════════════════════════════════════════════════════════
    ///  Send interface
    /// ═══════════════════════════════════════════════════════════════════════

    /// @notice Send a cross-chain message. Returns a unique message ID.
    /// @param destChainSelector  64-bit chain selector (Chainlink CCIP convention).
    /// @param receiver           Destination contract address.
    /// @param payload            ABI-encoded message (BuyIntent | SellIntent | etc.).
    /// @param gasLimit           Gas limit for execution on destination chain.
    /// @return messageId         Unique identifier for this message (tracking/idempotency).
    function sendMessage(
        uint64 destChainSelector,
        address receiver,
        bytes calldata payload,
        uint256 gasLimit
    ) external payable returns (bytes32 messageId);

    /// @notice Quote the fee (in native gas token or LINK) for a cross-chain send.
    /// @param destChainSelector  Target chain.
    /// @param receiver           Destination contract.
    /// @param payload            Message payload.
    /// @param gasLimit           Execution gas limit.
    /// @return feeAmount         Fee in wei (native) or LINK, depending on adapter.
    function quoteFee(
        uint64 destChainSelector,
        address receiver,
        bytes calldata payload,
        uint256 gasLimit
    ) external view returns (uint256 feeAmount);

    /// ═══════════════════════════════════════════════════════════════════════
    ///  Receive interface
    /// ═══════════════════════════════════════════════════════════════════════

    /// @notice Callback invoked by the bridge adapter when a message arrives.
    ///         Destination contracts (MarketProxy, home PredictionMarket) must
    ///         implement this and decode the payload into the appropriate struct.
    ///
    ///         Analogous to Chainlink CCIP's `ccipReceive`.
    /// @param sourceChainSelector  Origin chain selector.
    /// @param sender               Sender contract address on origin chain.
    /// @param payload              ABI-encoded message.
    function receiveMessage(
        uint64 sourceChainSelector,
        address sender,
        bytes calldata payload
    ) external;

    /// ═══════════════════════════════════════════════════════════════════════
    ///  Events
    /// ═══════════════════════════════════════════════════════════════════════

    event MessageSent(
        bytes32 indexed messageId,
        uint64 indexed destChainSelector,
        address indexed receiver,
        bytes payload,
        uint256 fee
    );

    event MessageReceived(
        bytes32 indexed messageId,
        uint64 indexed sourceChainSelector,
        address indexed sender,
        bytes payload
    );
}
```

---

## 3. Canonical message payloads

The five message types above establish the **cross-chain integration contract** between proxy chains and home markets. Each is ABI-encoded into the `payload` field of `sendMessage`.

### 3.1 BuyIntent

| Field           | Type      | Purpose                                                                  |
|-----------------|-----------|--------------------------------------------------------------------------|
| `marketId`      | `uint256` | Home market ID (unique within home chain's `MarketFactory`)              |
| `trader`        | `address` | Trader's address on the proxy chain (refunds/receipts go here)          |
| `outcomeIndex`  | `uint8`   | 0 = YES, 1 = NO                                                          |
| `collateralIn`  | `uint256` | Collateral locked on proxy (USDC 6-decimal units)                        |
| `maxSlippage`   | `uint256` | Slippage tolerance in basis points (e.g. 300 = 3%)                       |
| `nonce`         | `uint256` | Per-trader nonce for message ordering and idempotency                    |

**Flow:** MarketProxy locks the trader's collateral, sends a BuyIntent to the home market. The home `MarketAMM` fills it (or refunds if slippage exceeded).

### 3.2 SellIntent

| Field           | Type      | Purpose                                                                  |
|-----------------|-----------|--------------------------------------------------------------------------|
| `marketId`      | `uint256` | Home market ID                                                           |
| `trader`        | `address` | Trader on proxy chain                                                    |
| `outcomeIndex`  | `uint8`   | 0 = YES, 1 = NO                                                          |
| `sharesIn`      | `uint256` | Wrapped shares to burn on proxy                                          |
| `minPayout`     | `uint256` | Minimum collateral payout (slippage guard)                               |
| `nonce`         | `uint256` | Per-trader nonce                                                         |

**Flow:** MarketProxy burns the trader's wrapped receipt, sends SellIntent. Home AMM sells the underlying shares, sends collateral back via FillConfirmation.

### 3.3 FillConfirmation

| Field              | Type      | Purpose                                                               |
|--------------------|-----------|-----------------------------------------------------------------------|
| `intentMessageId`  | `bytes32` | Links confirmation to the original intent (idempotency key)           |
| `marketId`         | `uint256` | Home market ID                                                        |
| `trader`           | `address` | Trader on proxy chain                                                 |
| `outcomeIndex`     | `uint8`   | 0 = YES, 1 = NO                                                       |
| `sharesOut`        | `uint256` | For buy: outcome shares received; for sell: collateral payout         |
| `executionPrice`   | `uint256` | Actual fill price (collateral per share, 6-decimal)                   |

**Flow:** Home market → proxy. Proxy mints wrapped receipts (buy case) or unlocks refunded collateral (sell case).

### 3.4 ResolutionBroadcast

| Field            | Type      | Purpose                                                                 |
|------------------|-----------|-------------------------------------------------------------------------|
| `marketId`       | `uint256` | Home market ID                                                          |
| `winningOutcome` | `uint8`   | 0 = YES, 1 = NO, 255 = INVALID (market refunds all positions)          |
| `resolvedAt`     | `uint256` | Unix timestamp of resolution (for dispute windows in future phases)     |

**Flow:** Home `OracleResolver` settles the market once; resolution is bridged to all proxies. Users redeem wrapped receipts for collateral on their local chain.

### 3.5 RefundNotice

| Field              | Type      | Purpose                                                               |
|--------------------|-----------|-----------------------------------------------------------------------|
| `intentMessageId`  | `bytes32` | Links refund to the original intent                                   |
| `marketId`         | `uint256` | Home market ID                                                        |
| `trader`           | `address` | Trader on proxy chain                                                 |
| `refundAmount`     | `uint256` | Collateral to unlock and return to trader                             |
| `reason`           | `uint8`   | 1 = slippage exceeded, 2 = market closed, 3 = other failure           |

**Flow:** Home market → proxy. Proxy unlocks the escrowed collateral and returns it to the trader.

---

## 4. Message lifecycle and state machine

Every cross-chain intent moves through a three-state lifecycle:

```
   ┌──────────┐
   │ Intent   │  ← MarketProxy.buy() locks collateral, sends BuyIntent
   │ Pending  │
   └─────┬────┘
         │
         ├─────→ bridge delivery (seconds to minutes)
         │
         ▼
   ┌──────────┐
   │ InFlight │  ← Message accepted by bridge, awaiting home-market execution
   └─────┬────┘
         │
         ├─────→ home AMM fills or rejects
         │
         ▼
   ┌──────────┐        ┌──────────┐
   │ Filled   │   OR   │ Refunded │
   └──────────┘        └──────────┘
     Proxy mints         Proxy unlocks
     wrapped receipt     collateral
```

### 4.1 Idempotency

Each message carries a **unique `messageId`** returned by `sendMessage()`. The receiving contract (home market or proxy) MUST deduplicate messages:

```solidity
mapping(bytes32 => bool) public processedMessages;

function receiveMessage(
    uint64 sourceChainSelector,
    address sender,
    bytes calldata payload
) external override {
    bytes32 messageId = keccak256(abi.encodePacked(
        sourceChainSelector, sender, payload
    ));

    require(!processedMessages[messageId], "Already processed");
    processedMessages[messageId] = true;

    // Decode and execute...
}
```

**Why:** Bridge messaging is **at-least-once delivery**. The same message may arrive multiple times (reorg, re-transmission). On-chain idempotency makes at-least-once effectively-once.

### 4.2 Ordering and nonces

Each intent includes a **per-trader nonce**. The home market enforces monotonically increasing nonces per `(trader, proxyChain)` pair:

```solidity
mapping(address => mapping(uint64 => uint256)) public traderNonce;

function _validateIntent(BuyIntent memory intent, uint64 sourceChain) internal {
    require(
        intent.nonce == traderNonce[intent.trader][sourceChain] + 1,
        "Nonce out of order"
    );
    traderNonce[intent.trader][sourceChain] = intent.nonce;
}
```

**Why:** Prevents replay attacks and guarantees in-order execution when multiple intents from the same trader are in flight.

---

## 5. Guarantees and non-guarantees

| Property                 | Guarantee                                                                                                                                                                                                 |
|--------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Delivery**             | At-least-once. The bridge adapter retries until delivery confirms or the message expires (adapter-specific timeout). On-chain idempotency deduplicates retries → effectively-once execution.               |
| **Ordering**             | Per-trader ordering via nonces; no global ordering across traders. If trader Alice sends intent A then B, home market processes A before B. Intents from Alice and Bob may execute in any interleaving.    |
| **Finality**             | Asynchronous. A bridged buy confirms in **bridge time** (seconds to minutes), not block time. The UI quotes a *guaranteed-bounds fill envelope* at intent time; the home AMM fills within it or refunds. |
| **Atomicity**            | None. A bridged trade is two transactions (proxy lock → home fill → proxy mint). If the home fill reverts, the RefundNotice unlocks the proxy collateral — the trader's net position is unchanged.       |
| **Price guarantees**     | **Bounded fill or refund.** The proxy quotes a price range (current spot ± maxSlippage); the home AMM fills within that range or issues a RefundNotice. The trader never receives worse than quoted.     |
| **Censorship resistance**| Depends on the bridge adapter. CCIP and LayerZero use decentralized oracle networks; a malicious adapter can censor. Adapter allowlists + per-route exposure caps mitigate (see doc 06).                  |

**The user-facing promise:** "Your buy will execute at the quoted price (± max slippage) or your collateral is refunded. Confirmation takes bridge time, not block time."

---

## 6. The Chainlink CCIP tie — explicit and foundational

Justify's `IBridgeAdapter` is **directly inspired by Chainlink CCIP's messaging architecture**:

- **Chain selectors:** CCIP uses 64-bit `uint64` chain identifiers instead of raw chain IDs, decoupling the protocol from EVM chain-ID namespace collisions. Justify adopts the same `destChainSelector` type.
- **Router/Client model:** CCIP separates the sender's call (`IRouterClient.ccipSend`) from the receiver's callback (`IAny2EVMMessageReceiver.ccipReceive`). Justify mirrors this with `sendMessage` (router-style) and `receiveMessage` (callback).
- **Typed message structs:** CCIP's `Client.EVM2AnyMessage` is a struct with destination, receiver, data, and token instructions. Justify's `BuyIntent`, `SellIntent`, etc., are typed payloads following the same pattern.
- **Message ID returns:** Both CCIP and Justify return `bytes32 messageId` for tracking, idempotency, and linking confirmations to intents.

**The CCIP adapter (document 02) is the reference implementation of `IBridgeAdapter`.** When Justify bridges Arc ↔ Base, the adapter wraps `IRouterClient.ccipSend` and implements `IAny2EVMMessageReceiver.ccipReceive` to forward messages into Justify's `receiveMessage`. The interface is abstract enough to support other bridges (LayerZero, Wormhole), but CCIP's design is the blueprint.

---

## 7. Forward links

- **[02-chainlink-ccip-adapter.md](./02-chainlink-ccip-adapter.md)** — The concrete CCIP adapter implementing this interface; the explicit mapping from Justify's message types to CCIP's `EVM2AnyMessage` and CCTP for USDC legs.
- **[03-marketproxy-and-home-market.md](./03-marketproxy-and-home-market.md)** — How `MarketProxy` calls `IBridgeAdapter.sendMessage()` on buy/sell and implements `receiveMessage()` to process confirmations.
- **[06-security-and-risk-management.md](./06-security-and-risk-management.md)** — Adapter allowlists, per-route exposure caps, and the circuit breaker (analogous to CCIP's Risk Management Network).

---

**Summary:** `IBridgeAdapter` is the **transport seam** in Justify's bridge architecture. It is an injected dependency (parameter, not commitment), inspired by Chainlink CCIP's Router/Client model, carrying typed message payloads with guaranteed-bounds fills or refunds, and enforcing idempotency + ordering via message IDs and per-trader nonces. One interface, many transports — the bridge is configuration, not architecture.
