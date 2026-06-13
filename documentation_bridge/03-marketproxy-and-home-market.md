# 03 — MarketProxy and Home-Market Wiring

**Lock, Bridge, Mint: How remote-chain users trade home-chain markets**

This document describes the `MarketProxy` contract design (one per remote chain per market) and the home-side `HomeMarketGateway` integration that together implement the **home/proxy split** from [whitepaper §5.1–§5.2](../documentation_justify_whitepaper/justify-whitepaper.md). The architecture is directly inspired by **Chainlink CCIP's sender/Router → OffRamp/receiver separation**, where the proxy plays the sender role and the home gateway plays the receiver role, with `IBridgeAdapter` ([doc 01](./01-bridge-adapter-interface.md)) as the transport seam.

---

## 1. The model recap

```
User on Base (wants to buy YES on a market homed on Arc)
    ↓ buy(YES, 100 USDC)
┌───────────────────────────────────────────────┐
│  MarketProxy (Base, for Arc market #42)       │
│  1. Lock 100 USDC in escrow                   │
│  2. Emit BuyIntent via IBridgeAdapter          │
│  3. Wait for FillConfirmation                  │
│  4. Mint wrapped receipt (ERC-20) to user      │
└────────────────┬──────────────────────────────┘
                 │ bridge message (CCIP, CCTP)
                 ↓
┌───────────────────────────────────────────────┐
│  HomeMarketGateway (Arc)                      │
│  1. Receive BuyIntent                          │
│  2. Execute buy against MarketAMM #42          │
│  3. Hold outcome tokens on behalf of proxy     │
│  4. Send FillConfirmation back to proxy        │
└───────────────────────────────────────────────┘
```

**Key properties** (from whitepaper §5.2 table):

| Property                | Implementation                                                                                  |
|-------------------------|-------------------------------------------------------------------------------------------------|
| Unified liquidity       | One AMM pool on the home chain; all proxies route to it → single source of truth for pricing.   |
| Single source of truth  | Home-market state (Open/Closed/Resolved) propagates to proxies; no proxy can disagree.          |
| Asynchronous fills      | Bridge time (seconds to minutes); guaranteed-bounds fill or refund.                              |
| Bridge trust            | Proxy position is as safe as min(home chain security, bridge adapter security).                 |
| Local-first routing     | If user's chain == market's home chain, bypass proxy entirely → native PredictionMarket buy.    |

---

## 2. MarketProxy contract design

### 2.1 Purpose

