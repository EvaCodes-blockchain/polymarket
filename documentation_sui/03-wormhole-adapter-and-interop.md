# Wormhole Adapter and Interop — The Sui↔EVM Bridge Transport

**Document:** 03-wormhole-adapter-and-interop.md  
**Status:** Design (Sui project — separate from EVM line)  
**Related:** [02-sui-bridge-overview.md](./02-sui-bridge-overview.md) | [documentation_bridge/01-bridge-adapter-interface.md](../documentation_bridge/01-bridge-adapter-interface.md) | [documentation_bridge/02-chainlink-ccip-adapter.md](../documentation_bridge/02-chainlink-ccip-adapter.md)

---

## 1. Wormhole primer — cross-chain messaging for non-EVM chains

**Wormhole** is a general-purpose cross-chain messaging protocol designed to connect heterogeneous blockchain ecosystems — EVM (Ethereum, Base, Polygon, BSC), non-EVM (Sui, Aptos, Solana), and beyond. Where Chainlink CCIP is optimized for EVM↔EVM messaging with DON-based attestation, Wormhole is built for **multi-ecosystem interoperability** with a **Guardian network** that observes and signs cross-chain messages as **VAAs** (Verified Action Approvals).

Wormhole is the production-proven bridge for Sui↔EVM interop today (2026-06).

### 1.1 Core Wormhole components

#### 1.1.1 Core Bridge contract (per chain)

Every supported chain deploys a **Wormhole Core Bridge** contract (Solidity on EVM, Move on Sui, Rust on Solana) that serves as the single entrypoint for cross-chain messages.

**On the source chain:**
- Senders call `publishMessage(nonce, payload, consistencyLevel)` to emit a message.
- The core contract increments a **sequence number** per emitter address.
- Emits a `LogMessagePublished` event with `(emitter, sequence, payload, consistencyLevel)`.

**On the destination chain:**
- Receivers call `parseAndVerifyVAA(encodedVAA)` to validate an incoming message.
- The core contract verifies the VAA's Guardian signatures and marks it consumed (replay protection).
- Destination contracts extract the payload and execute business logic.

#### 1.1.2 Guardian network

Wormhole's **Guardians** are a permissioned set of 19 validators (as of 2026) run by established entities (Jump Crypto, Chorus One, Figment, etc.). Guardians:

1. **Observe** `LogMessagePublished` events on all supported chains.
2. **Attest** to observed messages by signing a **VAA** (Verified Action Approval) — a data structure containing the message payload, source chain, emitter address, sequence number, and a threshold signature (13-of-19 Guardian consensus).
3. **Publish** VAAs to a gossip network where relayers and users can fetch them.

The Guardian network is **off-chain**; VAAs are cryptographic proofs that a message was observed and attested by a quorum of Guardians.

#### 1.1.3 VAA (Verified Action Approval)

A **VAA** is the core Wormhole primitive — a signed attestation that a message was published on a source chain:

```
┌─────────────────────────────────────────────────────────────────┐
│ VAA (Verified Action Approval)                                  │
├─────────────────────────────────────────────────────────────────┤
│ version: u8                                                      │
│ guardianSetIndex: u32       (which Guardian set signed this)     │
│ signatures: Vec<Signature>  (Guardian signatures; 13-of-19)      │
│ timestamp: u32              (Guardian observation time)          │
│ nonce: u32                  (publisher-chosen nonce)             │
│ emitterChain: u16           (Wormhole chain ID, source)          │
│ emitterAddress: [u8; 32]    (32-byte canonical address)          │
│ sequence: u64               (monotonic per emitter)              │
│ consistencyLevel: u8        (finality threshold)                 │
│ payload: Vec<u8>            (arbitrary application data)         │
└─────────────────────────────────────────────────────────────────┘
```

**Key properties:**
- **Self-contained:** the VAA includes the entire message; no on-chain query needed.
- **Replay protection:** each VAA's hash is marked consumed on the destination chain after verification.
- **Ordering:** sequence numbers are per-emitter, enforcing message order from a single sender.

#### 1.1.4 Wormhole chain IDs (distinct from native chain IDs)

Wormhole assigns a **uint16 chain ID** to each supported blockchain, distinct from native chain IDs:

| Chain          | Native Chain ID | Wormhole Chain ID |
|----------------|-----------------|-------------------|
| Ethereum       | 1               | 2                 |
| Base           | 8453            | 30                |
| Polygon PoS    | 137             | 5                 |
| BSC            | 56              | 4                 |
| **Sui**        | (no EVM ID)     | 21                |
| Solana         | (no EVM ID)     | 1                 |

The adapter must translate between Justify's EVM chain IDs and Wormhole chain IDs.

#### 1.1.5 Wormhole Token Bridge

Wormhole provides a **Token Bridge** layer built on top of the core bridge for fungible token transfers:

- **Lock-and-mint** model: on the origin chain, tokens are locked in a custody contract; on the destination, wrapped representations are minted.
- **Attested tokens:** the Token Bridge tracks which tokens are "native" to which chain; wrapped tokens can be burned to unlock the native asset.

**For USDC specifically**, Circle's **CCTP** (Cross-Chain Transfer Protocol) is integrated with Wormhole on Sui and EVM chains that support native USDC. Where CCTP is available, use **Circle CCTP via Wormhole's CCTP relay** (burn native USDC, mint native USDC on destination) rather than the Token Bridge's wrapped model.

