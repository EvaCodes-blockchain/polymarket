# ARC Layer — migration spec (ARC track, $3,250 core + foundation for all tracks)

Spec for the ARC operator (strongest/fastest — this is the **critical path**).
Written from the actual code on branch `mvp`.

**Thesis.** The code is already env-driven (RPC/chainId/addresses from env, the
collateral token is a constructor arg). Moving off Ganache onto Arc testnet is
**config + redeploy**, NOT a rewrite. This branch swaps the substrate that CRE
and ENS build on, so it merges FIRST and unblocks everyone.

---

## Settle the team argument first (collateral token)

There are **two different USDC** on Arc — do not conflate:

| | What | Where it comes from | Do we "make" it? |
|---|------|---------------------|------------------|
| **Gas USDC** | Arc's native currency (like ETH elsewhere); pays for tx | `faucet.circle.com` | **No** — take Circle's |
| **Collateral USDC** | the ERC-20 bets are denominated in (replaces MockUSDC) | see decision below | see below |

**Decision (locked):** for collateral, use **real Circle testnet USDC**, not our
own MockUSDC — it satisfies the ARC prize's "USDC collateral" requirement far
better. **Pragmatic fallback:** if the Circle USDC ERC-20 address/decimals on Arc
aren't confirmed in time, deploy our MockUSDC on Arc to get the flow live, then
switch the address. Both work because **collateral is a deploy-time parameter**
(see next section) — switching is one address.

> So "сделать свой токен USDC" is the fallback (MockUSDC), not the plan. The plan
> is to point the factory at Circle's USDC address.

---

## The key fact that makes this easy

`MarketFactory`'s constructor takes the collateral token **as an argument**
(contracts/src/MarketFactory.sol):
```solidity
constructor(address _acl, address _outcomeToken, address _collateral, address _feeTreasury)
//                                                ^^^^^^^^^^^^^^^^^^^ injected at deploy time
```
And `deploy.ts` currently does:
```
deploy MockUSDC → usdcAddress → pass usdcAddress as _collateral to MarketFactory
```
**To use Circle USDC: skip deploying MockUSDC, pass the Circle USDC address as
`_collateral`.** No contract change. That's the whole collateral swap.

⚠️ Consequence: with external USDC we **cannot mint it** — `mintUsdcTo()`
(chain.ts) and the seed flow (deployer mints USDC to seed AMMs) break. The
deployer/traders must be **funded from faucet.circle.com** instead, and seed
amounts must shrink to what the faucet gives (not 6000/4000 — use small amounts).

---

## What changes, by file owner (CLAUDE.md ownership)

### contracts (`contracts/**`)
- `hardhat.config.ts` — add an `arc` network: `url: process.env.RPC_URL`,
  `chainId: 5042002`, accounts from mnemonic. (RPC is already env-driven.)
- `scripts/deploy.ts` — make collateral source switchable:
  - if `COLLATERAL_USDC_ADDRESS` env set → use it as `_collateral`, skip MockUSDC deploy;
  - else → deploy MockUSDC as today (local/fallback).
  - Replace `usdc.mint(...)` trader funding + AMM seeding with: assume the
    accounts are pre-funded (real USDC), seed with small amounts. Guard mint
    calls behind "is this our MockUSDC?".
- Regenerate the artifact for Arc (same shape; new addresses + `chainId:5042002`).

### backend (`web/src/lib/server/**`)
- `chain.ts:91-100` — chain id + nativeCurrency from env (RPC already env):
  `id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1337)`, nativeCurrency
  **USDC (18 decimals)** for Arc. Keep Ganache defaults as fallback.
- `chain.ts:128` `USDC_DECIMALS` — confirm Circle USDC decimals (likely 6) and
  keep correct; this is the **collateral** token's decimals, independent of the
  18-decimal gas token.
- Gate `mintUsdcTo()` / faucet route so it no-ops (or returns a faucet link) when
  collateral isn't our mintable MockUSDC.

### frontend (`web/src/lib/client/**`)
- `wagmi.ts` — `defineChain` from env: id `5042002`, RPC
  `https://rpc.testnet.arc.network`, **nativeCurrency USDC (18 dec)**,
  `addEthereumChain` so MetaMask offers to add Arc in one click. Drop the
  hard-coded `1337`/`localhost`.
- `useWallet.ts:18` `GANACHE_CHAIN_ID` and `useBuyMarket.ts` "switch to 1337"
  prompts — read `NEXT_PUBLIC_CHAIN_ID`, relabel "Arc testnet".
- **Close BUG-002 here:** load contract addresses at **runtime** (fetch from a
  server endpoint / the artifact) instead of baking them into the bundle.
  Otherwise every redeploy needs a rebuild (issue #42, DeployRunbook §2.5).

### devops (`docker-compose.yaml`, `.env.example`, `deploy-dev.yml`)
- New/changed env (additive): `NEXT_PUBLIC_CHAIN_ID=5042002`,
  `NEXT_PUBLIC_RPC_URL=https://rpc.testnet.arc.network`,
  `RPC_URL=https://rpc.testnet.arc.network`, `COLLATERAL_USDC_ADDRESS=<circle usdc>`.
- The local Ganache compose stays as the **local dev profile** (still ideal for
  contract unit tests). Arc is selected by env, not by ripping out Ganache.

---

## Arc testnet facts (confirmed via chainid.network registry)

| Param | Value |
|-------|-------|
| Network | Arc Network Testnet (Circle) |
| Chain ID | **5042002** (`0x4ce4b2`) |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com/` (public) |
| Gas token | **USDC** (native, 18 decimals) |

(Other registry "Arc" chains with native `ARC` are NOT Circle Arc — ignore.)

---

## Open items — confirm by hand BEFORE coding (≈15 min, no code)
- [ ] `faucet.circle.com` gives gas-USDC to the deployer address on Arc testnet.
- [ ] **Collateral USDC ERC-20 address + decimals** on Arc (from Arcscan / Circle
      docs). ← blocks the "real USDC" path; until then use MockUSDC fallback.
- [ ] `https://rpc.testnet.arc.network` answers `eth_chainId` → `0x4ce4b2`.
- [ ] Whether Circle issues a faucet-able **ERC-20** USDC on Arc (vs only gas).

---

## Definition of done
- [ ] Contracts deployed on Arc (chain 5042002); artifact regenerated.
- [ ] One real **Buy** through MetaMask on Arc → tx visible in Arcscan
      (approve + buy). Closes "Functional MVP + live URL + tx IDs" for ARC.
- [ ] Browser shows live markets/prices on Arc (server reads addresses from the
      live artifact; BUG-002 closed so the bundle isn't stale).
- [ ] Same stack still runs on Ganache 1337 via env (dev profile intact).

## Merge order (why this is first)
ARC merges **first** — it changes the shared substrate (env, artifact, chain).
CRE and ENS rebase onto the new `mvp` after. Until ARC lands, CRE/ENS develop
against Ganache and re-point env at the end.

## What you must NOT do
- Don't rewrite `chain.ts` in another language — keep it TS, just env-ify it.
- Don't delete the Ganache compose stack — it's the local dev/test profile.
- Don't touch `cre/**` or ENS files — other owners.

> Refs: `contracts/scripts/deploy.ts`, `contracts/src/MarketFactory.sol`,
> `web/src/lib/server/chain.ts`, `web/src/lib/client/wagmi.ts`, `BUGS.md`
> (BUG-002), `DeployRunbook.md` §2.3/§2.5, `docs/delivery/hackathon-prize-plan.md`.