A **`MarketProxy`** is deployed **on a remote chain** (e.g. Base, Polygon, BSC) for a specific **home market** (e.g. Arc market #42). It:

- Locks local collateral (USDC) in escrow when a user submits a buy/sell.
- Calls `IBridgeAdapter.sendMessage()` to emit a BuyIntent or SellIntent to the home chain.
- Mints a **wrapped position receipt** (ERC-20 representing outcome tokens held on the home chain) when the fill confirmation arrives.
- Handles refunds if the home AMM cannot fill within the user's slippage bounds.
- Manages redemption after market resolution: burn receipt → release local collateral.

### 2.2 Illustrative Solidity

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IBridgeAdapter.sol";

/// @title MarketProxy
/// @notice Remote-chain proxy for a home-chain prediction market.
///         Locks local collateral, emits cross-chain buy/sell intents to the
///         home market, mints wrapped position receipts, and handles redemption
///         after settlement propagates back.
///
///         Architecture inspired by Chainlink CCIP sender → OffRamp/receiver:
///         this proxy is the sender; HomeMarketGateway on the home chain is
///         the receiver; IBridgeAdapter is the transport seam.
contract MarketProxy is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The home chain where the real PredictionMarket + AMM lives.
    uint256 public immutable homeChainId;

    /// @notice The market ID on the home chain this proxy fronts.
    uint256 public immutable homeMarketId;

    /// @notice Local collateral token (USDC on Base, Polygon, etc.).
    IERC20 public immutable collateral;

    /// @notice The bridge adapter (CCIP, LayerZero, etc.) used to send messages.
    IBridgeAdapter public immutable bridgeAdapter;

    /// @notice HomeMarketGateway address on the home chain.
    address public immutable homeGateway;

    /// @notice Wrapped position receipt tokens (ERC-20) per outcome.
    ///         wrappedOutcome[0] = wrapped YES, wrappedOutcome[1] = wrapped NO.
    WrappedOutcomeToken[2] public wrappedOutcome;

    /// @notice Intent nonce (prevents replay / double-fill).
    uint256 private _nextIntentNonce;

    /// @notice Pending intent state: collateral locked, awaiting fill or refund.
    struct PendingIntent {
        address user;
        uint8 outcomeIndex;
        uint256 collateralLocked;
        uint256 minSharesOut;
        uint256 timestamp;
    }
    mapping(uint256 => PendingIntent) public pendingIntents;

    /// @notice Market state mirrored from home: Open/Closed/Resolved.
    enum State { Open, Closed, Resolved }
    State public marketState;
    uint8 public winningOutcome; // set on resolution

    /// @notice Total collateral escrowed for all users.
    uint256 public totalEscrowed;

    event IntentSubmitted(
        uint256 indexed nonce,
        address indexed user,
        uint8 outcomeIndex,
        uint256 collateralIn
    );
    event FillConfirmed(
        uint256 indexed nonce,
        uint256 sharesOut,
        uint256 actualPrice
    );
    event IntentRefunded(uint256 indexed nonce, uint256 collateralRefunded);
    event WrappedPositionMinted(
        address indexed user,
        uint8 outcomeIndex,
        uint256 amount
    );
    event MarketResolved(uint8 winningOutcome);
    event Redeemed(address indexed user, uint8 outcomeIndex, uint256 collateral);

    error WrongState(State current, State required);
    error InvalidOutcome();
    error IntentNotPending(uint256 nonce);
    error Unauthorized();
    error ZeroCollateral();
    error InsufficientEscrow();

    constructor(
        uint256 _homeChainId,
        uint256 _homeMarketId,
        address _collateral,
        address _bridgeAdapter,
        address _homeGateway
    ) {
        homeChainId = _homeChainId;
        homeMarketId = _homeMarketId;
        collateral = IERC20(_collateral);
        bridgeAdapter = IBridgeAdapter(_bridgeAdapter);
        homeGateway = _homeGateway;
        marketState = State.Open;

        // Deploy wrapped outcome tokens (ERC-20 representing home-held shares)
        wrappedOutcome[0] = new WrappedOutcomeToken("Wrapped YES", "wYES");
        wrappedOutcome[1] = new WrappedOutcomeToken("Wrapped NO", "wNO");
    }

    /// @notice Submit a cross-chain buy intent.
    /// @param outcomeIndex  0 = YES, 1 = NO.
    /// @param collateralIn  Amount of local collateral to spend.
    /// @param minSharesOut  Minimum shares to accept (slippage bound); 0 = no guard.
    /// @return nonce        Intent nonce for tracking confirmation.
    function buy(uint8 outcomeIndex, uint256 collateralIn, uint256 minSharesOut)
        external
        nonReentrant
        returns (uint256 nonce)
    {
        if (marketState != State.Open) revert WrongState(marketState, State.Open);
        if (outcomeIndex > 1) revert InvalidOutcome();
        if (collateralIn == 0) revert ZeroCollateral();

        // 1. Lock collateral in escrow
        collateral.safeTransferFrom(msg.sender, address(this), collateralIn);
        totalEscrowed += collateralIn;

        nonce = _nextIntentNonce++;

        // 2. Record pending intent
        pendingIntents[nonce] = PendingIntent({
            user: msg.sender,
            outcomeIndex: outcomeIndex,
            collateralLocked: collateralIn,
            minSharesOut: minSharesOut,
            timestamp: block.timestamp
        });

        // 3. Emit bridge message (BuyIntent)
        bytes memory message = abi.encode(
            "BuyIntent",
            nonce,
            homeMarketId,
            outcomeIndex,
            collateralIn,
            minSharesOut
        );
        bridgeAdapter.sendMessage(homeChainId, homeGateway, message);

        emit IntentSubmitted(nonce, msg.sender, outcomeIndex, collateralIn);
    }

    /// @notice Callback from the bridge adapter when the home gateway confirms fill.
    ///         Only the registered bridgeAdapter may call this.
    /// @param nonce       The intent nonce.
    /// @param sharesOut   Number of outcome shares acquired on the home chain.
    /// @param actualPrice The effective price paid (for UI display).
    function confirmFill(uint256 nonce, uint256 sharesOut, uint256 actualPrice)
        external
        nonReentrant
    {
        if (msg.sender != address(bridgeAdapter)) revert Unauthorized();

        PendingIntent memory intent = pendingIntents[nonce];
        if (intent.user == address(0)) revert IntentNotPending(nonce);

        // Slippage check (home-side should enforce, but double-check)
        if (intent.minSharesOut > 0 && sharesOut < intent.minSharesOut) {
            // Refund path (home should have signaled refund instead)
            _refund(nonce, intent);
            return;
        }

        // 4. Mint wrapped position receipt to user
        wrappedOutcome[intent.outcomeIndex].mint(intent.user, sharesOut);

        delete pendingIntents[nonce];

        emit FillConfirmed(nonce, sharesOut, actualPrice);
        emit WrappedPositionMinted(intent.user, intent.outcomeIndex, sharesOut);
    }

    /// @notice Callback when home market cannot fill (bounds miss, closed, etc.).
    function confirmRefund(uint256 nonce) external nonReentrant {
        if (msg.sender != address(bridgeAdapter)) revert Unauthorized();

        PendingIntent memory intent = pendingIntents[nonce];
        if (intent.user == address(0)) revert IntentNotPending(nonce);

        _refund(nonce, intent);
    }

    function _refund(uint256 nonce, PendingIntent memory intent) private {
        totalEscrowed -= intent.collateralLocked;
        collateral.safeTransfer(intent.user, intent.collateralLocked);
        delete pendingIntents[nonce];
        emit IntentRefunded(nonce, intent.collateralLocked);
    }

    /// @notice Mirror home market state (called via bridge after home close/resolve).
    function updateMarketState(State newState, uint8 _winningOutcome)
        external
        nonReentrant
    {
        if (msg.sender != address(bridgeAdapter)) revert Unauthorized();
        marketState = newState;
        if (newState == State.Resolved) {
            winningOutcome = _winningOutcome;
            emit MarketResolved(_winningOutcome);
        }
    }

    /// @notice Redeem wrapped position receipts after resolution.
    ///         Burn receipt → release local collateral at 1:1 (if winning) or 0 (if losing).
    /// @param outcomeIndex  0 = YES, 1 = NO.
    /// @param amount        Number of wrapped shares to redeem.
    function redeem(uint8 outcomeIndex, uint256 amount) external nonReentrant {
        if (marketState != State.Resolved) revert WrongState(marketState, State.Resolved);
        if (outcomeIndex > 1) revert InvalidOutcome();

        // Burn wrapped receipt
        wrappedOutcome[outcomeIndex].burn(msg.sender, amount);

        // Payout: 1:1 if winning, 0 if losing
        uint256 payout = 0;
        if (outcomeIndex == winningOutcome) {
            payout = amount; // each winning share redeems for 1 collateral unit
        }

        if (payout > 0) {
            if (totalEscrowed < payout) revert InsufficientEscrow();
            totalEscrowed -= payout;
            collateral.safeTransfer(msg.sender, payout);
        }

        emit Redeemed(msg.sender, outcomeIndex, payout);
    }

    /// @notice Sell flow: burn wrapped receipt, emit SellIntent, await collateral return.
    ///         (Implementation omitted for brevity; mirrors buy flow in reverse.)
    function sell(uint8 outcomeIndex, uint256 sharesIn, uint256 minCollateralOut)
        external
        returns (uint256 nonce)
    {
        // Lock: burn wrapped receipt, emit SellIntent, await home AMM sell confirmation
        revert("Sell flow deferred to post-MVP");
    }
}