### 1.2 Message flow: Sui→EVM via Wormhole

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          SOURCE CHAIN (Sui)                                  │
│                                                                              │
│  User calls Move entry function (e.g., market_proxy::buy)                   │
│       │                                                                      │
│       │ 1. Lock Coin<USDC> in MarketProxy shared object                     │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────┐                   │
│  │  wormhole_adapter module (Move)                      │                   │
│  │  encode BuyIntent with BCS                           │                   │
│  └────────────┬─────────────────────────────────────────┘                   │
│               │ 2. publish_message(wormhole_state, payload, nonce)          │
│               ▼                                                              │
│  ┌──────────────────────────────────────────────────────┐                   │
│  │  wormhole::state (Sui core bridge module)            │                   │
│  │  emit MessagePublished(emitter, sequence, payload)   │                   │
│  └──────────────────────────────────────────────────────┘                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                            │
                            │  (off-chain observation by Guardians)
                            ▼
           ┌──────────────────────────────────────┐
           │     Wormhole Guardian Network        │
           │  observes MessagePublished event,    │
           │  signs VAA (13-of-19 consensus),     │
           │  publishes to gossip network         │
           └────────────┬─────────────────────────┘
                        │
                        │ 3. User/relayer fetches VAA
                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        DESTINATION CHAIN (e.g. Base)                         │
│                                                                              │
│  ┌───────────────────────────────────────────────────┐                      │
│  │  WormholeBridgeAdapter (Solidity)                 │                      │
│  │  4. receiveMessage(encodedVAA)                    │                      │
│  └───────────┬───────────────────────────────────────┘                      │
│              │                                                               │
│              │ 5. call wormhole.parseAndVerifyVAA(encodedVAA)               │
│              ▼                                                               │
│  ┌───────────────────────────────────────────────────┐                      │
│  │  IWormhole (Wormhole Core Bridge on Base)         │                      │
│  │  verify Guardian signatures, check replay,        │
│  │  return (VM memory parsedVAA)                     │                      │
│  └───────────┬───────────────────────────────────────┘                      │
│              │                                                               │
│              │ 6. decode payload (BCS→abi.decode glue), extract BuyIntent   │
│              ▼                                                               │
│  ┌───────────────────────────────────────────────────┐                      │
│  │  HomeMarketGateway (Justify home contract)        │                      │
│  │  execute buy against MarketAMM                    │                      │
│  └───────────────────────────────────────────────────┘                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key differences from CCIP:**
- **No on-chain commit phase** — Wormhole VAAs are off-chain until submitted by a relayer or user; CCIP commits Merkle roots on-chain before execution.
- **User/relayer-driven delivery** — the VAA must be fetched from the Guardian network and submitted to the destination chain (permissionless); CCIP's Executing DON automatically delivers messages.
- **BCS↔ABI encoding boundary** — Sui uses BCS (Binary Canonical Serialization) for Move structs; EVM uses ABI encoding. The adapter must translate.

---

## 2. Sui side: Move wormhole_adapter module

### 2.1 Architecture

The `wormhole_adapter` module (part of the Justify Sui Move package) wraps the Sui Wormhole core bridge and provides:

1. **BUY flow:** accept user's `Coin<USDC>`, lock it in the MarketProxy, serialize a BuyIntent with BCS, publish a Wormhole message.
2. **Incoming VAA verification:** when a FillConfirmation or ResolutionBroadcast VAA arrives from an EVM chain, parse and verify the VAA, decode the payload, and execute the action (mint wrapped receipt, mark resolved).

### 2.2 Illustrative Move code

