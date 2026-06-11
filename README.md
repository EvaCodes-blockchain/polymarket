# Justify — PolyMarket Social MVP

> **Branch notice:** all MVP work lives on the **`mvp`** branch. It is the terminal
> delivery branch — it is never merged into `main`. MVP completion is marked by
> tagging `mvp` (`vMVP-1.0.0`).

Justify is a social prediction-market platform: a Twitter-like feed where the shareable
object is a tradeable prediction market. This repository branch contains the **MVP**
mandated by the CEO directive (`documentation_polymarket_social/functional-requirements-ceo.md`):
four user flows that must work end-to-end with **no mocks**, while everything else may ship
hardcoded exactly as the HTML prototype renders it.

| Flow | Requirement | Status |
|---|---|---|
| **CEO-1** | Register / sign in with at least one working auth method | ✅ Delivered |
| **CEO-2** | Follow the founder's profile, follower count persisted in DB | ✅ Delivered |
| **CEO-3** | Connect a MetaMask wallet (local Ganache chain, ID 1337) and bind it to the account | ✅ Delivered |
| **CEO-4** | Place one real Buy bet on one seeded market, settled on-chain | ✅ Delivered |

---

## 1. Current status (as of 2026-06-11)

**All four CEO flows are implemented, merged into `mvp`, and green in CI.**