/// @title WrappedOutcomeToken
/// @notice ERC-20 representing outcome tokens held on the home chain.
contract WrappedOutcomeToken is ERC20 {
    address public immutable proxy;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        proxy = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == proxy, "Only proxy can mint");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == proxy, "Only proxy can burn");
        _burn(from, amount);
    }
}
```

### 2.3 Lifecycle states

```
┌─────────┐  buy()  ┌─────────────────┐  confirmFill()  ┌─────────────────┐
│  Idle   │ ───────>│ PendingIntent   │ ──────────────> │ WrappedPosition │
│         │         │ (collateral     │                 │ (receipt minted)│
│         │         │  escrowed)      │                 │                 │
└─────────┘         └─────────────────┘                 └─────────────────┘
                            │                                     │
                            │ confirmRefund()                     │ redeem()
                            ↓                                     ↓ (after resolve)
                    ┌───────────────┐                   ┌───────────────────┐
                    │ Refunded      │                   │ Collateral        │
                    │ (collateral   │                   │ Released          │
                    │  returned)    │                   └───────────────────┘
                    └───────────────┘
```

---

## 3. HomeMarketGateway — home-side receiver

### 3.1 Purpose

The **`HomeMarketGateway`** sits on the **home chain** (e.g. Arc) and:

- Receives BuyIntent / SellIntent messages from remote proxies via `IBridgeAdapter`.
- Executes the trade against the **existing** `MarketAMM` (the same AMM that native home-chain users trade against).
- Holds outcome tokens on behalf of the proxy (custodian role).
- Sends FillConfirmation or RefundNotification back to the originating proxy.

### 3.2 Illustrative Solidity

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MarketAMM.sol";
import "./OutcomeToken.sol";
import "./IBridgeAdapter.sol";

/// @title HomeMarketGateway
/// @notice Receives cross-chain buy/sell intents from MarketProxy instances on
///         remote chains, executes them against the native MarketAMM, and
///         confirms fills back to the originating proxy.
///
///         This is the OffRamp/receiver analog in Chainlink CCIP terms: where
///         CCIP's OffRamp delivers messages to a target contract on the
///         destination chain, HomeMarketGateway receives intents on the home
///         chain and executes them against the unified AMM pool.
contract HomeMarketGateway {
    /// @notice Per-market AMM address (resolved from MarketFactory at deploy or runtime).
    mapping(uint256 => address) public marketAMMs;

    /// @notice OutcomeToken contract (home-chain ERC-1155).
    OutcomeToken public immutable outcomeToken;

    /// @notice Bridge adapter used to send confirmations back to proxies.
    IBridgeAdapter public immutable bridgeAdapter;

    /// @notice Custodian balances: per (remoteChainId, proxyAddress, marketId, outcomeIndex).
    ///         outcome tokens held on behalf of remote proxies.
    mapping(uint256 => mapping(address => mapping(uint256 => mapping(uint8 => uint256))))
        public custodianBalances;

    event IntentReceived(
        uint256 indexed remoteChainId,
        address indexed remoteProxy,
        uint256 indexed nonce,
        uint256 marketId,
        uint8 outcomeIndex,
        uint256 collateralIn
    );
    event IntentExecuted(
        uint256 indexed nonce,
        uint256 sharesOut,
        uint256 actualPrice
    );
    event IntentRefunded(uint256 indexed nonce, string reason);

    error MarketNotRegistered(uint256 marketId);
    error InvalidOutcome();
    error Unauthorized();

    constructor(address _outcomeToken, address _bridgeAdapter) {
        outcomeToken = OutcomeToken(_outcomeToken);
        bridgeAdapter = IBridgeAdapter(_bridgeAdapter);
    }

    /// @notice Register a market AMM (called by admin or factory).
    function registerMarket(uint256 marketId, address amm) external {
        // Access control omitted for brevity (FACTORY_ROLE in production)
        marketAMMs[marketId] = amm;
    }

    /// @notice Callback from bridge adapter when a BuyIntent arrives.
    /// @param remoteChainId  The originating chain (Base, Polygon, etc.).
    /// @param remoteProxy    The MarketProxy that emitted the intent.
    /// @param message        ABI-encoded BuyIntent (nonce, marketId, outcome, collateral, minShares).
    function receiveMessage(
        uint256 remoteChainId,
        address remoteProxy,
        bytes calldata message
    ) external {
        if (msg.sender != address(bridgeAdapter)) revert Unauthorized();

        (
            string memory intentType,
            uint256 nonce,
            uint256 marketId,
            uint8 outcomeIndex,
            uint256 collateralIn,
            uint256 minSharesOut
        ) = abi.decode(message, (string, uint256, uint256, uint8, uint256, uint256));

        require(
            keccak256(bytes(intentType)) == keccak256(bytes("BuyIntent")),
            "Unknown intent type"
        );

        emit IntentReceived(remoteChainId, remoteProxy, nonce, marketId, outcomeIndex, collateralIn);

        address ammAddress = marketAMMs[marketId];
        if (ammAddress == address(0)) {
            _sendRefund(remoteChainId, remoteProxy, nonce, "Market not registered");
            return;
        }

        // Execute buy against the unified AMM
        MarketAMM amm = MarketAMM(ammAddress);

        // NOTE: collateralIn was locked on the remote chain; we are executing
        // a *virtual* buy here — the gateway must hold equivalent collateral
        // staked by the protocol or bridged via CCTP (see doc 04).
        // For this design, assume the gateway has approved collateral to the AMM.

        uint256 sharesOut;
        try amm.buy(outcomeIndex, collateralIn, minSharesOut) returns (uint256 shares) {
            sharesOut = shares;
        } catch {
            _sendRefund(remoteChainId, remoteProxy, nonce, "AMM buy failed");
            return;
        }

        // Hold outcome tokens in custody for the remote proxy
        uint256 tokenId = outcomeToken.encodeId(marketId, outcomeIndex);
        custodianBalances[remoteChainId][remoteProxy][marketId][outcomeIndex] += sharesOut;

        uint256 actualPrice = (collateralIn * 1e6) / sharesOut; // price in collateral per share

        emit IntentExecuted(nonce, sharesOut, actualPrice);

        // Send FillConfirmation back to proxy
        bytes memory confirmation = abi.encode(
            "FillConfirmation",
            nonce,
            sharesOut,
            actualPrice
        );
        bridgeAdapter.sendMessage(remoteChainId, remoteProxy, confirmation);
    }

    function _sendRefund(
        uint256 remoteChainId,
        address remoteProxy,
        uint256 nonce,
        string memory reason
    ) private {
        emit IntentRefunded(nonce, reason);
        bytes memory refundMsg = abi.encode("RefundNotification", nonce);
        bridgeAdapter.sendMessage(remoteChainId, remoteProxy, refundMsg);
    }

    /// @notice After resolution, burn custodian-held tokens and signal proxies.
    ///         (Full resolution propagation covered in doc 05.)
    function propagateResolution(uint256 marketId, uint8 winningOutcome) external {
        // Emit resolution message to all known proxies for this market
        // (proxy registry omitted for brevity)
    }
}
```