```move
// File: sources/wormhole_adapter.move
module justify::wormhole_adapter {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::transfer;
    use sui::event;
    use sui::bcs;
    use wormhole::state::{State as WormholeState};
    use wormhole::publish_message;
    use wormhole::vaa::{Self, VAA};
    use wormhole::bytes::{Self as wormhole_bytes};

    /// Emitter capability — only the adapter can emit Wormhole messages for Justify
    struct EmitterCap has key, store {
        id: UID,
    }

    /// Adapter state — tracks consumed VAA hashes (replay protection), destination routes
    struct AdapterState has key {
        id: UID,
        consumed_vaas: Table<vector<u8>, bool>,  // VAA hash → consumed flag
        allowed_emitters: Table<u16, vector<u8>>,  // Wormhole chain ID → allowed emitter address
        home_chain_id: u16,  // Wormhole chain ID for the EVM home chain (e.g. 30 for Base)
    }

    /// BuyIntent — matches the struct from documentation_bridge/01
    struct BuyIntent has copy, drop {
        market_id: u64,
        trader: vector<u8>,  // 32-byte canonical address (Sui address)
        outcome_index: u8,
        collateral_in: u64,
        max_slippage: u64,
        nonce: u64,
    }

    /// FillConfirmation — incoming from EVM home market
    struct FillConfirmation has copy, drop {
        intent_message_id: vector<u8>,  // Original VAA hash
        market_id: u64,
        trader: vector<u8>,
        outcome_index: u8,
        shares_out: u64,
        execution_price: u64,
    }

    /// Events
    struct MessagePublished has copy, drop {
        sequence: u64,
        nonce: u32,
        payload_len: u64,
    }

    struct VAAConsumed has copy, drop {
        vaa_hash: vector<u8>,
        emitter_chain: u16,
        sequence: u64,
    }

    /// Initialize the adapter (called once at deployment)
    public fun init_adapter(
        wormhole_state: &WormholeState,
        home_wormhole_chain_id: u16,
        ctx: &mut TxContext
    ) {
        let emitter_cap = EmitterCap { id: object::new(ctx) };
        let adapter_state = AdapterState {
            id: object::new(ctx),
            consumed_vaas: table::new(ctx),
            allowed_emitters: table::new(ctx),
            home_chain_id: home_wormhole_chain_id,
        };
        transfer::share_object(adapter_state);
        transfer::transfer(emitter_cap, tx_context::sender(ctx));
    }

    /// Send a BuyIntent to the EVM home market
    /// @param market_id: Home market ID on the EVM chain
    /// @param outcome_index: 0 = YES, 1 = NO
    /// @param collateral_coin: Locked USDC from the user
    /// @param max_slippage: Basis points (e.g. 300 = 3%)
    /// @param nonce: Per-user nonce for ordering
    public entry fun send_buy_intent(
        adapter_state: &AdapterState,
        wormhole_state: &mut WormholeState,
        emitter_cap: &EmitterCap,
        market_id: u64,
        outcome_index: u8,
        collateral_coin: Coin<USDC>,
        max_slippage: u64,
        nonce: u64,
        ctx: &mut TxContext
    ) {
        let trader = tx_context::sender(ctx);
        let collateral_in = coin::value(&collateral_coin);

        // Lock collateral in the MarketProxy (omitted here; assume proxy holds coin)
        // transfer::public_transfer(collateral_coin, market_proxy_address);

        // Construct BuyIntent
        let intent = BuyIntent {
            market_id,
            trader: address::to_bytes(trader),
            outcome_index,
            collateral_in,
            max_slippage,
            nonce,
        };

        // Serialize with BCS
        let payload = bcs::to_bytes(&intent);

        // Publish Wormhole message
        // nonce: random u32 for uniqueness (can derive from Sui tx digest)
        let msg_nonce = (nonce % 0xFFFFFFFF) as u32;
        let consistency_level = 15u8;  // Sui finality (confirm with Wormhole Sui docs)

        let (sequence, _) = wormhole::publish_message::publish_message(
            wormhole_state,
            msg_nonce,
            payload,
            consistency_level,
            ctx
        );

        event::emit(MessagePublished {
            sequence,
            nonce: msg_nonce,
            payload_len: vector::length(&payload),
        });
    }

    /// Receive and verify a FillConfirmation VAA from the EVM home market
    /// @param encoded_vaa: VAA bytes fetched from Guardian network
    public entry fun receive_fill_confirmation(
        adapter_state: &mut AdapterState,
        wormhole_state: &WormholeState,
        encoded_vaa: vector<u8>,
        ctx: &mut TxContext
    ) {
        // Parse and verify VAA
        let vaa = wormhole::vaa::parse_and_verify(wormhole_state, encoded_vaa, ctx);

        // Replay protection: check VAA hash not consumed
        let vaa_hash = wormhole::vaa::hash(&vaa);
        assert!(!table::contains(&adapter_state.consumed_vaas, vaa_hash), ERR_VAA_ALREADY_CONSUMED);
        table::add(&mut adapter_state.consumed_vaas, vaa_hash, true);

        // Validate emitter is allowlisted
        let emitter_chain = wormhole::vaa::emitter_chain(&vaa);
        let emitter_address = wormhole::vaa::emitter_address(&vaa);
        assert!(
            table::contains(&adapter_state.allowed_emitters, emitter_chain),
            ERR_EMITTER_NOT_ALLOWED
        );
        let allowed_emitter = table::borrow(&adapter_state.allowed_emitters, emitter_chain);
        assert!(emitter_address == *allowed_emitter, ERR_EMITTER_MISMATCH);

        // Extract payload and decode FillConfirmation
        let payload = wormhole::vaa::take_payload(vaa);
        let fill_confirmation: FillConfirmation = bcs::from_bytes(&payload);

        // Execute: mint wrapped receipt to trader on Sui
        // (MarketProxy logic omitted; assume proxy::mint_wrapped_receipt is called)
        // let trader_address = address::from_bytes(fill_confirmation.trader);
        // market_proxy::mint_wrapped_receipt(trader_address, fill_confirmation.outcome_index, fill_confirmation.shares_out, ctx);

        event::emit(VAAConsumed {
            vaa_hash,
            emitter_chain,
            sequence: wormhole::vaa::sequence(&vaa),
        });
    }

    /// Admin function: allowlist an EVM emitter address for a Wormhole chain ID
    public entry fun allowlist_emitter(
        adapter_state: &mut AdapterState,
        wormhole_chain_id: u16,
        emitter_address: vector<u8>,
        ctx: &mut TxContext
    ) {
        // Access control omitted (only owner can call)
        table::add(&mut adapter_state.allowed_emitters, wormhole_chain_id, emitter_address);
    }

    // Error codes
    const ERR_VAA_ALREADY_CONSUMED: u64 = 1;
    const ERR_EMITTER_NOT_ALLOWED: u64 = 2;
    const ERR_EMITTER_MISMATCH: u64 = 3;
}
```

### 2.3 Key Move-specific patterns

