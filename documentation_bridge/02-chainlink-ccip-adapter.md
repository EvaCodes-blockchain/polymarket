# Chainlink CCIP Adapter — Justify's First Production Bridge Transport

**Document:** 02-chainlink-ccip-adapter.md  
**Status:** Design (Phase 3 — Bridge-proxied markets)  
**Relates to:** Whitepaper §5 (bridge-proxied markets), §5.3 (resolution phases)  
**Dependencies:** [01-bridge-adapter-interface.md](./01-bridge-adapter-interface.md)

---

## 1. Explicit acknowledgment

**Justify's entire bridge layer architecture is inspired by Chainlink CCIP's design.**

The first production bridge transport for Justify is **Chainlink CCIP** (Cross-Chain Interoperability Protocol), and the architectural decomposition of Justify's own bridge contracts — the separation of a chain-local entry point from per-route adapters, the abstraction of message transport, the independent risk management layer, the commitment-then-execution pattern — is **directly modeled on Chainlink's CCIP architecture**.

We credit this inspiration explicitly:

- Justify's `IBridgeAdapter` interface is modeled on CCIP's router/transport separation.
- Justify's per-route exposure caps and circuit-breaker pattern mirror CCIP's **Risk Management Network (RMN)**.
- Justify's message commitment model (intent submitted, bridge confirms, outcome minted/refunded) is structurally analogous to CCIP's commit/execute DON phases.
- Justify's first concrete adapter, `CcipBridgeAdapter`, directly calls Chainlink's own `IRouterClient` contracts.

This document describes the CCIP architecture primer, the mapping from Justify concepts to CCIP concepts, and the Solidity design of the `CcipBridgeAdapter` that implements `IBridgeAdapter` on top of CCIP.

---

## 2. Chainlink CCIP architecture primer

Chainlink CCIP is a **general-purpose cross-chain messaging protocol** designed to enable arbitrary message and token transfers between EVM and non-EVM blockchains with cryptographic security guarantees, decentralized verification, and an independent risk management layer.

### 2.1 Core components

#### 2.1.1 Router contract (per chain)

The **Router** (`IRouterClient`) is the single entry point on each supported chain for sending CCIP messages.

- Every CCIP sender calls `router.ccipSend(destinationChainSelector, message)` to initiate a cross-chain message.
- The router validates the message, calculates fees (in LINK or native gas token), collects payment, and forwards the message to the appropriate **OnRamp** contract for the destination lane.

#### 2.1.2 OnRamp and OffRamp contracts (per lane)

A **lane** is a directed path from one source chain to one destination chain (e.g., Ethereum → Base, or Base → Polygon). Each lane has:

- **OnRamp (source chain):** receives validated messages from the Router, serializes them into a canonical format, emits a `CCIPSendRequested` event for off-chain observation, and increments a sequence number. The OnRamp is the source-chain truth for "this message was requested."
- **OffRamp (destination chain):** receives executed messages from the Executing DON, verifies inclusion in the committed Merkle root, executes the message (calls `ccipReceive` on the target contract), and emits a `CCIPMessageExecuted` event. The OffRamp is the destination-chain truth for "this message was delivered."

#### 2.1.3 Commit and Executing DONs (Decentralized Oracle Networks)

CCIP's off-chain infrastructure consists of two independent oracle networks:

- **Committing DON:** observes OnRamp events on the source chain, constructs a Merkle root of all pending messages for a given lane batch, and submits that root to the destination OffRamp via a `commit()` transaction. This establishes cryptographic finality: the destination chain knows a message exists without yet executing it.
- **Executing DON:** observes committed roots, constructs Merkle proofs for individual messages, calls the OffRamp's `execute()` with the proof, which verifies inclusion and delivers the message to the recipient contract's `ccipReceive()` function.

The two-phase design (commit, then execute) ensures:
1. **Cryptographic finality** before execution — no reliance on single-oracle honesty.
2. **Gas efficiency** — one commit covers a batch of messages; execution happens per message only when needed.

#### 2.1.4 Risk Management Network (RMN)