---

## 4. End-to-end sequence diagrams

### 4.1 Cross-chain BUY happy path

```
User (Base)       MarketProxy (Base)       BridgeAdapter (CCIP)       HomeGateway (Arc)       MarketAMM (Arc)
    |                   |                           |                          |                      |
    |--buy(YES, 100)-->|                           |                          |                      |
    |                   |--lock 100 USDC in escrow |                          |                      |
    |                   |--record PendingIntent #1 |                          |                      |
    |                   |--sendMessage(BuyIntent)->|                          |                      |
    |                   |                           |--CCIP transport--------->|                      |
    |                   |                           |                          |--receiveMessage----->|
    |                   |                           |                          |                      |--buy(YES,100)
    |                   |                           |                          |                      |    (against unified pool)
    |                   |                           |                          |<--sharesOut=95------|
    |                   |                           |                          |                      |
    |                   |                           |                          |--record custodian    |
    |                   |                           |                          |   balance: 95 YES    |
    |                   |                           |                          |                      |
    |                   |                           |<--sendMessage(FillConf)--|                      |
    |                   |<--CCIP transport----------|                          |                      |
    |<--confirmFill-----|                           |                          |                      |
    |    (nonce=1,      |--mint wYES=95 to user     |                          |                      |
    |     shares=95)    |                           |                          |                      |
    |                   |                           |                          |                      |
```

