# Per-Chain Bridge Playbook — operational guide to lanes, selectors, collateral, and USDC legs

**Bridge layer operational how-to for Justify.** This document describes:
1. How to stand up a bridge on each target chain
2. Per-chain infrastructure facts (CCIP selectors, USDC addresses, lane availability)
3. Route/lane configuration model
4. USDC value transfer via Circle CCTP
5. Environment variable catalog (additive, mirrors arc-layer-plan.md)

**Chainlink CCIP foundation.** This playbook is built around **Chainlink CCIP** as the reference cross-chain transport, and the route/lane model is **inspired by Chainlink CCIP lanes**.

## 1. Add a Chain — operational checklist

Standing up bridge support on a new chain extends whitepaper §4.2 ("deploy + register artifact + fund treasury") with bridge-specific steps. The choice is binary: deploy the full home stack OR deploy a MarketProxy.

### 1.1 Home chain deployment

If the chain will **host home markets** (hold collateral pools, run AMM pricing, and settle):

```
[ ] 1. Deploy the full Justify contract stack
       - MarketFactory, PredictionMarket, MarketAMM, OutcomeToken,
         OracleResolver, FeeTreasury, AccessControl
       - See arc-layer-plan.md for the config-and-redeploy model

[ ] 2. Inject collateral token address
       - MarketFactory constructor takes _collateral as a parameter
       - Use canonical USDC where available (see §2 matrix)
       - Fallback: deploy MockUSDC for testing

[ ] 3. Deploy IBridgeAdapter (from 02-chainlink-ccip-adapter.md)
       - ChainlinkCCIPAdapter(ccipRouterAddress, linkTokenAddress)
       - Verify CCIP router address from Chainlink docs per chain

[ ] 4. Register deployment artifact
       - Generate contracts/deployments/{chain}.json with chainId,
         contract addresses, ABIs
       - Backend serves this at runtime (no rebuild per deploy)

[ ] 5. Fund fee accounts
       - FeeTreasury: seed with collateral for operational reserve
       - CCIP adapter: fund with LINK for cross-chain message fees
       - Deployer account: acquire gas token + collateral from faucet/bridge

[ ] 6. Configure access control
       - Grant FACTORY_ROLE to MarketFactory
       - Grant RESOLVER_ROLE to OracleResolver (or CRE service account)
       - Grant TREASURY_ROLE to fee-withdrawal operator
```

### 1.2 Remote/proxy chain deployment

If the chain will **proxy to a home chain elsewhere** (forward orders via bridge):

```
[ ] 1. Deploy MarketProxy contract (from 03-marketproxy-and-home-market.md)
       - MarketProxy(homeChainId, homeMarketAddress, localCollateralToken,
         bridgeAdapter)
       - homeChainId and homeMarketAddress point to the actual AMM

[ ] 2. Deploy IBridgeAdapter for this route
       - Same ChainlinkCCIPAdapter as home side
       - CCIP router address for *this* chain (source side)

[ ] 3. Configure the lane route (source → home)
       - Set CCIP chain selector for destination (home chain)
       - Allowlist the route in MarketProxy (owner-only call)
       - Per-route exposure cap (max collateral locked awaiting confirmation)

[ ] 4. Fund LINK for outbound CCIP messages
       - MarketProxy pays CCIP fees on every Buy/Sell bridged intent
       - Monitor LINK balance; replenish via keeper or manual top-up

[ ] 5. Configure collateral token
       - If USDC and both chains support CCTP: flag for burn-and-mint
         (see §4)
       - Otherwise: CCIP token pool or lock-and-mint

[ ] 6. Register the proxy in the artifact registry
       - Backend indexes MarketProxy events (IntentSent, FillConfirmed)
       - UI shows "bridged" badge and estimated fill time

[ ] 7. Test the round trip
       - Place a small Buy on the proxy, confirm fill from home AMM
       - Verify wrapped receipt minted on proxy chain
       - Redeem after home market resolves
```

### 1.3 Allowlist and exposure limits

Every (sourceChain → homeChain) lane must be **explicitly allowlisted** by the MarketProxy owner. This prevents griefing via unsupported routes.

```solidity
// MarketProxy owner call
function allowlistRoute(
    uint256 homeChainId,
    uint64 ccipChainSelector,
    uint256 maxExposure
) external onlyOwner;
```