The **RMN** is an **independent** set of nodes (distinct from the DONs) that continuously monitors CCIP lanes for anomalies:

- **Blessing:** the RMN observes committed Merkle roots and, if valid, "blesses" them — a precondition for execution.
- **Cursing:** if the RMN detects an invalid root or anomalous behavior (e.g., a compromised DON), it "curses" the lane, immediately halting all executions on that route until governance intervention.

The RMN is CCIP's defense-in-depth layer: even if both DONs are compromised, the RMN can prevent invalid state from finalizing on the destination chain.

#### 2.1.5 Chain selectors

CCIP uses **chain selectors** — uint64 identifiers distinct from EVM chain IDs — to name blockchains in a multi-ecosystem namespace. Examples:

| Chain          | EVM Chain ID | CCIP Chain Selector |
|----------------|--------------|---------------------|
| Ethereum       | 1            | 5009297550715157269 |
| Base           | 8453         | 15971525489660198786 |
| Polygon PoS    | 137          | 4051577828743386545 |
| BSC            | 56           | 11344663589394136015 |

When Justify's adapter sends a message, it translates the destination chain's EVM chain ID to its CCIP chain selector via a registry mapping.

#### 2.1.6 Token transfer model

CCIP supports **native token transfers** alongside arbitrary messages via the **Token Pool** model:

- Each token (e.g., USDC, LINK) has a **token pool contract** per chain that locks/mints or burns/unlocks tokens on send/receive.
- Senders specify token amounts in the `Client.EVM2AnyMessage.tokenAmounts` array; CCIP coordinates the token leg in parallel with the data leg.
- For USDC specifically, Chainlink integrates with **Circle CCTP** (Cross-Chain Transfer Protocol) on supported lanes, enabling native USDC burns/mints rather than locked/wrapped representations.

Justify uses CCIP for **message-only transfers** (buy/sell intents), and **separately** uses Circle CCTP for the value leg (USDC collateral transfers) when the lane supports it (see [04-per-chain-bridge-playbook.md](./04-per-chain-bridge-playbook.md)).

### 2.2 CCIP message flow (ASCII diagram)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          SOURCE CHAIN (e.g. Base)                            │
│                                                                              │
│  User Contract (Justify MarketProxy)                                         │
│       │                                                                      │
│       │ 1. ccipSend(destChainSelector, message)                             │
│       ▼                                                                      │
│  ┌─────────────────┐                                                        │
│  │  IRouterClient  │  (entry point)                                         │
│  └────────┬────────┘                                                        │
│           │ 2. forwards to OnRamp for destination lane                      │
│           ▼                                                                 │
│  ┌──────────────────────┐                                                   │
│  │  OnRamp (Base→Arc)   │  emits CCIPSendRequested(messageId, ...)         │
│  └──────────────────────┘                                                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                            │
                            │  (off-chain observation)
                            ▼
           ┌──────────────────────────────────────┐
           │     Committing DON (off-chain)       │
           │  observes OnRamp events, builds      │
           │  Merkle root, submits commit() txn   │
           └────────────┬─────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        DESTINATION CHAIN (e.g. Arc)                          │
│                                                                              │
│  ┌───────────────────────────┐                                              │
│  │  OffRamp (Base→Arc)       │                                              │
│  │  3. commit(merkleRoot)    │  ◄── Committing DON                          │
│  └───────────┬───────────────┘                                              │
│              │                                                               │
│              │  4. RMN blesses root                                          │
│              ▼                                                               │
│  ┌─────────────────────────────────────────┐                                │
│  │  Risk Management Network (independent)  │                                │
│  │  monitors, blesses/curses               │                                │
│  └─────────────────────────────────────────┘                                │
│              │                                                               │
│              │  5. Executing DON calls execute() with Merkle proof           │
│              ▼                                                               │
│  ┌───────────────────────────┐                                              │
│  │  OffRamp (Base→Arc)       │                                              │
│  │  execute(message, proof)  │  verifies proof, delivers message            │
│  └───────────┬───────────────┘                                              │
│              │                                                               │
│              │ 6. ccipReceive(Any2EVMMessage)                               │
│              ▼                                                               │
│  ┌──────────────────────────┐                                               │
│  │  CCIPReceiver            │                                               │
│  │  (Justify home market)   │  executes buy/sell on AMM                     │
│  └──────────────────────────┘                                               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key properties:**
- **Asynchronous:** steps 3–6 occur seconds to minutes after step 1, depending on source/destination finality and DON cadence.
- **Cryptographic finality:** the Merkle root commitment (step 3) is immutable; execution (step 6) is proof-based.
- **Defense in depth:** both DONs and the RMN must agree; any single layer can halt invalid state.