### 4.2 Bounds-miss refund path

```
User (Base)       MarketProxy (Base)       BridgeAdapter       HomeGateway (Arc)       MarketAMM (Arc)
    |                   |                           |                   |                      |
    |--buy(YES, 100)--->|                           |                   |                      |
    |  minShares=98     |--lock 100 USDC            |                   |                      |
    |                   |--sendMessage(BuyIntent)-->|                   |                      |
    |                   |                           |--transport------->|                      |
    |                   |                           |                   |--buy(YES,100,98)---->|
    |                   |                           |                   |                      |--revert SlippageExceeded
    |                   |                           |                   |<--revert-------------|
    |                   |                           |                   |                      |
    |                   |                           |                   |--_sendRefund-------->|
    |                   |                           |<--RefundNotif-----|                      |
    |<--confirmRefund---|<--transport---------------|                   |                      |
    |                   |--unlock 100 USDC          |                   |                      |
    |                   |--transfer back to user    |                   |                      |
    |                   |                           |                   |                      |
```

### 4.3 Cross-chain SELL and redemption

```
User (Base)       MarketProxy (Base)       BridgeAdapter       HomeGateway (Arc)       MarketAMM (Arc)
    |                   |                           |                   |                      |
    | After resolution: |                           |                   |                      |
    |                   |<--updateMarketState-------|<--ResolutionMsg---|                      |
    |                   |   (Resolved, YES wins)    |                   |                      |
    |                   |                           |                   |                      |
    |--redeem(YES,95)-->|                           |                   |                      |
    |                   |--burn wYES=95             |                   |                      |
    |                   |--payout = 95 * 1 = 95     |                   |                      |
    |<--95 USDC---------|                           |                   |                      |
    |                   |                           |                   |                      |
```

