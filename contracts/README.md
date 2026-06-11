# contracts — PolyMarket Social Smart Contracts

Hardhat workspace (Solidity 0.8.24, OpenZeppelin v5, EVM target: Cancun).

## Structure

```
src/                  # Solidity sources
  AccessControl.sol   # JustifyAccessControl — role registry
  MockUSDC.sol        # 6-decimal ERC-20 test collateral
  OutcomeToken.sol    # ERC-1155 YES/NO shares (MINTER_ROLE per AMM)
  MarketFactory.sol   # Registry + deployer of (PredictionMarket, MarketAMM) pairs
  PredictionMarket.sol# Per-market state machine (Open → Closed → Resolved)
  MarketAMM.sol       # CPMM buy flow, 2% fee to FeeTreasury
  OracleResolver.sol  # Manual resolution (deployed-not-exercised in MVP buy flow)
  FeeTreasury.sol     # Fee collection (deployed-not-exercised in MVP buy flow)
scripts/
  deploy.ts           # Deterministic deploy + seed script → deployments/ganache.json
test/
  BuyFlow.test.ts     # 28 unit tests covering the CEO-4 buy flow end-to-end
deployments/
  ganache.json        # Frozen integration artifact (see note below)
```

## Commands

```bash
pnpm build            # Compile Solidity (hardhat compile)
pnpm test             # Run unit tests (28 tests)
pnpm typecheck        # Compile + tsc --noEmit
pnpm lint             # solhint src/**/*.sol
pnpm deploy:ganache   # Deploy to local Ganache + write deployments/ganache.json
```

## Integration artifact: `deployments/ganache.json`

> **Note for devops (task #11):** The `ganache.json` committed to this branch was generated
> against the Hardhat in-process network (used for smoke-testing the deploy script).
> The **canonical artifact** must be generated against the `compose-ganache` service with the
> project mnemonic (`justify social prediction market mvp test test test test test test junk`).
> Devops should run `pnpm -F contracts deploy:ganache` inside the one-shot deploy container
> after Ganache is healthy, and commit the resulting file. The addresses will differ from the
> example artifact but the schema is identical.

Schema:
```json
{
  "chainId": 1337,
  "deployedAt": "<ISO timestamp>",
  "contracts": {
    "JustifyAccessControl": { "address": "0x...", "abi": [...] },
    "MockUSDC":             { "address": "0x...", "abi": [...] },
    "OutcomeToken":         { "address": "0x...", "abi": [...] },
    "FeeTreasury":          { "address": "0x...", "abi": [...] },
    "OracleResolver":       { "address": "0x...", "abi": [...] },
    "MarketFactory":        { "address": "0x...", "abi": [...] }
  },
  "seededMarket": {
    "marketId": 0,
    "question": "Will Barcelona win El Clásico?",
    "outcomeLabels": ["Barcelona", "Real Madrid"],
    "contracts": {
      "PredictionMarket": { "address": "0x...", "abi": [...] },
      "MarketAMM":        { "address": "0x...", "abi": [...] }
    }
  },
  "accounts": {
    "deployer":       "0x...",
    "oracleResolver": "0x...",
    "traders":        ["0x...", "0x...", "0x...", "0x..."],
    "creator":        "0x..."
  }
}
```

## Account mapping (Ganache mnemonic)

| Index | Role |
|-------|------|
| 0 | deployer / admin |
| 1 | oracle resolver |
| 2–5 | traders (pre-funded with 10 000 USDC each) |
| 6 | market creator |

## Buy flow entry points

```typescript
// 1. Approve collateral
await MockUSDC.approve(ammAddress, collateralAmount);

// 2. Buy outcome shares (outcomeIndex: 0 = YES, 1 = NO)
await MarketAMM.buy(outcomeIndex, collateralAmount, minSharesOut);

// 3. Check position — standard ERC-1155
const tokenId = await OutcomeToken.encodeId(marketId, outcomeIndex);
const shares = await OutcomeToken.balanceOf(traderAddress, tokenId);
```