### 2.3 Programming model: Client.EVM2AnyMessage and ccipReceive

#### Sending a message

```solidity
import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";

IRouterClient router = IRouterClient(ROUTER_ADDRESS);

Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
    receiver: abi.encode(destinationContractAddress),  // ABI-encoded destination
    data: abi.encode(customPayload),                   // arbitrary bytes
    tokenAmounts: new Client.EVMTokenAmount[](0),      // empty for data-only
    extraArgs: Client._argsToBytes(
        Client.EVMExtraArgsV1({gasLimit: 200_000})    // execution gas on destination
    ),
    feeToken: address(linkToken)                       // pay fee in LINK
});

uint256 fee = router.getFee(destinationChainSelector, message);
linkToken.approve(address(router), fee);

bytes32 messageId = router.ccipSend(destinationChainSelector, message);
// messageId is unique, can be indexed for tracking
```

#### Receiving a message

```solidity
import {CCIPReceiver} from "@chainlink/contracts-ccip/src/v0.8/ccip/applications/CCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";

contract MyReceiver is CCIPReceiver {
    constructor(address router) CCIPReceiver(router) {}

    function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
        address sender = abi.decode(message.sender, (address));
        bytes memory payload = message.data;
        uint64 sourceChainSelector = message.sourceChainSelector;

        // validate sender, parse payload, execute business logic
    }
}
```

The `_ccipReceive` function is called by the OffRamp when a message is executed. The receiver **must** inherit `CCIPReceiver` and override `_ccipReceive`.

---

## 3. `CcipBridgeAdapter` design

Justify's `CcipBridgeAdapter` is a concrete implementation of the `IBridgeAdapter` interface (defined in [01-bridge-adapter-interface.md](./01-bridge-adapter-interface.md)) that uses Chainlink CCIP as the transport layer.

### 3.1 Responsibilities

The adapter must:

1. **Send cross-chain intents:** when a user submits a buy/sell order on a `MarketProxy`, the adapter calls `IRouterClient.ccipSend()` to send the intent (question ID, outcome, amount, user address) to the home market on the destination chain.
2. **Receive and route incoming messages:** when the home market confirms a fill or resolution, the adapter receives the CCIP message via `ccipReceive()` and routes it to the appropriate `MarketProxy` contract for local state update (mint wrapped position receipt, or settle redemption).
3. **Map Justify routes to CCIP lanes:** maintain a registry of (Justify destination chain ID) → (CCIP chain selector) and (route) → (allowed sender/receiver addresses).
4. **Pay CCIP fees:** calculate and collect CCIP transport fees from the user or protocol treasury, payable in LINK or native gas token.
5. **Emit adapter events:** for off-chain indexing, emit `IntentSent`, `MessageReceived`, `IntentFailed` events that mirror the CCIP message lifecycle into Justify's event schema.