- `homeChainId`: EVM chain ID of the home market's chain
- `ccipChainSelector`: Chainlink CCIP selector for the home chain (distinct from chain ID; see §2)
- `maxExposure`: max collateral locked in pending fills; excess orders revert

## 2. Per-Chain Infrastructure Facts

One row per target network. **Note on CCIP selectors:** these are **distinct from EVM chain IDs** and are assigned by Chainlink. Where values are uncertain, we mark "confirm on Chainlink registry" rather than inventing data.

| Network | Chain ID | CCIP Chain Selector | Canonical USDC | CCTP Support | CCIP Lane Availability |
|---------|----------|---------------------|----------------|--------------|------------------------|
| **Arc Testnet** (Circle) | 5042002 | confirm on Chainlink docs | Circle USDC (native 18-dec gas token; confirm ERC-20 address) | Unknown (Arc is new; confirm with Circle) | Confirm via Chainlink lane explorer |
| **Base** | 8453 | confirm on Chainlink docs (Base is a known CCIP chain) | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals) | **Yes** — Base is a native USDC chain | Supported (Base ↔ Ethereum, Base ↔ Polygon lanes confirmed) |
| **Ethereum** | 1 | confirm on Chainlink docs (Ethereum mainnet is a known CCIP chain) | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (6 decimals) | **Yes** — Ethereum is the CCTP hub | Supported (Ethereum is the CCIP hub) |
| **Polygon PoS** | 137 | confirm on Chainlink docs (Polygon is a known CCIP chain) | 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 (6 decimals, native USDC; old bridged USDC.e deprecated) | **Yes** — Polygon native USDC since 2023 | Supported (Polygon ↔ Ethereum, Polygon ↔ Base lanes confirmed) |
| **BNB Smart Chain** | 56 | confirm on Chainlink docs (BSC is a known CCIP chain) | confirm canonical USDC or USDT address (BSC ecosystem uses both) | Confirm (CCTP primarily Ethereum/Base/Polygon/Arbitrum as of 2025) | Confirm via Chainlink lane explorer |