- **Shared object `AdapterState`:** allows concurrent access for VAA verification across multiple transactions.
- **EmitterCap capability:** restricts who can publish messages on behalf of Justify (only the adapter module or authorized callers).
- **BCS serialization:** `bcs::to_bytes(&intent)` produces a canonical binary encoding that the EVM side must decode (see §4).
- **Wormhole `publish_message`:** returns `(sequence, ...)` for tracking; the sequence is per-emitter and monotonic.
- **VAA verification:** `wormhole::vaa::parse_and_verify()` checks Guardian signatures and finality; the module then enforces emitter allowlisting and replay protection.

---

## 3. EVM side: WormholeBridgeAdapter (Solidity)

### 3.1 Purpose

The `WormholeBridgeAdapter` on the EVM side (Base, Ethereum, etc.) implements the **same `IBridgeAdapter` interface** as the Chainlink CCIP adapter (from [documentation_bridge/01-bridge-adapter-interface.md](../documentation_bridge/01-bridge-adapter-interface.md)). This is the critical integration seam: the `HomeMarketGateway` does not know whether messages arrive via CCIP or Wormhole — it calls the same `receiveMessage()` callback.

### 3.2 Illustrative Solidity

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IBridgeAdapter.sol";
import "@wormhole-solidity-sdk/interfaces/IWormhole.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title WormholeBridgeAdapter
/// @notice Wormhole transport adapter for Justify Sui↔EVM bridge.
///         Implements the same IBridgeAdapter interface as ChainlinkCCIPAdapter,
///         enabling the HomeMarketGateway to remain transport-agnostic.
///
///         On SEND: encodes Justify message payloads (BuyIntent, etc.) into
///         abi.encodePacked format, publishes via Wormhole core bridge.
///
///         On RECEIVE: verifies incoming VAA from Wormhole core, decodes
///         BCS-encoded Sui payloads (via a BCS→ABI parser), and invokes
///         the destination contract's receiveMessage callback.
contract WormholeBridgeAdapter is IBridgeAdapter, Ownable {
    /// @notice Wormhole core bridge contract on this EVM chain
    IWormhole public immutable wormhole;

    /// @notice Mapping: Justify chain ID → Wormhole chain ID
    mapping(uint256 => uint16) public justifyToWormholeChain;

    /// @notice Mapping: Wormhole chain ID → Justify chain ID (reverse lookup)
    mapping(uint16 => uint256) public wormholeToJustifyChain;

    /// @notice Allowlisted remote emitter addresses per Wormhole chain ID
    mapping(uint16 => bytes32) public allowedEmitters;

    /// @notice Consumed VAA hashes (replay protection)
    mapping(bytes32 => bool) public consumedVAAs;

    /// @notice Destination contract for incoming messages (e.g., HomeMarketGateway)
    address public destinationReceiver;

    /// @notice Wormhole consistency level (finality threshold)
    uint8 public consistencyLevel = 15;

    event MessageSent(
        uint64 indexed sequence,
        uint16 indexed targetChain,
        bytes payload
    );

    event MessageReceived(
        bytes32 indexed vaaHash,
        uint16 indexed sourceChain,
        bytes32 indexed emitter,
        bytes payload
    );

    event EmitterAllowlisted(uint16 wormholeChainId, bytes32 emitterAddress);

    error VAAReplayed(bytes32 vaaHash);
    error EmitterNotAllowed(uint16 chainId, bytes32 emitter);
    error InvalidDestination();

    constructor(
        address _wormhole,
        address _destinationReceiver
    ) Ownable(msg.sender) {
        wormhole = IWormhole(_wormhole);
        destinationReceiver = _destinationReceiver;
    }

    /// ═══════════════════════════════════════════════════════════════════════
    ///  IBridgeAdapter implementation — SEND
    /// ═══════════════════════════════════════════════════════════════════════

    /// @notice Send a cross-chain message via Wormhole
    /// @param destChainSelector  Justify chain ID (translated to Wormhole chain ID)
    /// @param receiver           Destination contract address (encoded as bytes32 in Wormhole)
    /// @param payload            ABI-encoded message (BuyIntent | SellIntent | etc.)
    /// @param gasLimit           Ignored (Wormhole does not enforce destination gas limit)
    /// @return messageId         VAA hash (not available until Guardian signing; return sequence as placeholder)
    function sendMessage(
        uint64 destChainSelector,
        address receiver,
        bytes calldata payload,
        uint256 gasLimit  // ignored for Wormhole
    ) external payable override returns (bytes32 messageId) {
        uint16 targetWormholeChain = justifyToWormholeChain[uint256(destChainSelector)];
        require(targetWormholeChain != 0, "WormholeAdapter: destination not configured");

        // Publish message via Wormhole core
        uint32 nonce = uint32(block.timestamp % type(uint32).max);  // pseudo-random nonce
        uint64 sequence = wormhole.publishMessage{value: msg.value}(
            nonce,
            payload,
            consistencyLevel
        );

        emit MessageSent(sequence, targetWormholeChain, payload);

        // Return sequence as messageId (VAA hash not yet available)
        messageId = keccak256(abi.encodePacked(sequence, targetWormholeChain));
    }

    /// @notice Quote the fee for a Wormhole message
    /// @dev Wormhole fee is the core bridge's messageFee(), independent of payload size
    function quoteFee(
        uint64 destChainSelector,
        address receiver,
        bytes calldata payload,
        uint256 gasLimit
    ) external view override returns (uint256 feeAmount) {
        return wormhole.messageFee();
    }

    /// ═══════════════════════════════════════════════════════════════════════
    ///  IBridgeAdapter implementation — RECEIVE
    /// ═══════════════════════════════════════════════════════════════════════

    /// @notice Receive and verify a Wormhole VAA, decode payload, forward to destination
    /// @param sourceChainSelector  Wormhole source chain ID (translated to Justify chain ID)
    /// @param sender               Emitter address on source chain (32-byte Wormhole canonical)
    /// @param payload              Encoded VAA bytes (full VAA including signatures)
    function receiveMessage(
        uint64 sourceChainSelector,  // Wormhole chain ID
        address sender,               // Ignored (we parse emitter from VAA)
        bytes calldata payload        // Encoded VAA
    ) external override {
        // Parse and verify VAA
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole.parseAndVerifyVM(payload);
        require(valid, string(abi.encodePacked("Invalid VAA: ", reason)));

        // Replay protection
        bytes32 vaaHash = vm.hash;
        if (consumedVAAs[vaaHash]) revert VAAReplayed(vaaHash);
        consumedVAAs[vaaHash] = true;

        // Validate emitter is allowlisted
        uint16 emitterChain = vm.emitterChainId;
        bytes32 emitter = vm.emitterAddress;
        bytes32 allowedEmitter = allowedEmitters[emitterChain];
        if (allowedEmitter == bytes32(0) || allowedEmitter != emitter) {
            revert EmitterNotAllowed(emitterChain, emitter);
        }

        // Decode the payload (BCS-encoded from Sui → decode to Justify structs)
        // For simplicity, assume payload is already ABI-encoded on Sui side (hybrid encoding)
        // Production: implement a BCS→ABI decoder library or off-chain relay that re-encodes
        bytes memory message = vm.payload;

        emit MessageReceived(vaaHash, emitterChain, emitter, message);

        // Forward to destination receiver (HomeMarketGateway or MarketProxy)
        if (destinationReceiver == address(0)) revert InvalidDestination();
        uint256 sourceJustifyChain = wormholeToJustifyChain[emitterChain];

        IBridgeReceiver(destinationReceiver).receiveMessage(
            uint64(sourceJustifyChain),
            address(uint160(uint256(emitter))),  // Convert bytes32 to address (lossy for Sui, safe for EVM)
            message
        );
    }

    /// ═══════════════════════════════════════════════════════════════════════
    ///  Admin functions
    /// ═══════════════════════════════════════════════════════════════════════

    /// @notice Configure Justify↔Wormhole chain ID mapping
    function configureChainMapping(
        uint256 justifyChainId,
        uint16 wormholeChainId
    ) external onlyOwner {
        justifyToWormholeChain[justifyChainId] = wormholeChainId;
        wormholeToJustifyChain[wormholeChainId] = justifyChainId;
    }

    /// @notice Allowlist a remote emitter (e.g., the Sui wormhole_adapter module)
    /// @param wormholeChainId  Wormhole chain ID (e.g., 21 for Sui)
    /// @param emitterAddress   32-byte canonical address of the emitter
    function allowlistEmitter(uint16 wormholeChainId, bytes32 emitterAddress)
        external
        onlyOwner
    {
        allowedEmitters[wormholeChainId] = emitterAddress;
        emit EmitterAllowlisted(wormholeChainId, emitterAddress);
    }

    /// @notice Update destination receiver (HomeMarketGateway, etc.)
    function setDestinationReceiver(address _receiver) external onlyOwner {
        destinationReceiver = _receiver;
    }

    /// @notice Set Wormhole consistency level (finality threshold)
    function setConsistencyLevel(uint8 _level) external onlyOwner {
        consistencyLevel = _level;
    }
}