### 3.2 Contract structure

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IBridgeAdapter} from "./IBridgeAdapter.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/src/v0.8/ccip/applications/CCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CcipBridgeAdapter
/// @notice Chainlink CCIP adapter for Justify cross-chain market intents
/// @dev Implements IBridgeAdapter; sends via IRouterClient, receives via CCIPReceiver
contract CcipBridgeAdapter is IBridgeAdapter, CCIPReceiver, Ownable {
    // ───────────────────────────────────────────────────────────────────────
    // State
    // ───────────────────────────────────────────────────────────────────────

    /// @notice LINK token for fee payment (optional; can also pay in native)
    IERC20 public immutable linkToken;

    /// @notice Whether to pay fees in LINK (true) or native gas token (false)
    bool public payFeesInLink;

    /// @notice Mapping: Justify destination chain ID → CCIP chain selector
    mapping(uint256 => uint64) public chainIdToSelector;

    /// @notice Mapping: CCIP chain selector → Justify chain ID (reverse lookup)
    mapping(uint64 => uint256) public selectorToChainId;

    /// @notice Allowlisted remote adapter addresses per CCIP chain selector
    /// Only messages from these addresses are accepted
    mapping(uint64 => address) public allowedSenders;

    /// @notice Target contract address on each destination chain (typically the home market or MarketProxy registry)
    mapping(uint64 => address) public destinationTargets;

    /// @notice Gas limit for ccipReceive execution on destination chain
    uint256 public destinationGasLimit = 200_000;

    // ───────────────────────────────────────────────────────────────────────
    // Events
    // ───────────────────────────────────────────────────────────────────────

    event IntentSent(
        bytes32 indexed ccipMessageId,
        uint256 indexed destinationChainId,
        address indexed user,
        bytes intentPayload,
        uint256 fee
    );

    event MessageReceived(
        bytes32 indexed ccipMessageId,
        uint64 indexed sourceChainSelector,
        address indexed sender,
        bytes payload
    );

    event RouteConfigured(
        uint256 indexed justifyChainId,
        uint64 indexed ccipSelector,
        address allowedSender,
        address destinationTarget
    );

    // ───────────────────────────────────────────────────────────────────────
    // Constructor
    // ───────────────────────────────────────────────────────────────────────

    constructor(
        address _router,
        address _linkToken,
        bool _payFeesInLink
    ) CCIPReceiver(_router) Ownable(msg.sender) {
        linkToken = IERC20(_linkToken);
        payFeesInLink = _payFeesInLink;
    }

    // ───────────────────────────────────────────────────────────────────────
    // IBridgeAdapter implementation
    // ───────────────────────────────────────────────────────────────────────

    /// @notice Send a cross-chain intent (buy/sell) via CCIP
    /// @param destinationChainId Justify chain ID (translated to CCIP selector internally)
    /// @param payload ABI-encoded intent data (market ID, outcome, amount, user, etc.)
    /// @return messageId Unique CCIP message identifier for tracking
    function sendIntent(
        uint256 destinationChainId,
        bytes calldata payload
    ) external payable override returns (bytes32 messageId) {
        uint64 destSelector = chainIdToSelector[destinationChainId];
        require(destSelector != 0, "CcipAdapter: destination not configured");

        address target = destinationTargets[destSelector];
        require(target != address(0), "CcipAdapter: no target for destination");

        // Build CCIP message
        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(target),
            data: payload,
            tokenAmounts: new Client.EVMTokenAmount[](0), // data-only, no token transfer
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV1({gasLimit: destinationGasLimit})
            ),
            feeToken: payFeesInLink ? address(linkToken) : address(0)
        });

        // Calculate fee
        IRouterClient router = IRouterClient(i_ccipRouter);
        uint256 fee = router.getFee(destSelector, message);

        // Pay fee
        if (payFeesInLink) {
            require(linkToken.balanceOf(msg.sender) >= fee, "CcipAdapter: insufficient LINK");
            linkToken.transferFrom(msg.sender, address(this), fee);
            linkToken.approve(address(router), fee);
        } else {
            require(msg.value >= fee, "CcipAdapter: insufficient native fee");
        }

        // Send via CCIP
        messageId = router.ccipSend{value: payFeesInLink ? 0 : fee}(destSelector, message);

        emit IntentSent(messageId, destinationChainId, msg.sender, payload, fee);
    }

    /// @notice Query the fee for sending an intent to a destination chain
    function getFee(
        uint256 destinationChainId,
        bytes calldata payload
    ) external view override returns (uint256) {
        uint64 destSelector = chainIdToSelector[destinationChainId];
        require(destSelector != 0, "CcipAdapter: destination not configured");

        address target = destinationTargets[destSelector];
        require(target != address(0), "CcipAdapter: no target for destination");

        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(target),
            data: payload,
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV1({gasLimit: destinationGasLimit})
            ),
            feeToken: payFeesInLink ? address(linkToken) : address(0)
        });

        IRouterClient router = IRouterClient(i_ccipRouter);
        return router.getFee(destSelector, message);
    }

    // ───────────────────────────────────────────────────────────────────────
    // CCIPReceiver implementation
    // ───────────────────────────────────────────────────────────────────────

    /// @notice Receive and route a CCIP message from another chain
    /// @dev Called by the CCIP OffRamp; validates sender, decodes payload, forwards to local handler
    function _ccipReceive(
        Client.Any2EVMMessage memory message
    ) internal override {
        uint64 sourceSelector = message.sourceChainSelector;
        address sender = abi.decode(message.sender, (address));

        // Validate sender is allowlisted for this source chain
        require(
            allowedSenders[sourceSelector] == sender,
            "CcipAdapter: sender not allowed"
        );

        bytes memory payload = message.data;
        bytes32 messageId = message.messageId;

        emit MessageReceived(messageId, sourceSelector, sender, payload);

        // Decode and route payload to appropriate handler (e.g., MarketProxy or home market)
        // Implementation depends on the message type encoded in payload
        // Example: (uint8 msgType, bytes data) = abi.decode(payload, (uint8, bytes));
        // if (msgType == MSG_TYPE_FILL_CONFIRMATION) { ... }
        // This routing logic is specific to Justify's intent schema and is defined in the
        // broader bridge integration (see 03-marketproxy-and-home-market.md)
        
        _routeReceivedMessage(sourceSelector, payload);
    }

    /// @notice Internal routing of received messages (stub; implementation per message type)
    function _routeReceivedMessage(uint64 sourceSelector, bytes memory payload) internal {
        // Decode message type and forward to appropriate contract
        // E.g., call MarketProxy.confirmFill(...) or MarketProxy.settleResolution(...)
        // Concrete implementation depends on Justify message schema
    }

    // ───────────────────────────────────────────────────────────────────────
    // Admin functions
    // ───────────────────────────────────────────────────────────────────────

    /// @notice Configure a new route: map Justify chain ID ↔ CCIP selector, allowlist sender
    function configureRoute(
        uint256 justifyChainId,
        uint64 ccipSelector,
        address allowedSender,
        address destinationTarget
    ) external onlyOwner {
        chainIdToSelector[justifyChainId] = ccipSelector;
        selectorToChainId[ccipSelector] = justifyChainId;
        allowedSenders[ccipSelector] = allowedSender;
        destinationTargets[ccipSelector] = destinationTarget;

        emit RouteConfigured(justifyChainId, ccipSelector, allowedSender, destinationTarget);
    }

    /// @notice Update destination gas limit for ccipReceive execution
    function setDestinationGasLimit(uint256 _gasLimit) external onlyOwner {
        destinationGasLimit = _gasLimit;
    }

    /// @notice Switch between LINK and native fee payment
    function setPayFeesInLink(bool _payInLink) external onlyOwner {
        payFeesInLink = _payInLink;
    }

    /// @notice Withdraw stuck LINK or native tokens (safety escape hatch)
    function withdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            payable(owner()).transfer(amount);
        } else {
            IERC20(token).transfer(owner(), amount);
        }
    }
}
```

### 3.3 Key design choices

1. **Chain ID translation:** Justify uses standard EVM chain IDs (1, 8453, 137, etc.); CCIP uses uint64 chain selectors. The adapter maintains a bidirectional mapping configured per route by the protocol owner.

2. **Sender allowlisting:** only messages from pre-configured remote adapter addresses (e.g., the `CcipBridgeAdapter` instance on the source chain) are accepted. This prevents spoofing.

3. **Fee flexibility:** CCIP fees can be paid in LINK (preferred for rate stability) or native gas token (simpler UX). The adapter supports both; the protocol chooses per deployment.

4. **Gas limit:** the destination execution gas is set per adapter deployment (default 200k gas for a typical fill confirmation or resolution settlement). Adjustable by owner if market logic complexity grows.

5. **Message routing stub:** the `_routeReceivedMessage` function is a stub in this base adapter. Concrete routing (e.g., "if this is a fill confirmation, call `MarketProxy.confirmFill()`") is implemented in an integration layer or extended adapter that knows about Justify's market registry. This keeps the adapter focused on CCIP transport.

---

## 4. Justify ↔ Chainlink CCIP concept mapping

| Justify concept                        | Chainlink CCIP equivalent                                    | Notes                                                                                                                                                      |
|----------------------------------------|--------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Bridge entrypoint**                  | **IRouterClient** (Router contract)                          | Justify's `MarketProxy` calls `CcipBridgeAdapter.sendIntent()`, which calls CCIP's `router.ccipSend()`.                                                   |
| **Route** (source chain → dest chain) | **Lane** (source chain → dest chain)                         | Each Justify route (e.g., Base → Arc) maps to one CCIP lane with its own OnRamp/OffRamp.                                                                  |
| **Adapter send**                       | **OnRamp + ccipSend**                                        | `CcipBridgeAdapter.sendIntent()` → `router.ccipSend()` → OnRamp emits `CCIPSendRequested`.                                                                |
| **Adapter receive**                    | **OffRamp + ccipReceive**                                    | CCIP OffRamp calls `CcipBridgeAdapter._ccipReceive()` to deliver the message.                                                                             |
| **Message ID**                         | **CCIP messageId** (bytes32)                                 | Unique identifier returned by `ccipSend()`, indexed for tracking and event correlation.                                                                    |
| **Destination chain ID**               | **CCIP chain selector** (uint64)                             | Justify translates EVM chain IDs to CCIP selectors via `chainIdToSelector` registry.                                                                       |
| **Exposure cap / circuit breaker**     | **Risk Management Network (RMN)** — blessing/cursing         | Justify's circuit breaker (see [06-security-and-risk-management.md](./06-security-and-risk-management.md)) mirrors RMN's role: halt on anomaly detection. |
| **Intent payload**                     | **Client.EVM2AnyMessage.data** (arbitrary bytes)             | Justify encodes `(marketId, outcome, amount, user)` into `message.data`; CCIP treats it as opaque.                                                        |
| **Fee model**                          | **CCIP fee in LINK or native**                               | Calculated by `router.getFee()`, paid upfront per message; Justify surfaces this in the UI payout quote.                                                  |
| **Sender authentication**              | **Allowlisted sender addresses** per CCIP receiver           | Justify's `allowedSenders` mapping enforces that only authorized remote adapters can deliver messages.                                                     |
| **Resolution broadcast**               | **Same CCIP send/receive** (home → all proxies)              | When the home market resolves, the resolver sends resolution messages via CCIP to all proxy chains (see [05-cross-chain-resolution.md](./05-cross-chain-resolution.md)). |
| **Two-phase execution** (lock → mint) | **Commit DON → Executing DON** (commit root → execute proof) | Justify's intent lifecycle (submitted → confirmed → minted) mirrors CCIP's commit/execute pattern, though at a higher semantic level.                      |

---

## 5. Token transfers vs message-only: when to use CCIP vs CCTP

Chainlink CCIP supports **both** arbitrary messages and native token transfers (via Token Pools). However, for Justify's use case, we employ a **hybrid strategy**:

### 5.1 Message leg: CCIP

**What:** Buy/sell intents, fill confirmations, resolution settlements — all messages that carry **instructions, not value**.

**How:** CCIP arbitrary messaging (the `data` field of `Client.EVM2AnyMessage`), as implemented in `CcipBridgeAdapter`.

**Why:**
- CCIP's decentralized DON model provides cryptographic finality and RMN-backed security for the instruction layer.
- The message is small (< 1 KB), so CCIP's fee is proportional and predictable.
- CCIP natively supports non-EVM destinations (future-proofing) and handles retries/failures gracefully.

### 5.2 Value leg: Circle CCTP (where available)

**What:** The actual USDC collateral transfer from the user's source chain to the home market's pool (or back on redemption).

**How:** **Circle CCTP** (Cross-Chain Transfer Protocol) — a specialized USDC bridge where USDC is burned on the source chain and natively minted on the destination chain via Circle's attestation service.

**Why:**
- **Native USDC:** CCTP mints canonical USDC on the destination, not a wrapped or pool-backed synthetic. This is critical for Justify's collateral accounting, which assumes chain-native USDC.
- **Lower cost:** CCTP fees are lower than general-purpose CCIP token transfers for USDC specifically.
- **Circle's security model:** CCTP is Circle's own infrastructure, aligned with USDC's trust model. For a stablecoin-denominated protocol, this is the natural choice.
- **Lane coverage:** CCTP supports Ethereum ↔ Base, Ethereum ↔ Polygon, Base ↔ Polygon, and many other high-volume routes — the exact lanes Justify targets.

**Where CCTP is not available:** for lanes where CCTP does not yet support both endpoints (e.g., BSC ↔ Arc, hypothetically), Justify can fall back to CCIP token transfers via a USDC token pool, or employ a lock-on-source / mint-wrapped model. The adapter design is **transport-agnostic at the IBridgeAdapter seam**; the per-chain playbook (see [04-per-chain-bridge-playbook.md](./04-per-chain-bridge-playbook.md)) documents which transport is used per lane.

### 5.3 Separation of concerns

```
User submits buy intent on MarketProxy (source chain)
     │
     ├─► USDC collateral: burned via CCTP, minted on home chain into AMM pool
     │
     └─► Intent message: sent via CCIP to home market, triggers AMM.buy()
             │
             └─► Fill confirmation: CCIP message back to source MarketProxy
                      │
                      └─► Wrapped receipt minted to user's address