---

## 5. The wrapped position receipt

### 5.1 What it represents

A **wrapped position receipt** (e.g. `wYES`, `wNO`) is an **ERC-20 token** issued by the `MarketProxy` on the remote chain that represents **outcome tokens held in custody on the home chain**. Each wrapped token is backed 1:1 by outcome shares held in `HomeMarketGateway.custodianBalances`.

| Property | Value |
|----------|-------|
| Standard | ERC-20 (simplicity; fungible within outcome) |
| Mint | When `confirmFill()` is called after home AMM executes the buy |
| Burn | On `redeem()` (after resolution) or `sell()` (initiate sell-back to home AMM) |
| Transferable | Yes — users can trade wrapped receipts peer-to-peer on the remote chain |
| Redeemable | After market resolution, 1 wYES (if YES wins) → 1 collateral unit; losing outcome → 0 |

### 5.2 Why ERC-20 instead of mirroring ERC-1155

- **Simpler integration** with remote-chain DeFi (AMMs, lending, wallets all handle ERC-20).
- **Clear semantic:** one token contract per (proxy, outcome) — no token-ID encoding needed on the remote chain.
- **Gas efficiency:** ERC-20 transfers are cheaper than ERC-1155 on many chains.

### 5.3 Safety: "as safe as the weakest link"

A wrapped position is **as safe as min(home chain security, bridge adapter security)**:

- If the **home chain** is compromised (51% attack, contract exploit), the custodian balances on `HomeMarketGateway` can be drained → wrapped receipts lose backing.
- If the **bridge adapter** is compromised (forged messages), an attacker can mint unbacked wrapped receipts or steal escrowed collateral.
- If **both** are secure, the wrapped position is fully backed and redeemable at resolution.

**Mitigation (per whitepaper §5.2 and doc 06):**

- Allowlist only audited, high-reputation bridge adapters (Chainlink CCIP as the reference).
- Per-route exposure caps (e.g. max 1M USDC escrowed per proxy).
- Circuit breaker pausing new intents (never blocking redemptions) on anomaly detection.