- 14 pull requests merged (PRs #21–#34), every one gated on a green 4-check CI run
  (`lint`, `typecheck`, `test`, `build`).
- 28 Solidity contract tests passing (`contracts/test/BuyFlow.test.ts` covers the full
  approve → buy → position flow plus access control and AMM math).
- The full stack runs locally via `docker compose up`: Ganache, Postgres, the HTML
  prototype, and the production-built Next.js app — all with healthchecks.
- A deploy smoke-run confirmed the on-chain Buy flow end-to-end: a trader bought $10 of
  YES shares on the seeded market and received outcome tokens.

**Open items (not blocking a Dev deploy):**

| Item | Owner | State |
|---|---|---|
| E2E smoke test of the CEO demo path (Playwright: register → follow → connect → buy) | devops-engineer | In progress |
| Onboarding + integration-contracts reference docs | documentation-engineer | In progress |
| Google OAuth as a second auth method | — | Credentials wired in config; needs real `GOOGLE_CLIENT_ID`/`SECRET` to activate. Credentials (email+password) auth is the working method per CEO-1. |

---

## 2. What was built

### 2.1 Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  Next.js 14 App Router UI  ·  wagmi/viem  ·  MetaMask           │
└──────────────┬───────────────────────────┬──────────────────────┘
               │ HTTP (API routes)         │ JSON-RPC (eth)
┌──────────────▼──────────────┐   ┌────────▼─────────────────────┐
│  Next.js server             │   │  Ganache (chain ID 1337)     │
│  · NextAuth v4 (sessions)   │   │  · MockUSDC (ERC-20, 6 dec)  │
│  · API routes (REST-ish)    │   │  · OutcomeToken (ERC-1155)   │
│  · Prisma 6                 │   │  · MarketFactory             │
└──────────────┬──────────────┘   │  · PredictionMarket          │
               │                  │  · MarketAMM (CPMM, 2% fee)  │
┌──────────────▼──────────────┐   │  · OracleResolver            │
│  PostgreSQL                 │   │  · FeeTreasury               │
│  users · sessions · wallets │   └──────────────────────────────┘
│  follows                    │
└─────────────────────────────┘
```

- **Frontend** — Next.js 14.2 (App Router) + TypeScript strict + Tailwind CSS.
  Visuals follow the HTML prototype (`html-polymarket-social-prototype/`), which is the
  product source of truth. Wallet interactions via wagmi v2 / viem.
- **Backend** — Next.js API routes (same process), NextAuth v4 with the Prisma adapter,
  PostgreSQL via Prisma 6.
- **Contracts** — Solidity 0.8 + Hardhat + OpenZeppelin. Deployed to a Ganache node with
  a **deterministic mnemonic**, so contract addresses are reproducible across environments.
- **Tooling** — pnpm workspaces (`web`, `contracts`), conventional commits enforced by
  commitlint, CODEOWNERS-routed reviews, GitHub Actions CI.

### 2.2 Repository layout

```
web/                          Next.js app: UI + API routes + Prisma
  prisma/                       schema, migrations, founder seed
  src/app/                      pages (feed, profile, trade, sign-in, …)
  src/app/api/                  auth, register, profile, follow, wallet routes
  src/components/               UI components (SignInModal, BuyPanel, …)
  src/lib/client/               wagmi config, contract ABIs/addresses, hooks
  src/lib/server/               NextAuth options, Prisma client singleton
  Dockerfile                    3-stage production image
contracts/                    Solidity + Hardhat workspace
  src/                          7 contracts (see table below)
  scripts/deploy.ts             deploy + seed script
  deployments/ganache.json      frozen address/ABI artifact (integration contract)
  test/BuyFlow.test.ts          28 tests
docker-compose.yaml           ganache + postgres + prototype + web + one-shot deploy
.github/workflows/ci.yml      lint / typecheck / test / build (required checks)
documentation_polymarket_social/   product spec (upstream)
html-polymarket-social-prototype/  static prototype (visual source of truth)
```

### 2.3 The four flows in detail

**CEO-1 — Registration & sign-in**
- `SignInModal` ("Welcome to Justify", styled after the prototype) with two modes:
  *register* (name/email/password → `POST /api/auth/register`, bcrypt-hashed) and
  *sign in* (`signIn('credentials')` against NextAuth).
- Sessions are database-backed (Prisma adapter). `/sign-in` is also wired as the NextAuth
  custom sign-in page. The nav reflects the signed-in state (avatar, sign-out).
- Google OAuth is configured but dormant until real client credentials are supplied.

**CEO-2 — Follow the founder**
- `prisma/seed.ts` creates the founder account (idempotent upsert):
  `founder@justify.local` / `founder1234` (local/dev only).
- `/profile/[handle]` server-renders profile data from `GET /api/profile/[handle]`
  (handle = email, id, or name) including the live follower count.
- `FollowButton` toggles via `POST` / `DELETE /api/social/follow`; the `Follow` table has
  a unique `(followerId, followeeId)` constraint, so the count is real and persisted.

**CEO-3 — Connect MetaMask**
- wagmi config targets **Ganache chain 1337 at `:8545`** (`injected({ target: 'metaMask' })`).
  This is intentionally *not* Base (8453) — Base/USDC/decentralized-oracle is a later phase.
- `WalletConnectModal` drives: connect → switch chain to 1337 → `personal_sign` of a
  server-issued message (`"Sign in to Justify … Nonce: {userId}"`) → `POST /api/wallet`,
  which verifies the signature server-side (viem) and persists the address (unique per user).

**CEO-4 — Place a real Buy bet**
- One market is seeded at deploy time: *"Will Barcelona win El Clásico?"* (market ID 0,
  YES/NO outcomes) with AMM liquidity.
- `/trade/[id]`: `MarketInfoCard` shows live implied-probability bars read from
  `MarketAMM.impliedProbabilityBps`; `BuyPanel` runs the on-chain sequence
  `MockUSDC.mint` (test faucet) → `MockUSDC.approve(MarketAMM)` →
  `MarketAMM.buy(outcomeIndex, collateralIn, minSharesOut)`;
  `PositionCard` reads the resulting `OutcomeToken.balanceOf`
  (token ID = `(marketId << 8) | outcomeIndex`).
- Guards: wrong-chain prompts a switch; not-connected opens the wallet modal.

### 2.4 Smart contracts

| Contract | Purpose |
|---|---|
| `MockUSDC` | ERC-20 collateral, 6 decimals, open mint (test faucet) |
| `OutcomeToken` | ERC-1155, one token ID per (market, outcome) |
| `MarketFactory` | Creates markets, wires AMM + outcome tokens |
| `PredictionMarket` | Market state machine (open → resolved → claimable) |
| `MarketAMM` | Constant-product AMM, 2% fee, implied-probability views |
| `OracleResolver` | Manual oracle (MVP); resolution path deployed but not exercised by the demo |
| `FeeTreasury` | Fee sink; deployed, not exercised in MVP |
| `JustifyAccessControl` | Shared role gate (deployer/oracle roles) |

`contracts/scripts/deploy.ts` deploys everything, seeds the demo market, funds trader
accounts, and writes `contracts/deployments/ganache.json` — the **frozen integration
artifact** (addresses + ABIs + seeded-market metadata + well-known accounts) that the
web app imports. Account convention from the deterministic mnemonic: index 0 deployer,
1 oracle, 2–5 pre-funded traders, 6 market creator.

### 2.5 Database schema (Prisma)

`User`, `Account`, `Session`, `VerificationToken` (standard NextAuth) plus:

- `Wallet` — `userId`, `address` (unique), bind timestamp; one wallet per user for MVP.
- `Follow` — `followerId`, `followeeId`, unique pair constraint, indexed for counting.

Migrations are committed; `prisma migrate deploy` runs automatically on container start.

---

## 3. How it was delivered

The MVP was built by a five-agent engineering team (contracts, backend, frontend, devops,
documentation) under a single orchestrator/team-lead, with process rules designed to keep
parallel work conflict-free:

- **Work breakdown mirrors Jira**: 5 milestones (Phase 0, CEO-1…4), 5 epics (#1–#5),
  15 work issues (#6–#20) with explicit batch ordering. Issues marked
  `integration-contract` (Prisma schema, API shapes, deploy artifact) always merged
  **before** their consumers.
- **Strict file ownership** per engineer (see `CLAUDE.md` / CODEOWNERS): frontend owns
  `web/src` minus `api`+`lib/server`; backend owns Prisma/API/server-lib; contracts owns
  `contracts/`; devops owns compose/CI/Dockerfiles. Cross-boundary changes went through
  the orchestrator.
- **Frozen integration contracts**: API route shapes, the wallet-bind message format, and
  `deployments/ganache.json` were announced, frozen, then consumed — never redefined
  downstream.
- **Merge discipline**: every PR squash-merged into `mvp` by the orchestrator only, only
  on a green 4-check CI run. "Works locally" was never accepted as done. Content of each
  PR was verified against the declared deliverable before merge (grep-level checks for
  key wiring, e.g. `signIn('credentials')`, `MarketAMM.buy`).
- **Conventional commits** enforced (`commitlint`), scopes:
  `web | api | contracts | infra | e2e | docs | delivery | deps`.

Full process reference: `CONTRIBUTING.md`. Branch protection expectations:
`.github/branch-protection.md` (required checks: `lint`, `typecheck`, `test`, `build`).

---

## 4. Running the stack

### 4.1 Prerequisites

- Docker + Docker Compose v2
- Node.js 20+ and pnpm 9+ (only for local development outside Docker)
- MetaMask (browser extension) for the wallet flows

### 4.2 One-command full stack (recommended for review)

```bash
git clone https://github.com/EvaCodes-blockchain/polymarket.git
cd polymarket
git checkout mvp

# Optional but recommended: set a real secret
export NEXTAUTH_SECRET="$(openssl rand -base64 32)"

docker compose up -d --build
```

Services and ports:

| Service | Port | Notes |
|---|---|---|
| `web` | **3000** | Production Next.js build; runs `prisma migrate deploy` on start |
| `ganache` | 8545 | Chain ID 1337, deterministic mnemonic, 10 funded accounts |
| `postgres` | 5432 | `justify:justify@localhost:5432/justify` |
| `prototype` | 3001 | Static HTML prototype (visual reference) |

Then:

```bash
# 1) Deploy contracts + seed the demo market against compose Ganache (one-shot):
docker compose --profile deploy run --rm contracts-deploy

# 2) Seed the founder user (CEO-2 demo target):
cd web && pnpm install && pnpm db:seed   # or run inside the web container
```

> The committed `contracts/deployments/ganache.json` was produced against the same
> deterministic mnemonic, so addresses match a fresh compose Ganache. The one-shot
> deploy re-verifies this; if addresses ever diverge, re-run it and rebuild `web`.

### 4.3 Demo script (the four CEO flows)

1. Open `http://localhost:3000` → **Sign in** → register with name/email/password → you
   are signed in (CEO-1).
2. Navigate to the founder profile (`/profile/founder@justify.local`) → **Follow** →
   follower count increments; refresh — it persists (CEO-2).
3. In MetaMask add network `http://localhost:8545`, chain ID `1337`, and import a trader
   key (accounts 2–5 of the mnemonic printed by `ganache` logs). **Connect wallet** →
   approve the chain switch → sign the bind message (CEO-3).
4. Go to `/trade/0` → **Get Test USDC** → **Approve** → **Buy** YES or NO → the position
   card shows your outcome-share balance read from the chain (CEO-4).

### 4.4 Local development (outside Docker)

```bash
pnpm install
docker compose up -d ganache postgres        # infra only
cp .env.example web/.env.local               # adjust DATABASE_URL/NEXTAUTH_SECRET
cd web
pnpm db:migrate && pnpm db:seed
pnpm dev                                     # http://localhost:3000
```

Contracts:

```bash
cd contracts
pnpm test            # 28 tests
pnpm deploy:ganache  # deploy + seed against localhost:8545, rewrites deployments/ganache.json
```

### 4.5 Quality gates

```bash
pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build
```

The same four commands run as required CI checks on every PR targeting `mvp`.

---

## 5. Deploying to a Dev environment (VPS)

The stack is a single `docker-compose.yaml` and is VPS-ready as-is. Checklist:

1. **Secrets** — set real values on the host (never commit them):
   `NEXTAUTH_SECRET` (mandatory: `openssl rand -base64 32`),
   `NEXTAUTH_URL=http://<host-or-domain>:3000` (must match the externally visible URL,
   otherwise NextAuth callbacks/CSRF fail).
2. **RPC URL caveat** — `NEXT_PUBLIC_RPC_URL` is baked into the **browser** bundle at
   image build time and must be reachable *from the reviewer's browser*, not from inside
   Docker. For a remote Dev box build with
   `NEXT_PUBLIC_RPC_URL=http://<host-or-domain>:8545` (build arg / env at build), and
   expose port 8545 — or keep 8545 internal and document that wallet flows require an
   SSH tunnel (`ssh -L 8545:localhost:8545 <vps>`).
3. **Order of operations** — `docker compose up -d --build` → one-shot
   `docker compose --profile deploy run --rm contracts-deploy` → founder seed.
4. **Persistence** — Postgres data lives in the `postgres-data` named volume; Ganache
   state is **in-memory** (a restart resets the chain — re-run the one-shot deploy after
   any Ganache restart; DB-side wallet bindings stay valid since addresses are
   deterministic, but on-chain balances/positions reset).
5. **Exposure** — for a CEO-facing demo, front ports 3000 (+8545 if public wallet flows
   are wanted) with a reverse proxy / firewall as appropriate. The app has no rate
   limiting; treat the Dev URL as semi-private.

---

## 6. Known limitations (by design, per MVP scope)

- Feed, markets list, portfolio, notifications, settings pages are **hardcoded
  prototype content** — only the four CEO flows hit real services.
- Manual oracle; market **resolution/claim is deployed but not exercised** in the demo.
- One wallet per user; no unbind UI.
- `MockUSDC.mint` is an open faucet (test collateral by design).
- No rate limiting / CSRF hardening beyond NextAuth defaults; not production-grade.
- Base mainnet, real USDC, decentralized oracle: explicitly **out of scope** (next phase;
  the contract layer was designed so the swap is additive).

---

## 7. Reference

- Product spec: `documentation_polymarket_social/` (start with `overview.md`;
  MVP scope: `functional-requirements-ceo.md`)
- Process & conventions: `CONTRIBUTING.md`, `CLAUDE.md`
- CI & branch protection: `.github/workflows/ci.yml`, `.github/branch-protection.md`
- Contracts README: `contracts/README.md` (artifact format, buy-flow guide)
- Merged PR history: #21–#34 on GitHub (squash commits on `mvp` mirror them 1:1)