/// @notice Callback interface for destination contracts receiving Wormhole messages
interface IBridgeReceiver {
    function receiveMessage(
        uint64 sourceChainSelector,
        address sender,
        bytes calldata payload
    ) external;
}
```

### 3.3 Key Solidity-specific patterns

- **IWormhole.parseAndVerifyVM:** the Wormhole core contract on EVM returns a `VM` (Verified Message) struct containing parsed VAA fields and verification status.
- **Replay protection via `consumedVAAs` mapping:** each VAA hash is marked consumed after processing.
- **Emitter allowlisting:** only VAAs from pre-configured Sui emitter addresses (the `wormhole_adapter` module) are accepted.
- **IBridgeAdapter interface compliance:** the same `sendMessage()` / `receiveMessage()` / `quoteFee()` signatures as the CCIP adapter, so `HomeMarketGateway` can swap adapters without code changes.

---

## 4. Message encoding across the Sui↔EVM boundary

### 4.1 The BCS↔ABI translation challenge

**Sui Move** serializes structs with **BCS** (Binary Canonical Serialization) — a compact, deterministic encoding designed for Move's type system. **EVM Solidity** uses **ABI encoding** (abi.encode / abi.decode) with different padding and type representations.

**Problem:** A `BuyIntent` struct serialized with BCS on Sui cannot be directly decoded with `abi.decode` on EVM.

**Solutions:**

#### Option 1: Hybrid encoding (staged rollout)

For MVP / Phase 3, the Sui side encodes messages in a **hybrid format** that mimics ABI encoding:

- Serialize each field as a fixed-width big-endian integer (u64 → 8 bytes, u8 → 1 byte, address → 32 bytes).
- Concatenate fields in the same order as the Solidity struct.
- EVM side uses `abi.decode` with explicit offsets.

**Example (BuyIntent):**

```move
// Sui side (hybrid encoding for EVM compatibility)
public fun encode_buy_intent_abi(intent: &BuyIntent): vector<u8> {
    let mut buf = vector::empty<u8>();
    vector::append(&mut buf, bcs::to_bytes(&intent.market_id));       // u64 → 8 bytes
    vector::append(&mut buf, intent.trader);                          // 32 bytes (Sui address)
    vector::append(&mut buf, vector::singleton(intent.outcome_index)); // u8 → 1 byte
    vector::append(&mut buf, bcs::to_bytes(&intent.collateral_in));   // u64 → 8 bytes
    vector::append(&mut buf, bcs::to_bytes(&intent.max_slippage));    // u64 → 8 bytes
    vector::append(&mut buf, bcs::to_bytes(&intent.nonce));           // u64 → 8 bytes
    buf
}
```

```solidity
// EVM side (decode hybrid-encoded payload)
function decodeBuyIntent(bytes memory payload) internal pure returns (BuyIntent memory) {
    require(payload.length >= 89, "Invalid BuyIntent payload length");
    uint256 offset = 0;

    uint256 marketId = uint256(bytes8(bytes(payload)[offset:offset+8]));
    offset += 8;

    address trader = address(bytes20(bytes(payload)[offset:offset+32])); // truncate 32→20 for EVM
    offset += 32;

    uint8 outcomeIndex = uint8(bytes1(bytes(payload)[offset]));
    offset += 1;

    uint256 collateralIn = uint256(bytes8(bytes(payload)[offset:offset+8]));
    offset += 8;

    uint256 maxSlippage = uint256(bytes8(bytes(payload)[offset:offset+8]));
    offset += 8;

    uint256 nonce = uint256(bytes8(bytes(payload)[offset:offset+8]));

    return BuyIntent(marketId, trader, outcomeIndex, collateralIn, maxSlippage, nonce);
}
```

**Tradeoffs:**
- **Pro:** No external libraries; deterministic encoding.
- **Con:** Manual serialization per struct; brittle if field order changes.

#### Option 2: Off-chain relay with re-encoding

A **relay service** (Go/Rust) fetches VAAs from the Guardian network, decodes BCS payloads, re-encodes to ABI, and submits to the EVM adapter.

**Pro:** Clean on-chain contracts; Move and Solidity use native encoding.  
**Con:** Adds off-chain infrastructure; relay becomes a trust dependency (mitigated by making relay code open-source and permissionless).

#### Option 3: On-chain BCS decoder library (future)

Deploy a Solidity library that parses BCS-encoded bytes. Requires significant engineering and gas optimization.

**Recommendation for Phase 3:** Use **Option 1 (hybrid encoding)** for the initial Sui bridge. Plan migration to **Option 2 (relay)** when message volume justifies the infrastructure.

### 4.2 Canonical wire format per message type

| Message Type         | Sui → EVM (BCS or hybrid)                                                                 | EVM → Sui (ABI-encoded, BCS-parsed on Sui) |
|----------------------|-------------------------------------------------------------------------------------------|---------------------------------------------|
| **BuyIntent**        | `market_id: u64, trader: [u8;32], outcome_index: u8, collateral_in: u64, max_slippage: u64, nonce: u64` | Same struct, abi.encode → BCS decode       |
| **SellIntent**       | `market_id: u64, trader: [u8;32], outcome_index: u8, shares_in: u64, min_payout: u64, nonce: u64` | Same                                        |
| **FillConfirmation** | `intent_message_id: [u8;32], market_id: u64, trader: [u8;32], outcome_index: u8, shares_out: u64, execution_price: u64` | Same                                        |
| **ResolutionBroadcast** | `market_id: u64, winning_outcome: u8, resolved_at: u64`                                | Same                                        |
| **RefundNotice**     | `intent_message_id: [u8;32], market_id: u64, trader: [u8;32], refund_amount: u64, reason: u8` | Same                                        |

Each field is big-endian; addresses are zero-padded to 32 bytes (Sui native) or truncated to 20 bytes (EVM).

---

## 5. Value legs: moving USDC Sui↔EVM

### 5.1 Circle CCTP integration (native USDC)

Sui supports **native Circle USDC** and is a CCTP-supported chain (as of 2025). Use **Circle CCTP** for the collateral leg:

**Sui → EVM (BUY flow):**
1. User locks `Coin<USDC>` in the Sui MarketProxy.
2. MarketProxy calls **Sui CCTP TokenMessenger** to burn USDC.
3. Off-chain: Circle's attestation service observes the burn, signs an attestation.
4. EVM side: a keeper (or the user) submits the attestation to the EVM CCTP MessageTransmitter, which mints native USDC on the destination chain.
5. HomeMarketGateway uses the minted USDC to execute the buy on the AMM.

**EVM → Sui (REFUND or REDEMPTION flow):**
1. HomeMarketGateway burns USDC via EVM CCTP.
2. Circle attestation service observes, signs.
3. Sui side: submit attestation to Sui CCTP, which mints native USDC back to the user's address.

### 5.2 When to use Wormhole Token Bridge vs CCTP

| Scenario                     | Use CCTP                             | Use Wormhole Token Bridge            |
|------------------------------|--------------------------------------|--------------------------------------|
| **Collateral is USDC**       | ✓ (native burn/mint, lower fee)     | Only if CCTP unavailable on one side |
| **Collateral is non-USDC**   | ✗ (CCTP only supports USDC)         | ✓ (lock-and-mint wrapped tokens)     |
| **Sui ↔ Base/Ethereum/Polygon** | ✓ (all support CCTP)              | Fallback if CCTP down               |
| **Sui ↔ BSC**                | Confirm (BSC CCTP TBD as of 2026)   | ✓ (Wormhole Token Bridge exists)     |

**Integration note:** The Sui `wormhole_adapter` module should expose both paths:

```move
public entry fun send_buy_intent_with_cctp(
    // burn USDC via Sui CCTP, send Wormhole intent message
);

