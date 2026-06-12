# Hackathon Prize Plan — anchoring max prize mass on existing code

Working plan for the hackathon. The thesis: **our existing code is already a
working prediction-markets stack** (MarketFactory + MarketAMM + Buy flow +
news-driven generator + OracleResolver). That stack directly anchors the
"markets" prize cluster with little new work. The deposit/wallet prizes are a
**new surface + external approvals** — they must NOT sit on the critical path.

Prize source: `prize.pdf` (repo root). Network params confirmed via
chainid.network registry (see "Arc testnet facts" below).

---

## Clusters, ranked by "how much already exists"

| Prize | $ | What we already have | Remaining work |
|-------|---|----------------------|----------------|
| **ARC — Best Prediction Markets** | 3,250 | contracts + AMM + Buy + UI — **all of it** | redeploy on Arc + USDC; env-swap (code already env-driven) |
| **CHAINLINK — CRE resolve** | 6,000 | `OracleResolver.resolve()` is done | external CRE workflow: price fetch → `resolve()` |
| **WORLD — World ID gate** | 2,500 | `POST /api/markets` is done | proof validation + nullifier-dedup on the backend |
| **ENS — subdomains + reputation** | 6,000 (+5,000 Creative) | user/profile model maps 1:1 | ensjs/viem on mainnet, text records |
| **DYNAMIC / BLINK / ARC-abstracted** | 4,000 + 3,000 + 3,250 | — almost nothing | new `/deposit` + embedded wallet + external approvals |

**Takeaway.** The first three (~$11,750) ride on code already written. ENS is
high return for moderate new work. The deposit cluster is the richest but the
riskiest (Flow needs a book-a-call; Blink real deposit is `merchantId`-pending)
→ keep it **last / on a separate owner; never let it block the sure things.**

---

## Sequence (optimised for speed)

### Step 1 — CRITICAL PATH: move the core onto Arc
- env-swap (chain `1337` → `5042002`) + redeploy our contracts with Circle USDC
  as collateral + one real MetaMask Buy visible in Arcscan.
- Close **BUG-002** (address drift) at the same time by loading contract
  addresses at runtime instead of baking them into the browser bundle.
- **Why first:** banks the ARC-markets prize AND produces the "live URL on Arc"
  that every other track needs as its foundation. Nothing else has a place to
  stand until this is done.

### Steps 2–4 — IN PARALLEL (once the core is on Arc)
Use the file-ownership model (CLAUDE.md) so these don't collide:
- **2. CRE → `resolve()`** — contracts/backend. Resolver is ready; high return.
- **3. World ID gate** — backend, self-contained, does not touch the chain.
- **4. ENS subdomains + reputation** — backend, mainnet, a separate leg.

### Step 5 — LAST / separate owner: the `/deposit` cluster
Dynamic + Blink + Arc-abstracted USDC. New surface + external approvals → off
the critical path; can run in parallel but must not block the guaranteed prizes.

### One-liner
First **put what already works onto Arc** (Step 1 — foundation + first prize),
then **parallelise CRE + World ID + ENS** (our code is ready for them, +~$14.5k),
and do the expensive deposit cluster last so its external dependencies can't
stall the prizes we can already bank.

---

## Arc testnet facts (confirmed via chainid.network registry)

| Param | Value |
|-------|-------|
| Network | Arc Network Testnet (Circle) |
| **Chain ID** | **5042002** (`0x4cef52`) |
| RPC | `https://rpc.testnet.arc.network` (+ QuickNode / Blockdaemon mirrors, wss) |
| Explorer | `https://testnet.arcscan.app` (Arcscan) |
| Faucet | `https://faucet.circle.com/` (public — testnet is open, not waitlisted) |
| Gas token | **USDC** (native, decimals 18) |
| Mainnet (ref) | chain ID `5042`, also USDC-gas |

Disambiguation: other registry chains named "Arc" (e.g. 1243/1244 archiechain,
native `ARC`) are NOT Circle Arc — ignore them. Circle Arc is identified by
USDC-as-gas + `arc.network` + `faucet.circle.com`.

### Two distinct USDC tokens on Arc — do not conflate
1. **Gas USDC** — the chain's native currency (18 decimals). The demo wallet
   needs a one-time top-up from `faucet.circle.com` to send any write tx
   (approve, buy). Not a recurring concern: one fill covers the whole demo.
2. **Collateral USDC** — the ERC-20 the bets are denominated in (replaces our
   `MockUSDC`). Decision: use **Circle testnet USDC** (real, via faucet) to
   strongly satisfy the ARC prize's "USDC collateral" requirement. Confirm its
   address + decimals (6 vs 18) on Arcscan before wiring.

### MetaMask demo transaction — what it requires
A state-changing tx through MetaMask is a real on-chain tx and always costs gas;
that's the network's rule, not our option. For the demo:
1. Network added to MetaMask (chainId 5042002, RPC, currency USDC) — wagmi can
   prompt via `wallet_addEthereumChain`.
2. Demo wallet has gas-USDC (one-time faucet).
3. Demo wallet has collateral-USDC (faucet).
4. `approve` (tx #1, gas) → `buy` (tx #2, gas).
5. tx hashes visible in Arcscan → the "real tx IDs" proof for the ARC prize.

---

## Open items to confirm before coding Step 1 (hands-on, ~15 min, no code)
- [ ] `faucet.circle.com` issues gas-USDC to the deployer address on Arc testnet.
- [ ] Collateral USDC ERC-20 **address** + **decimals** from Arcscan.
- [ ] `https://rpc.testnet.arc.network` answers `eth_chainId` → `0x4cef52`.
- [ ] Confirm our `USDC_DECIMALS` (currently `1_000_000` = 6) matches Circle USDC.

## Risks (honest)
- **BUG-002 sharpens** on a live network — the manual address patch is painful;
  close it with runtime address loading during Step 1.
- **nativeCurrency = USDC** is unusual; viem expects an 18-decimal native, which
  matches here, but watch UI/gas displays.
- Deposit cluster's external approvals (Flow book-a-call, Blink merchantId) are
  outside our control — reason it stays off the critical path.

> Status: working plan, nothing migrated yet. See `BUGS.md` (BUG-002),
> `DeployRunbook.md` (§2.3, §2.5 address drift), `CLAUDE.md` (file ownership).