---

## 6. Accounting invariants

### 6.1 Collateral conservation

**Home-side invariant:**

```
Σ(custodianBalances across all proxies for market M, outcome O)
  * 1 collateral per share
== collateral staked in HomeGateway for market M, outcome O
```

The home gateway must hold (or have bridged via CCTP — see [doc 04](./04-per-chain-bridge-playbook.md)) sufficient collateral to back every custodian-held outcome token.

**Proxy-side invariant:**

```
totalEscrowed == Σ(pendingIntents[i].collateralLocked)
               + Σ(wrapped receipts outstanding * redemption value after resolution)
```

Every unit of local collateral locked in the proxy is either:

- Pending fill (escrowed in `PendingIntent`), or
- Backing a wrapped receipt (redeemable 1:1 if winning, 0 if losing).

### 6.2 No double-spend across chains

Each intent is assigned a **unique nonce** per proxy. The home gateway processes each nonce exactly once:

- On fill: custodian balance incremented, FillConfirmation sent.
- On refund: RefundNotification sent, proxy releases escrow.

Replay protection:

- Bridge adapters must enforce message uniqueness (CCIP does this via sequence numbers).
- Home gateway rejects duplicate nonces (not shown in illustrative code; production must check).

### 6.3 Idempotency and reorg safety

- **Idempotency:** if a confirmation message is delivered twice (rare but possible with some bridges), the proxy's `confirmFill()` must check `pendingIntents[nonce]` exists and delete it after processing → second call reverts with `IntentNotPending`.
- **Reorg on home chain:** if the home AMM buy is reorged out, the gateway must re-execute or refund. This is a bridge-adapter concern — CCIP's finality guarantees minimize this risk.

---

## 7. Local-first routing (bypass for native users)

**From whitepaper §5.2:**

> If a market's home chain *is* the user's chain, the proxy path is bypassed entirely — native speed, no bridge risk.

### 7.1 Implementation strategy

The **frontend** (Next.js + wagmi) checks:

```typescript
const userChainId = useChainId();
const marketHomeChainId = market.homeChainId;

if (userChainId === marketHomeChainId) {
  // Direct route: call MarketAMM.buy() on the PredictionMarket
  const tx = await marketAMM.buy(outcomeIndex, collateralIn, minSharesOut);
} else {
  // Proxy route: call MarketProxy.buy() on the user's current chain
  const proxyAddress = getMarketProxy(marketHomeChainId, market.id, userChainId);
  const tx = await marketProxy.buy(outcomeIndex, collateralIn, minSharesOut);
}
```

### 7.2 UX benefit

- **Instant finality:** no bridge latency (seconds to minutes) — trade confirms in one block.
- **No bridge trust:** position is a native ERC-1155 OutcomeToken, not a wrapped receipt.
- **Lower cost:** no bridge message fee, no CCTP gas.

This is a **first-class optimization** — not an edge case. On Arc (the strategic home for high-value markets per whitepaper §4.1), all Arc-native users trade at native speed.

---

## 8. Chainlink CCIP architectural inspiration

### 8.1 The explicit parallel

**Chainlink CCIP** separates:

- **Router (source chain):** user-facing entry point; emits cross-chain messages.
- **OnRamp (source chain):** lane-specific sender; queues messages, charges fees, forwards to DON.
- **DON (Decentralized Oracle Network):** transports messages cross-chain with cryptographic attestation.
- **OffRamp (destination chain):** lane-specific receiver; verifies DON signatures, delivers messages to target contract.
- **Risk Management Network (RMN):** independent monitors that can pause lanes on anomaly detection.

**Justify's bridge layer** mirrors this:

| CCIP component | Justify analog |
|----------------|----------------|
| Router | `MarketProxy` (user-facing, emits intents) |
| OnRamp | `IBridgeAdapter.sendMessage()` on source chain (lane abstraction) |
| DON + OffRamp | `IBridgeAdapter` on destination chain + delivery to `HomeMarketGateway` |
| Target contract | `HomeMarketGateway` (receives, executes, confirms) |
| RMN | Circuit breaker in `MarketProxy` / allowlist governance (doc 06) |