```

The two legs are **decoupled**: CCIP handles "what to do" (the trade instruction), CCTP handles "where the money goes" (the value settlement). This mirrors how traditional finance separates instruction settlement (FIX protocol) from cash settlement (wire transfer).

---

## 6. Honest limits and operational considerations

### 6.1 CCIP lane availability

CCIP does not support every chain pair yet. As of this document's writing (2026-06), CCIP lanes exist for:

- **Ethereum ↔ Base** ✓
- **Ethereum ↔ Polygon** ✓
- **Base ↔ Polygon** ✓
- **Ethereum ↔ BSC** ✓
- **Arc ↔ {Ethereum, Base, Polygon, BSC}** — depends on Arc mainnet CCIP integration roadmap (testnet may require Chainlink pilot deployment)

**Implication for Justify:** Phase 3 rollout must sequence per lane availability. If Arc ↔ Base is the first target (per the whitepaper), Chainlink's Arc testnet CCIP deployment is a **critical path dependency**. Fallback: use a generalized message bridge (e.g., LayerZero, Wormhole) for lanes where CCIP is not yet live, with a migration plan once CCIP coverage expands (see [01-bridge-adapter-interface.md](./01-bridge-adapter-interface.md) for multi-adapter support).

### 6.2 Finality-dependent latency

CCIP's commit phase waits for **source-chain finality** before committing the Merkle root to the destination. Finality times:

| Chain          | Finality mechanism         | Typical time    |
|----------------|----------------------------|-----------------|
| Ethereum       | LMD-GHOST (2 epochs)       | ~15 minutes     |
| Base           | OP Stack (L1 finality)     | ~15 minutes     |
| Polygon PoS    | Heimdall checkpoints       | ~30 minutes     |
| BSC            | Parlia (21 validators)     | ~1 minute       |
| Arc            | (depends on Arc consensus) | TBD (~1 minute) |

**Implication:** A buy intent sent from Ethereum to Base will take ~15 minutes to reach the Commit DON, then another ~1–2 minutes for execution. The Justify UI must surface this as **"Your order is being bridged — expected fill in ~15–20 minutes"** rather than pretending it is instant. The `MarketProxy` design includes a **guaranteed-bounds quote** (max slippage) at intent submission time, so the user knows their worst-case fill price upfront (see [03-marketproxy-and-home-market.md](./03-marketproxy-and-home-market.md)).

### 6.3 Fee in LINK or native

CCIP fees are paid in LINK (Chainlink's native token) or the chain's native gas token (ETH, POL, BNB, etc.). Fee rate depends on:
- Lane congestion (OnRamp/OffRamp utilization)
- Destination gas limit (higher execution complexity → higher fee)
- Current LINK or native token price

**Implication:** The `CcipBridgeAdapter` exposes `getFee()` for upfront quotes. The Justify UI calls this **before** the user confirms the order, and displays the bridge fee explicitly in the payout calculator ("To win: $X, after $Y trade fee and $Z bridge fee"). For LINK-denominated fees, the protocol must maintain a LINK balance on each source chain or enable users to pay in native and auto-swap to LINK (via Chainlink Automation or a DEX integration).

### 6.4 Allowlisting senders and receivers

CCIP best practice: **allowlist** which contracts can send to your receiver, and which receivers your sender is authorized to target. Justify enforces this via:

- `CcipBridgeAdapter.allowedSenders[ccipSelector] = remoteAdapterAddress` — only accept messages from known remote adapter instances.
- `CcipBridgeAdapter.destinationTargets[ccipSelector] = homeMarketOrProxyRegistry` — only send to known endpoints.

**Implication:** When deploying a new chain, the protocol owner must call `configureRoute()` on both sides (source and destination adapters) to establish the two-way lane. This is an operational checklist item (see [04-per-chain-bridge-playbook.md](./04-per-chain-bridge-playbook.md)).

### 6.5 Not yet deployed

**This entire design is forward-looking.** As of Phase 1 (Arc testnet), Justify is single-chain. Phase 2 (multi-chain native) will deploy independent markets per chain with no bridge. Phase 3 (bridge-proxied markets) is when `CcipBridgeAdapter` is built, tested, and deployed.

**Why document it now?** To freeze the `IBridgeAdapter` interface and the architectural separation before the contracts are written, so that the `MarketProxy` and home-market integration can be designed in parallel without waiting for CCIP lane availability.

---

## 7. Forward links and integration

- **[01-bridge-adapter-interface.md](./01-bridge-adapter-interface.md)** — the `IBridgeAdapter` seam this adapter implements.
- **[03-marketproxy-and-home-market.md](./03-marketproxy-and-home-market.md)** — how `MarketProxy` calls `sendIntent()` and handles `_ccipReceive()` callbacks.
- **[04-per-chain-bridge-playbook.md](./04-per-chain-bridge-playbook.md)** — operational playbook: how to deploy the adapter per chain, configure lanes, fund LINK, test end-to-end.
- **[05-cross-chain-resolution.md](./05-cross-chain-resolution.md)** — how CCIP carries resolution messages from the home market to all proxies, settling every chain in one atomic broadcast.
- **[06-security-and-risk-management.md](./06-security-and-risk-management.md)** — circuit breaker, exposure caps, RMN monitoring, and what happens when CCIP itself is compromised.

---

## 8. Summary

Justify's bridge layer is **explicitly inspired by Chainlink CCIP's architecture** — the router/adapter separation, the commit/execute DON model, the independent risk management network, and the lane-based transport abstraction. Our first production adapter, `CcipBridgeAdapter`, is not a reimplementation of CCIP but a **thin integration layer** that calls CCIP's own `IRouterClient` to send intents and implements `CCIPReceiver` to receive confirmations.

This design gives Justify:
- **Decentralized security:** CCIP's DON consensus and RMN blessing/cursing protect the message layer.
- **Predictable latency:** finality-bound commit phase means users know when to expect their fill.
- **Cost transparency:** upfront fee quotes let the UI surface the full cost before submission.
- **Separation of value and instruction:** CCIP for messages, CCTP for USDC transfers, each optimized for its role.
- **Future composability:** the same adapter pattern can wrap LayerZero, Wormhole, or any other message bridge if a lane requires it.

The result: Justify's cross-chain markets are **bridge-transport-agnostic by contract design**, but **CCIP-first by deployment strategy**, leveraging the most mature and security-hardened cross-chain protocol in production today.

---

**Next:** Read [03-marketproxy-and-home-market.md](./03-marketproxy-and-home-market.md) to see how `MarketProxy` wraps this adapter into a user-facing order flow.