public entry fun send_buy_intent_with_wormhole_bridge(
    // lock USDC in Wormhole Token Bridge, send Wormhole intent message with token transfer
);
```

The frontend chooses the appropriate function based on route configuration.

### 5.3 Coordination: CCTP + Wormhole dual-leg timing

The **intent message** (via Wormhole) and the **USDC transfer** (via CCTP) are **independent legs** with different finality times:

- **Wormhole VAA:** available in ~seconds after Guardian observation (13-of-19 consensus).
- **CCTP attestation:** available in ~seconds after Circle's attestation service observes the burn.

**Arrival order is nondeterministic.** The EVM `HomeMarketGateway` must handle both cases:

- **Case 1:** Wormhole VAA arrives first → queue the intent, wait for CCTP USDC mint.
- **Case 2:** CCTP USDC mints first → hold in escrow, wait for Wormhole VAA, then execute.

**Implementation:** the gateway maintains a `pendingIntents` mapping keyed by `intentNonce`, tracking which leg has arrived. When both arrive, execute the AMM buy.

---

## 6. Chainlink CCIP mapping — architectural equivalence

The Sui bridge uses **Wormhole** as the concrete transport but maintains the **same architectural layering** as the EVM bridge's **Chainlink CCIP-inspired design**. This table explicitly maps Wormhole concepts to CCIP concepts to the Justify abstraction:

| Justify Abstraction          | Chainlink CCIP Equivalent                  | Wormhole Equivalent                        |
|------------------------------|--------------------------------------------|--------------------------------------------|
| **Bridge transport**          | Chainlink CCIP messaging                  | Wormhole core bridge                      |
| **Message attestation**       | Committing DON (builds Merkle root)      | Guardian network (signs VAA)              |
| **Message verification**      | Executing DON (verifies proof, delivers)  | Relayer submits VAA; core contract verifies Guardian signatures |
| **Chain identifier**          | CCIP chain selector (uint64)              | Wormhole chain ID (uint16)                |
| **Route / Lane**              | CCIP lane (source→dest pair)              | Wormhole route (source→dest chain ID pair) |
| **Message ID**                | CCIP messageId (bytes32, returned by ccipSend) | VAA hash (bytes32, computed after Guardian signing) |
| **Emitter authentication**    | CCIP sender allowlist (per OffRamp)       | Wormhole emitter allowlist (per adapter) |
| **Replay protection**         | CCIP sequence numbers + nonce             | VAA hash consumed flag + sequence per emitter |
| **Finality enforcement**      | CCIP `consistencyLevel` (source finality) | Wormhole `consistencyLevel` (source finality) |
| **Risk management layer**     | CCIP Risk Management Network (RMN) — blessing/cursing | Justify circuit breaker + exposure caps (no Wormhole-native RMN; protocol-layer control) |
| **Value transfer**            | CCIP token pools (lock/mint or burn/mint) | Wormhole Token Bridge (lock/mint) or Circle CCTP (burn/mint native USDC) |
| **Off-chain infrastructure**  | Chainlink DON nodes                       | Wormhole Guardian nodes + Guardian gossip network |

### 6.1 Architectural parity

Both CCIP and Wormhole implement a **commit-then-execute pattern**:

- **CCIP:** Committing DON commits a Merkle root on-chain; Executing DON delivers individual messages with proofs.
- **Wormhole:** Guardians sign VAAs off-chain (commit); relayers/users submit VAAs on-chain (execute).

Justify's `IBridgeAdapter` abstracts both: `sendMessage()` initiates, `receiveMessage()` delivers, and the adapter handles the transport-specific commit/execute details.

### 6.2 Why Wormhole for Sui, CCIP for EVM

- **Wormhole:** production-proven for Sui↔EVM; Sui native integration; 19 Guardians including established validators.
- **CCIP:** mature EVM↔EVM lanes (Ethereum, Base, Polygon, etc.); Chainlink DON security model; native LINK fee model.

**Both** are wrapped behind `IBridgeAdapter`, so Justify's application layer (MarketProxy, HomeMarketGateway) is **transport-agnostic**. A future where Chainlink CCIP supports Sui, or Wormhole supports Arc, can be accommodated by deploying a different adapter without redesigning the core contracts.

---

## 7. Idempotency and ordering

### 7.1 Replay protection

**Sui side:**
- `AdapterState.consumed_vaas: Table<vector<u8>, bool>` — each incoming VAA hash is checked before processing and marked consumed after.

**EVM side:**
- `WormholeBridgeAdapter.consumedVAAs: mapping(bytes32 => bool)` — same pattern.

**Guarantee:** Each VAA is processed **at most once** per chain. If a VAA is submitted twice (user error, reorg, relayer retry), the second attempt reverts with `VAAReplayed`.

### 7.2 Ordering per trader

Each `BuyIntent` includes a **per-trader nonce**. The home `HomeMarketGateway` enforces:

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

**Result:** Intents from the same trader on the same source chain execute **in order** (nonce 1, then 2, then 3, …). Intents from different traders or different chains may interleave.

### 7.3 Wormhole sequence numbers

Each Wormhole emitter (e.g., the `wormhole_adapter` module on Sui) maintains a **monotonic sequence number** per message. The core bridge increments it on every `publish_message()` call.

**Use case:** Off-chain indexers and relayers can track sequences to detect missed messages or ensure complete delivery.

**Note:** Wormhole sequences are **per emitter**, not global. If Justify deploys multiple Sui market contracts that each emit messages, each has its own sequence counter.

### 7.4 Effectively-once semantics

- **At-least-once delivery:** Wormhole Guardians will re-sign a VAA if requested (e.g., after a reorg), and relayers may submit the same VAA multiple times.
- **Idempotency (on-chain):** The adapter's `consumedVAAs` map makes duplicate VAAs a no-op → **effectively-once execution**.

---

## 8. Open questions and Wormhole Sui SDK confirmation

| Topic                          | Status                                                                                                     |
|--------------------------------|------------------------------------------------------------------------------------------------------------|
| **Wormhole Sui SDK**           | Confirm module paths (`wormhole::state`, `wormhole::publish_message`, `wormhole::vaa`) from Wormhole Sui SDK docs. As of 2026, the SDK is under active development; API may differ. |
| **Consistency level**          | Confirm Sui's finality level (e.g., 15 = full finality) from Wormhole docs. Sui uses Mysticeti consensus (sub-second finality); typical consistency level is lower than Ethereum. |
| **Emitter address canonicalization** | Wormhole uses 32-byte addresses; Sui addresses are 32 bytes (native), EVM are 20 bytes (left-padded to 32). Confirm padding convention from Wormhole SDK. |
| **CCTP on Sui**                | Confirm Circle CCTP availability on Sui mainnet (testnet support confirmed as of 2025). If unavailable, fall back to Wormhole Token Bridge for USDC. |
| **BCS↔ABI decoder**            | Production-quality BCS→ABI decoder library in Solidity does not exist as open-source as of 2026. Hybrid encoding (§4.1 Option 1) or off-chain relay (Option 2) are the paths forward. |
| **Guardian set upgrades**      | Wormhole Guardians rotate periodically; VAAs include `guardianSetIndex`. Confirm the adapter tracks the active set index from the core bridge state. |

**Action for implementer:** Validate all Wormhole SDK calls against the official [Wormhole Sui SDK documentation](https://docs.wormhole.com/) before deploying to testnet.

---

## 9. Forward links

- **[documentation_bridge/01-bridge-adapter-interface.md](../documentation_bridge/01-bridge-adapter-interface.md)** — the `IBridgeAdapter` seam this Wormhole adapter implements.
- **[documentation_bridge/02-chainlink-ccip-adapter.md](../documentation_bridge/02-chainlink-ccip-adapter.md)** — the EVM-side CCIP adapter; this document's architectural parallel.
- **[02-sui-bridge-overview.md](./02-sui-bridge-overview.md)** — the Sui bridge's home/proxy split and Chainlink-CCIP-inspired layering.
- **[04-sui-bridge-security.md](./04-sui-bridge-security.md)** — security model: Guardian trust, exposure caps, circuit breaker.
- **[01-move-market-contracts.md](./01-move-market-contracts.md)** — the Sui-native prediction market stack this bridge connects to EVM.

---

## 10. Summary

This document defines the **Wormhole adapter and Sui↔EVM interop layer** for Justify's Sui bridge:

1. **Wormhole primer:** Guardian network, VAAs, core bridge per chain, sequence numbers, off-chain commit pattern.
2. **Sui Move adapter:** `wormhole_adapter` module publishes BCS-encoded BuyIntent messages, verifies incoming FillConfirmation VAAs, enforces emitter allowlisting and replay protection.
3. **EVM Solidity adapter:** `WormholeBridgeAdapter` implements `IBridgeAdapter` (same seam as CCIP), parses VAAs via Wormhole core, decodes BCS↔ABI payloads, forwards to `HomeMarketGateway`.
4. **Message encoding:** hybrid BCS/ABI format for MVP; path to off-chain relay for production.
5. **Value legs:** Circle CCTP for native USDC burn/mint (preferred); Wormhole Token Bridge fallback for non-USDC or unsupported lanes.
6. **Chainlink CCIP mapping:** explicit table mapping Guardian network ↔ DON, VAA ↔ CCIP commit, Wormhole chain ID ↔ CCIP selector — the adapter implements the **same Chainlink-CCIP-inspired IBridgeAdapter seam**, just with Wormhole as transport.
7. **Idempotency:** VAA hash consumed flags, per-trader nonces, sequence tracking → effectively-once execution.

**The result:** Justify's Sui markets bridge to EVM markets with the same security model, guaranteed-bounds fills, and transport abstraction as the EVM↔EVM bridge, extending the "chain is a parameter" thesis to non-EVM ecosystems.

---

**File written:** `/data/PROJECTS/PolyMarket/polymarket/documentation_sui/03-wormhole-adapter-and-interop.md` (316 lines)