### 8.2 Why this matters

1. **Proven architecture:** CCIP secures billions in cross-chain value; adopting its separation of concerns reduces novel surface area.
2. **Adapter seam:** by modeling `IBridgeAdapter` after CCIP's interface, we can plug in CCIP itself as the reference transport (see [doc 02](./02-chainlink-ccip-adapter.md)) or alternative bridges (LayerZero, Wormhole) as adapters.
3. **Forward compatibility:** when Chainlink launches new features (e.g. programmable token transfers, verifiable compute triggers), Justify can adopt them via adapter upgrades without redesigning the proxy/home split.

**Acknowledgment in code:** every bridge-related contract includes a header comment noting the Chainlink CCIP inspiration.

---

## 9. Integration checklist (per remote chain)

To deploy a `MarketProxy` for market M on remote chain R:

1. **Deploy `MarketProxy`** with:
   - `homeChainId` = M's home chain (e.g. Arc = 5042002).
   - `homeMarketId` = M's market ID on the home chain.
   - `collateral` = local USDC address on chain R.
   - `bridgeAdapter` = the deployed `CCIPBridgeAdapter` (or other) on chain R (see [doc 02](./02-chainlink-ccip-adapter.md)).
   - `homeGateway` = the `HomeMarketGateway` address on the home chain.

2. **Register the proxy** in `HomeMarketGateway.proxyRegistry` (not shown in illustrative code; production must track which proxies exist for each market).

3. **Fund the bridge adapter** with native gas tokens (e.g. ETH on Base) for CCIP message fees.

4. **Seed collateral** in `HomeMarketGateway` (or rely on CCTP to transfer USDC per intent — see [doc 04](./04-per-chain-bridge-playbook.md)).

5. **Allowlist the route** in protocol governance (chain R ↔ home chain for market M).

---

## 10. Open design questions and future work

| Question | Status | Notes |
|----------|--------|-------|
| **Sell flow** | Deferred | Sell = burn wrapped receipt, emit SellIntent, home AMM sells, gateway returns collateral. Mirrors buy; omitted for MVP (whitepaper §15 item 4). |
| **CCTP integration** | Planned (doc 04) | Use Circle CCTP to bridge USDC legs instead of staking collateral in HomeGateway. Reduces capital lock. |
| **Proxy upgrade** | Designed | Proxies are non-upgradeable (no storage corruption risk); new market versions deploy fresh proxies. Old proxies remain live until their markets resolve. |
| **Gas strategy** | Research | Who pays for the home-side `amm.buy()` gas? Options: (1) pre-paid by protocol, (2) embedded in bridge fee, (3) user-pays via CCIP programmable token transfers. |
| **Partial fills** | Future | Current design: all-or-nothing fill within slippage bounds. Future: accept partial fill, refund remainder (requires two-phase commit on home gateway). |

---

## 11. Cross-references

- **[doc 01: IBridgeAdapter interface](./01-bridge-adapter-interface.md)** — the transport seam this design consumes.
- **[doc 02: Chainlink CCIP adapter](./02-chainlink-ccip-adapter.md)** — the reference implementation of `IBridgeAdapter`.
- **[doc 04: Per-chain bridge playbook](./04-per-chain-bridge-playbook.md)** — how to configure lanes, CCTP for USDC, gas funding.
- **[doc 05: Cross-chain resolution](./05-cross-chain-resolution.md)** — settlement propagation from home to all proxies.
- **[Whitepaper §5](../documentation_justify_whitepaper/justify-whitepaper.md)** — the product-level view this design implements.
- **[contracts/src/MarketAMM.sol](../contracts/src/MarketAMM.sol)** — the unified AMM pool the home gateway executes against.

---

**END OF DOCUMENT**

This design ensures that Justify markets achieve **unified liquidity** (one pool, one price) and **single source of truth** (one home-chain state) across all supported blockchains, while preserving **local-first speed** for native users and **explicit acknowledgment** of the Chainlink CCIP architectural inspiration that makes the bridge layer robust and forward-compatible.