**Action for implementer:** Before deploying to a chain, confirm these values from:
- [Chainlink CCIP supported networks](https://docs.chain.link/ccip/supported-networks) — chain selectors, router addresses
- [Circle CCTP supported domains](https://developers.circle.com/stablecoins/docs/supported-domains) — USDC addresses, CCTP availability
- Chain explorer (Etherscan, Basescan, Polygonscan, etc.) — verify token contract addresses

### 2.1 Why CCIP chain selectors are distinct from chain IDs

Chainlink CCIP assigns a unique `uint64` selector to each supported network. This selector is used in CCIP router calls and lane configuration, and is **not the same as the EVM chain ID**. Example (hypothetical, confirm from Chainlink):

- Ethereum mainnet: chain ID `1`, CCIP selector might be `1` or another assigned value
- Base: chain ID `8453`, CCIP selector assigned by Chainlink
- Polygon: chain ID `137`, CCIP selector assigned by Chainlink

The selector is the routing key within CCIP's off-chain network; the chain ID is the on-chain identifier. Both must be configured correctly.

## 3. Route and Lane Configuration

A **route** is a (sourceChain → homeChain) pair. A **lane** is Chainlink CCIP's term for a supported source→destination path. Justify routes map onto CCIP lanes.

### 3.1 Routing table model

The backend maintains a routing table (Postgres or served artifact):

```json
{
  "routes": [
    {
      "sourceChain": { "id": 8453, "name": "Base" },
      "homeChain": { "id": 5042002, "name": "Arc" },
      "ccipSelector": "confirm_arc_selector",
      "adapterAddress": "0x...",
      "maxExposure": "10000000000",
      "status": "active"
    },
    {
      "sourceChain": { "id": 137, "name": "Polygon" },
      "homeChain": { "id": 1, "name": "Ethereum" },
      "ccipSelector": "confirm_eth_selector",
      "adapterAddress": "0x...",
      "maxExposure": "50000000000",
      "status": "active"
    }
  ]
}
```

- Each route has its own CCIP adapter instance (or shares one if the adapter is stateless per lane).
- The frontend reads this table to show users "This market is on Arc; you can trade from Base via bridge (estimated 2-5 min fill)".

### 3.2 Market home assignment

Every PredictionMarket is created on exactly one home chain. The MarketFactory emits:

```solidity
event MarketCreated(
    uint256 indexed marketId,
    address marketAddress,
    uint256 homeChainId,
    ...
);
```

The backend indexes `homeChainId` so it can route proxy orders to the correct home AMM.

### 3.3 Per-route adapter selection

Different routes may use different bridge transports:

- **Arc ↔ Base, Base ↔ Ethereum, Polygon ↔ Ethereum:** Chainlink CCIP adapter (fast, decentralized, LINK-fee)
- **Testnet routes:** could use a mock adapter for integration tests
- **Future:** LayerZero adapter, native bridge adapter, or custom relay

The `IBridgeAdapter` interface (from 02-chainlink-ccip-adapter.md) abstracts this. MarketProxy calls `adapter.sendIntent()` and doesn't care about the underlying transport.

## 4. USDC Value Legs via Circle CCTP

When the bridged collateral is **USDC** and both source and home chains support **Circle CCTP** (Cross-Chain Transfer Protocol), use CCTP for the **value leg** (the actual USDC transfer) while CCIP carries the **intent message** (Buy/Sell order metadata).

### 4.1 CCTP burn-and-mint model

Circle CCTP is a native USDC bridge:

1. **On source chain:** user's USDC is **burned** (not locked) via Circle's TokenMessenger contract.
2. **Off-chain:** Circle's attestation service observes the burn and signs an attestation.
3. **On home chain:** the attestation is submitted to Circle's MessageTransmitter, which **mints** native USDC on the destination.

Result: the USDC that arrives on the home chain is **native USDC**, not a wrapped/bridged token. No liquidity pool needed, no bridge TVL risk (beyond Circle custody), and no divergence from $1 peg.

### 4.2 CCIP + CCTP dual-leg flow

```
┌───────────── Source Chain (e.g. Base) ─────────────┐
│ 1. User calls MarketProxy.buyYes(amount)           │
│ 2. Proxy locks user's USDC                         │
│ 3. Proxy burns USDC via CCTP TokenMessenger        │
│    (Circle attestation starts)                     │
│ 4. Proxy sends intent message via CCIP adapter     │
│    → { marketId, buyer, outcome, amount, nonce }   │
└─────────────────────────────────────────────────────┘
                          ↓ CCIP message (seconds)
                          ↓ CCTP attestation (seconds)
┌───────────── Home Chain (e.g. Arc) ────────────────┐
│ 5. CCIP adapter receives intent, emits event       │
│ 6. Keeper (or user) submits CCTP attestation       │
│    → Circle MessageTransmitter mints USDC on Arc   │
│ 7. Home MarketAMM executes Buy against pool        │
│ 8. Outcome tokens minted, fill confirmed           │
│ 9. Confirmation sent back via CCIP (optional)      │
└─────────────────────────────────────────────────────┘
```

**Key coordination:** the home-side keeper must wait for **both** the CCIP intent message AND the CCTP attestation before calling `MarketAMM.buy()`. If CCIP arrives first (likely), the intent is queued; when CCTP USDC mints, the fill executes.

### 4.3 CCTP vs CCIP token pools

Chainlink CCIP also supports token transfers via **CCIP token pools** (lock-and-mint or burn-and-mint administered by Chainlink). For USDC:

- **Use CCTP when available** — it's Circle's native bridge, cheaper fee (no LINK fee for USDC leg), and settles in native USDC.
- **Use CCIP token pool as fallback** — if one chain doesn't support CCTP, or for non-USDC collateral (e.g. DAI, USDT).

The `IBridgeAdapter` implementation chooses which path:

```solidity
function sendIntent(
    IntentMessage memory intent,
    address collateralToken,
    uint256 amount
) external payable returns (bytes32 messageId) {
    if (collateralToken == USDC && cctpSupported(destChain)) {
        _burnViaUSDC(amount);           // Circle CCTP burn
        _sendIntentMessage(intent);      // CCIP message-only
    } else {
        _sendIntentWithTokens(intent, collateralToken, amount); // CCIP token pool
    }
}
```

### 4.4 Native-USDC chains

Per the whitepaper §4.1 and the matrix above:

- **Arc, Base, Ethereum, Polygon:** native Circle USDC, CCTP-capable (confirm Arc with Circle).
- **BSC:** USDC exists but CCTP support is TBD; may need CCIP token pool or BSC-specific bridge.

## 5. Bridge Layer Environment Variables

Additive to the base stack (from arc-layer-plan.md). Per chain, per route.

### 5.1 Home chain env (where markets live)

```bash
# Existing (from arc-layer-plan.md)
NEXT_PUBLIC_CHAIN_ID=5042002
NEXT_PUBLIC_RPC_URL=https://rpc.testnet.arc.network
RPC_URL=https://rpc.testnet.arc.network
COLLATERAL_USDC_ADDRESS=0x...            # Circle USDC on Arc

# Bridge additions for home chain
CCIP_ROUTER_ADDRESS=0x...                # Chainlink CCIP Router on Arc (from Chainlink docs)
CCIP_CHAIN_SELECTOR=<arc_selector>       # Arc's CCIP selector (from Chainlink)
LINK_TOKEN_ADDRESS=0x...                 # LINK token on Arc (for CCIP fees)
CCTP_TOKEN_MESSENGER=0x...               # Circle TokenMessenger on Arc (if CCTP supported)
CCTP_MESSAGE_TRANSMITTER=0x...           # Circle MessageTransmitter on Arc
HOME_CHAIN_ID=5042002                    # Redundant with CHAIN_ID but explicit for clarity
```

### 5.2 Remote/proxy chain env (e.g. Base → Arc route)

```bash
# Base chain identity
PROXY_CHAIN_ID=8453
PROXY_RPC_URL=https://mainnet.base.org
PROXY_COLLATERAL_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Bridge adapter on Base
PROXY_CCIP_ROUTER_ADDRESS=0x...          # CCIP Router on Base
PROXY_CCIP_CHAIN_SELECTOR=<base_selector>
PROXY_LINK_TOKEN_ADDRESS=0x...
PROXY_CCTP_TOKEN_MESSENGER=0x...         # Base CCTP messenger

# Target home chain
HOME_CHAIN_ID=5042002                    # Arc
HOME_CCIP_CHAIN_SELECTOR=<arc_selector>  # Arc's CCIP selector
HOME_MARKET_FACTORY_ADDRESS=0x...        # MarketFactory on Arc (from deployments/arc.json)

# Bridge adapter deployment on Base
BRIDGE_ADAPTER_ADDRESS=0x...             # ChainlinkCCIPAdapter on Base
MARKET_PROXY_ADDRESS=0x...               # MarketProxy on Base

# Route config
MAX_ROUTE_EXPOSURE=10000000000           # 10,000 USDC (6 decimals) max pending per route
CCIP_ESTIMATED_FILL_SECONDS=120          # 2 min typical; surface in UI
```

### 5.3 Multi-route env pattern

For N remote chains, the backend can namespace env vars:

```bash
BRIDGE_ROUTE_BASE_TO_ARC_ADAPTER=0x...
BRIDGE_ROUTE_BASE_TO_ARC_MAX_EXPOSURE=10000000000
BRIDGE_ROUTE_POLYGON_TO_ETH_ADAPTER=0x...
BRIDGE_ROUTE_POLYGON_TO_ETH_MAX_EXPOSURE=50000000000
...
```

Or load from a JSON config served at runtime (preferred for >3 routes).

## 6. Chainlink CCIP as Reference Transport

This playbook assumes **Chainlink CCIP** because:

1. **Mature, production-grade cross-chain messaging** (live on Ethereum, Base, Polygon, Arbitrum, Optimism, Avalanche, BNB, and more).
2. **Decentralized oracle network (DON)** for message relay + independent **Risk Management Network** for anomaly detection — mirrors Justify's security goals.
3. **Lane model** — Chainlink explicitly supports source→destination lanes with known latencies and fee structures; Justify routes map cleanly onto lanes.
4. **Token transfer support** — both arbitrary messages (for our intent) and token pools (fallback if CCTP unavailable).
5. **Audited and battle-tested** — Chainlink's security posture reduces bridge risk vs custom relays.

### 6.1 Chainlink CCIP lane terminology

- **OnRamp (source chain):** contract that accepts outgoing CCIP messages and tokens; emits CCIPSendRequested.
- **OffRamp (destination chain):** contract that delivers incoming messages; emits ExecutionStateChanged.
- **Router:** entry point on each chain; routes to the correct OnRamp/OffRamp per lane.
- **DON (Decentralized Oracle Network):** off-chain nodes that observe OnRamp, reach consensus, and call OffRamp on destination.
- **RMN (Risk Management Network):** independent blessing/cursing network that can halt a lane if anomaly detected.

Justify's `IBridgeAdapter` is a thin wrapper around the Router; `MarketProxy.sendIntent()` calls `adapter.sendMessage()` which calls `CCIPRouter.ccipSend()`.

### 6.2 Mapping Justify concepts to CCIP

| Justify term | CCIP equivalent |
|--------------|-----------------|
| Route (sourceChain → homeChain) | Lane (source → destination chain) |
| `IBridgeAdapter.sendIntent()` | `CCIPRouter.ccipSend()` on source |
| `IBridgeAdapter.receiveIntent()` | `CCIPReceiver._ccipReceive()` on destination |
| IntentMessage (marketId, buyer, outcome, amount, nonce) | CCIP `Client.EVM2AnyMessage` with data payload |
| LINK fee | CCIP message fee (paid in LINK or native token) |
| Wrapped receipt (ERC-20 on proxy chain) | Not a CCIP primitive; Justify-specific |
| Home-market fill confirmation | CCIP return message (optional; or event indexing) |

## 7. Operational Runbook Summary

### 7.1 Deploying a new home chain (e.g. Arc)

```
1. Confirm Arc's CCIP support (Chainlink docs) → get chain selector
2. Confirm Circle USDC address on Arc (or deploy MockUSDC fallback)
3. Deploy full Justify stack with COLLATERAL_USDC_ADDRESS set
4. Deploy ChainlinkCCIPAdapter(arcCCIPRouter, arcLINK)
5. Fund deployer with Arc gas USDC from faucet.circle.com
6. Fund FeeTreasury with seed USDC
7. Fund CCIP adapter with LINK for inbound message execution (if needed)
8. Register contracts/deployments/arc.json
9. Seed one market, test local Buy → confirm AMM pricing works
```

### 7.2 Adding a proxy chain route (e.g. Base → Arc)

```
1. Confirm Base CCIP support → get Base's CCIP selector
2. Confirm Base→Arc lane exists in Chainlink lane explorer
3. Deploy ChainlinkCCIPAdapter on Base (points to Base CCIP router)
4. Deploy MarketProxy on Base:
   - homeChainId = 5042002 (Arc)
   - homeMarketAddress = Arc's MarketFactory or specific market
   - collateralToken = Base USDC (0x833...)
   - bridgeAdapter = Base CCIP adapter address
5. Call MarketProxy.allowlistRoute(5042002, arcCCIPSelector, maxExposure)
6. Fund Base CCIP adapter with LINK (for outbound CCIP fees)
7. If CCTP: confirm Base & Arc CCTP support, set CCTP addresses in adapter
8. Register Base deployment artifact
9. Test: place Buy on Base proxy → observe CCIP message → confirm fill on Arc → verify wrapped receipt minted on Base
10. Monitor LINK balance on Base adapter; set up auto-refill keeper
```

### 7.3 Circuit breaker / pausing a route

If anomaly detected (e.g. CCIP lane halted, CCTP attestation delay, home AMM drained):

```solidity
// MarketProxy owner call
function pauseRoute(uint256 homeChainId) external onlyOwner;
```

Paused route:
- **Blocks new intents** (Buy/Sell calls revert)
- **Never blocks redemptions** (users can always redeem wrapped receipts after home market resolves)
- Unpauses after incident resolved and exposure cap restored

Mirrors Chainlink RMN's "curse" mechanism (see 06-security-and-risk-management.md).

## 8. Forward Links

- **02-chainlink-ccip-adapter.md** — the adapter implementation this playbook assumes
- **05-cross-chain-resolution.md** — how settlement propagates from home to all proxies
- **arc-layer-plan.md** — the "chain is config" foundation for per-chain deployment
- **Chainlink CCIP docs** — [docs.chain.link/ccip](https://docs.chain.link/ccip) — chain selectors, router addresses, fee calculator, lane explorer

---

**Operational honesty:** Where CCIP selectors, USDC addresses, or CCTP support are marked "confirm", the implementer MUST verify from authoritative sources (Chainlink docs, Circle docs, chain explorers) before deploying. This playbook provides the structure, not the constantly-changing on-chain addresses.
