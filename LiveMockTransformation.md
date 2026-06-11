# Live / Mock Transformation Plan

**Audience:** CTO, Chief Software Delivery.
**Purpose:** (1) a complete, audited inventory of every mock / hardcoded / dev-only element
in the MVP codebase, and (2) a phased plan to take the product live — real auth (Google),
real blockchain (Base + USDC), real markets, real social features.
**Source of truth:** code audit of the `mvp` branch performed 2026-06-11 (73 distinct
findings, every one with a file reference). The MVP itself is delivered and deployed to
Dev (see `README.md`, `DeployRunbook.md`); this document is about what comes *after*.

---

## 1. Executive summary

The MVP was scoped deliberately: **four CEO flows are real** (credentials auth, follow
with DB persistence, MetaMask wallet binding with signature verification, on-chain Buy
through a real CPMM AMM), **everything else is prototype veneer**. That veneer is now the
gap to live.

The mock surface falls into five buckets, in order of risk:

| # | Bucket | Findings | Live blocker? | Effort (est.) |
|---|---|---|---|---|
| A | Blockchain: test chain, mock USDC, single market, no sell/redeem, no real oracle | 17 | **Hard blocker** | 4–6 wks |
| B | Auth & security: dormant Google OAuth, replayable wallet nonce, secret fallbacks, no rate limiting/CSP/CSRF, email leak | 17 | **Hard blocker** | 2–3 wks |
| C | Social/UI: hardcoded feed, fake personas, stub pages (markets, portfolio, create, notifications, settings, search) | 27 | Blocker for "social" claim | 4–6 wks |
| D | Seeds & credentials: founder password, postgres `justify:justify`, committed mnemonic | 5 | **Hard blocker** (1–2 days of rotation + config) | days |
| E | Infra: dev-only compose services, exposed ports, no monitoring | 7 | Blocker | 1–2 wks |

**Recommended path under time pressure:** a three-phase rollout (§4) where Phase 1
(*"Live-Ready Core"*, ~3–4 weeks with the current team in parallel) gets real money on a
real chain with real auth behind the existing four flows — this is the minimum honestly
launchable product. Phases 2–3 fill in social and scale. Cutting Phase 1 items is not
recommended: every item in it is either money-loss, account-takeover, or legal exposure.

**Two correctness bugs found during the audit must be fixed regardless of any launch
decision** — they are silent today only because the MVP has exactly one market with ID 0:

1. **Token-ID encoding mismatch** — the contract encodes ERC-1155 IDs as
   `(marketId << 1) | outcomeIndex` (`contracts/src/OutcomeToken.sol:55`), the frontend
   reads balances with `(marketId << 8) | outcomeIndex`
   (`web/src/components/PositionCard.tsx:27`). For any market with ID > 0 the UI will
   read the wrong token and show zero/wrong positions.
2. **Resolution is decoupled from the oracle** — `PredictionMarket.resolve()` is
   creator-only and never consults `OracleResolver`
   (`contracts/src/PredictionMarket.sol:74`); the two contracts can record different
   winning outcomes.

---

## 2. Mock inventory (what is fake today)

Each entry: what it is → where → what live requires. Grouped by bucket. File paths are
relative to repo root on branch `mvp`.

### A. Blockchain & contracts

| # | What is mocked | Where | What live requires |
|---|---|---|---|
| A1 | **MockUSDC** — owner-mintable test ERC-20; "Get Test USDC" faucet button in the UI | `contracts/src/MockUSDC.sol`; `web/src/components/BuyPanel.tsx:113-131` | Native **USDC on Base** (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`). Delete MockUSDC from deploy path; remove faucet button; add real balance display + "insufficient funds" UX |
| A2 | **Ganache chain 1337** hardcoded in ~9 places (wagmi config, UI copy, compose, hardhat config, env) | `web/src/lib/client/wagmi.ts`; `useWallet.ts:18`; `WalletConnectModal.tsx`; `BuyPanel.tsx`; `MarketInfoCard.tsx`; `docker-compose.yaml`; `contracts/hardhat.config.ts`; `.env.example` | Target **Base mainnet (8453)** + **Base Sepolia (84532)** for staging. Single source of truth: chain config module driven by env, consumed everywhere; UI copy must say "Base", not "Ganache (1337)" |
| A3 | **Committed deterministic mnemonic** (publicly known) used for deployer/oracle/traders | `contracts/hardhat.config.ts:5`; `docker-compose.yaml:13,79` | Production deploy keys in KMS/hardware wallet; mnemonic stays dev-only; rotate all role addresses |
| A4 | **Frozen address artifact** + addresses inlined in frontend | `contracts/deployments/ganache.json`; `web/src/lib/client/contracts.ts:11-25` | Per-network deployment artifacts (`deployments/base.json`, `base-sepolia.json`); frontend reads addresses from env/artifact selected by `NEXT_PUBLIC_CHAIN_ID`, never inlined |
| A5 | **Single-market hardwiring** — `/trade/[id]` ignores `id`; BuyPanel/MarketInfoCard/PositionCard all bound to seeded market #0; question text "Will Barcelona win El Clásico?" is a compile-time constant | `web/src/app/trade/[id]/page.tsx:22`; `MarketInfoCard.tsx:38`; `BuyPanel.tsx`; `PositionCard.tsx:26`; `contracts.ts:21-24` | Components take `marketId` prop; resolve AMM/market addresses via `MarketFactory`; read question/state from chain or an indexer API |
| A6 | **Token-ID encoding bug** (see §1) | `OutcomeToken.sol:55` (`<<1`) vs `PositionCard.tsx:27` (`<<8`) | Align both sides (recommend widening the contract to `<<8` pre-mainnet for 255-outcome headroom, then freeze); add a cross-layer test |
| A7 | **No sell flow** — AMM is buy-only; users cannot exit a position | `contracts/src/MarketAMM.sol:28` (noted as FR gap) | Implement `sell(outcomeIndex, sharesIn, minCollateralOut)` (inverse CPMM) + UI |
| A8 | **No redeem/claim flow** — winners can never convert shares to collateral | absent from `MarketAMM.sol` / `PredictionMarket.sol` | Implement post-resolution `redeem()`; without it, user funds are permanently locked — **launching without this is taking money with no way to pay out** |
| A9 | **Oracle is manual & decoupled** — `OracleResolver.resolve()` is a privileged manual call; `PredictionMarket.resolve()` doesn't check it; seeded proof URL is `example.com` | `contracts/src/OracleResolver.sol`; `PredictionMarket.sol:74-79`; `contracts/scripts/deploy.ts:47` | Phase 1: wire PredictionMarket to require OracleResolver outcome + multisig-held resolver role. Phase 2+: UMA Optimistic Oracle / Chainlink integration |
| A10 | **No slippage protection** — UI always sends `minSharesOut = 0` | `BuyPanel.tsx:155` | Compute min-out from quoted price with user-set tolerance (default 1–2%); mandatory on mainnet (sandwich-attack exposure) |
| A11 | **Shares-received display is fake** — shows input amount, not parsed event | `BuyPanel.tsx:161` ("placeholder until event parsing") | Parse the AMM `Buy` event from the receipt |
| A12 | **Market creation only via deploy script**; `/create` page is a stub | `contracts/scripts/deploy.ts:142-169`; `web/src/app/create/page.tsx` | Market-creation form + permissioned `MarketFactory.createMarket()` path (admin-gated at first) |
| A13 | **FeeTreasury dead code** — `receiveFeesFrom()` never called (AMM pushes fees directly) | `FeeTreasury.sol:31-35` vs `MarketAMM.sol:141-143` | Remove or wire; decide fee-withdrawal governance before real fees accrue |
| A14 | **Pre-funded trader accounts** — deploy script mints $10k to 4 known addresses | `deploy.ts:183-189` | Dev-only; must not exist in mainnet deploy script |
| A15 | **Contracts unaudited** — 28 unit tests exist, no external review | `contracts/` | Pre-mainnet: at minimum an internal adversarial review + fuzzing (Echidna/Foundry); ideally a short external audit of the 4 money-handling contracts |

### B. Auth & security

| # | What is mocked | Where | What live requires |
|---|---|---|---|
| B1 | **Google OAuth dormant** — provider registers only if env vars set; UI button always rendered and errors if not configured | `web/src/lib/server/auth.ts:91-98`; `SignInModal.tsx:158-171` | Real OAuth client (GCP console: consent screen, prod domain redirect URIs); hide button when unconfigured; account-linking policy for same-email credentials+Google |
| B2 | **Replayable wallet-bind nonce** — sign message nonce = stable user ID, valid forever | `wagmi.ts:43-45`; `api/wallet/route.ts:37-39` | Server-issued random nonce with expiry (DB row or signed timestamp, 5-min window); consider full SIWE (EIP-4361) |
| B3 | **Hardcoded secret fallbacks** — `'dev-secret-change-in-production'` in code; `change-me-in-production` in compose | `auth.ts:143`; `docker-compose.yaml:96` | Fail-fast on missing `NEXTAUTH_SECRET` (throw at boot); no defaults anywhere |
| B4 | **Public profile API leaks email** | `api/profile/[handle]/route.ts:92-100` | Strip `email` from public responses; introduce a `handle` field on User (emails-as-handles in URLs is itself a leak — see C) |
| B5 | **No rate limiting on any route** (register, wallet, follow, profile) | all of `web/src/app/api/` | Edge/middleware rate limiting (e.g. Upstash ratelimit or nginx): register ≤10/min/IP, wallet ≤30/min, follow ≤60/min |
| B6 | **No CSRF on mutating custom routes**; no CSP/HSTS/X-Frame-Options headers; no CORS policy | `api/social/follow`, `api/wallet`; `web/next.config.mjs` (no headers) | NextAuth CSRF token or double-submit cookie on POST/DELETE; security headers via `next.config` `headers()`; explicit CORS |
| B7 | **Weak input validation** — email check is `includes('@')`; password rule is length≥8 only; no length cap on wallet `message` | `api/auth/register/route.ts:33,38`; `api/wallet/route.ts:69` | zod schemas on every route; email verification flow; password policy or passkeys |
| B8 | **30-day JWT sessions, no revocation** | `auth.ts:111-114` | Shorten to 24h for a financial app; rotation; sign-out blocklist |
| B9 | **Server-side session forwarding bug** — profile page passes the session *object* as a cookie header, so `viewerFollows` is always false on SSR | `web/src/app/profile/[handle]/page.tsx:42-46` | Replace internal HTTP fetch with `getServerSession()` + direct Prisma query |
| B10 | **Google Fonts CDN at runtime** (IP leak to Google, no SRI) | `web/src/app/layout.tsx:18-22` | Self-host Material Icons via `next/font` or local assets |
| B11 | **Terms/Privacy links point to non-existent routes** | `SignInModal.tsx:277-279` | Real legal pages before public sign-ups (compliance, see §5) |

### C. Social & UI (prototype veneer)

| # | What is mocked | Where | What live requires |
|---|---|---|---|
| C1 | **Entire feed is static** — `FEED_POSTS` (2 posts, fake authors FC Barcelona / vitalik.eth, fake counts, fake comments); "Trending" tab re-renders the same array; perpetual fake loading spinner | `web/src/lib/client/feedData.ts:4-83`; `FeedPage.tsx:104-106` | `Post` model + `GET /api/feed` with cursor pagination; real engagement counters |
| C2 | **Post composer & comments decorative** — no submit handlers, no API | `FeedPage.tsx:42-50`; `FeedItem.tsx:107-116` | `POST /api/posts`, `Comment` model, `POST /api/posts/[id]/comments` |
| C3 | **Like/repost/share buttons inert** with hardcoded counts | `FeedItem.tsx:87-104` | `Reaction` model + endpoints + optimistic UI |
| C4 | **Fake personas with broken Follow** — carousels pass handle *slugs* as user IDs → follow calls 404 for every suggested creator | `feedData.ts:86-117`; `RightSidebar.tsx:7-56`; `FeedPage.tsx:90,137` | `GET /api/users/suggested` returning real users with real IDs |
| C5 | **Market Movers sidebar static**; static prices on feed market cards (`priceYes: 0.21`) | `RightSidebar.tsx:7-32`; `feedData.ts:23-28` | Trending API + live AMM prices (indexer or on-chain reads with cache) |
| C6 | **MarketCard "Buy" = `alert()` stub** | `MarketCard.tsx:204-208` | Route to `/trade/[id]` or inline wagmi buy |
| C7 | **Five stub pages** — `/markets`, `/portfolio`, `/notifications`, `/settings`, `/create` (+ `/help`) all render "coming soon" | `web/src/app/{markets,portfolio,notifications,settings,create,help}/page.tsx` | Markets list (factory/indexer), portfolio (positions+P&L from chain), notifications pipeline, profile-edit API, creation form |
| C8 | **Search inert** | `RightSidebar.tsx:64-70` | `GET /api/search` (Postgres FTS is enough at first) |
| C9 | **Profile gaps** — hardcoded bio; "No posts yet" unconditional; Liked/Replies/Mentions tabs dead; `/profile` redirects anonymous users to the founder seed account; profile URLs use raw emails | `ProfileHeader.tsx:98-109`; `profile/[handle]/page.tsx:93-109`; `profile/page.tsx:17` | `User.bio` + `User.handle` fields; posts-by-user endpoint; sensible anonymous landing |
| C10 | **Dead links** — footer socials `href="#"`, `justify.market/{handle}` label is fake; mobile hamburger menu no-op | `AppShell.tsx:80-88`; `ProfileHeader.tsx:109`; `MobileHeader.tsx:57-63` | Real links; mobile nav drawer |

### D. Seeds, fixtures, credentials

| # | What | Where | Live requirement |
|---|---|---|---|
| D1 | Founder account `founder@justify.local` / `founder1234` in committed seed | `web/prisma/seed.ts:9-14` | Prod founder = real account, strong secret from a manager; seed stays dev-only |
| D2 | Postgres `justify:justify` in compose + env example | `docker-compose.yaml:51-53,95`; `.env.example:9` | Managed Postgres (RDS) or strong rotated password; secrets manager |
| D3 | Placeholder `NEXTAUTH_SECRET` in `.env.example` | `.env.example:18` | CI guard: refuse boot when value equals placeholder (covered by B3 fail-fast) |
| D4 | Public mnemonic + pre-funded traders (= A3/A14) | see A3, A14 | Rotation; KMS |
| D5 | Fake oracle proof URL `example.com/el-clasico-oracle` on the seeded market | `deploy.ts:47` | Every live market needs a verifiable resolution-source URL |

### E. Infrastructure

| # | What | Where | Live requirement |
|---|---|---|---|
| E1 | `ganache` compose service (in-memory chain — restart wipes funds/positions) | `docker-compose.yaml:8-29` | Does not exist in prod; replaced by Base RPC provider (Alchemy/QuickNode + fallback) |
| E2 | `prototype` nginx service (static HTML reference) | `docker-compose.yaml:33-45` | Dev-only; move both behind compose `profiles: [dev]` |
| E3 | `contracts-deploy` one-shot service (redeploys with committed mnemonic) | `docker-compose.yaml:71-85` | Mainnet deploys via secured runbook, never compose automation |
| E4 | Postgres port 5432 published to host | `docker-compose.yaml:55-56` | Remove mapping; internal Docker network only (flagged in `DeployRunbook.md` too) |
| E5 | RPC port 8545 published; unauthenticated EVM admin methods exposed | `docker-compose.yaml:19` | Dev-only; firewalled (current AWS SG already blocks it) |
| E6 | No monitoring/alerting/error tracking; no log aggregation | — | Sentry (web+API), uptime checks, on-chain event monitoring for AMM/treasury |
| E7 | Single-VPS deployment, no TLS, `NEXTAUTH_URL` over http | Dev VPS (see `DeployRunbook.md`) | Domain + TLS (reverse proxy) for staging; managed hosting decision for prod |

---

## 3. Target live architecture (delta view)

```
                       MVP (today)                 →  LIVE (target)
Chain                  Ganache 1337, in-memory     →  Base mainnet 8453 (staging: Base Sepolia)
Collateral             MockUSDC (faucet)           →  Native USDC (Circle, 6 dec — same decimals, low code delta)
RPC                    self-hosted container       →  Alchemy/QuickNode + fallback provider
Wallets                MetaMask injected only      →  + WalletConnect/Coinbase Wallet (wagmi connectors)
Auth                   credentials only            →  credentials + Google OAuth (+ email verification)
Wallet binding         static nonce (replayable)   →  SIWE-style expiring nonce
Markets                1 seeded, hardwired         →  N markets via factory + admin creation UI + indexer
Market data to UI      compile-time constants      →  indexer/API layer (start: direct viem reads + ISR cache;
                                                       scale: ponder.sh or The Graph)
Resolution             manual, decoupled, no claim →  oracle-gated resolve + redeem(); resolver = multisig
Feed/social            hardcoded arrays            →  Post/Comment/Reaction models + APIs
DB                     compose Postgres, def. pwd  →  managed Postgres, secrets manager, backups
Secrets                committed defaults          →  fail-fast envs + AWS Secrets Manager
Observability          none                        →  Sentry + uptime + on-chain event alerts
```

Deliberately unchanged for live-v1: Next.js App Router monolith (UI + API in one
process), Prisma/Postgres, the CPMM AMM design, squash-merge delivery process to `mvp`.

---

## 4. Phased transition plan

Sequencing principle: **money-and-identity first** (it gates legal launch), social
second (it gates the "social" product claim), scale third. Phases 1 and 2 can overlap
heavily with the current 5-agent team structure; estimates assume that parallelism.

### Phase 0 — Hygiene (days; start immediately, no decisions needed)

| Item | Covers | Owner |
|---|---|---|
| Fix token-ID encoding mismatch + cross-layer test | A6 | contracts + frontend |
| Wire `PredictionMarket.resolve()` to `OracleResolver`; fix `FeeTreasury` dead code | A9, A13 | contracts |
| Fail-fast secrets (remove both fallbacks), strip `email` from public profile API, fix SSR session-forwarding bug | B3, B4, B9 | backend |
| zod validation on all 4 API routes; message length cap | B7 | backend |
| Compose: move ganache/prototype/contracts-deploy under `profiles: [dev]`; unpublish 5432 | E1–E4 | devops |
| Rotate dev founder/postgres credentials out of being load-bearing anywhere | D1, D2 | devops |

**Exit:** no known-secret fallbacks, no silent correctness bugs, prod-shaped compose.

### Phase 1 — Live-Ready Core (~3–4 weeks, parallel)

The minimum honestly launchable product: the existing 4 flows, on real rails.

**Contracts track** (longest pole — start day 1):
1. `sell()` + `redeem()` in AMM/market layer + tests (A7, A8 — *launch-blocking: without
   redeem, user money is one-way*).
2. Adapt deploy for real USDC address injection (A1); per-network artifacts (A4).
3. Slippage params end-to-end (A10).
4. Internal adversarial review + fuzz pass; external audit decision (A15 — see §6 risks).
5. Deploy to **Base Sepolia** → team test cycle → **Base mainnet** with KMS keys (A3),
   resolver role on a 2-of-3 multisig (A9).

**Web3 frontend track:**
1. Chain-config module (env-driven: chainId, RPC, addresses, USDC) replacing all 1337
   hardcodes (A2, A4); UI copy update.
2. Multi-market trade page: `marketId` from route → factory lookup (A5); live prices on
   cards via viem reads + cache (C5 partial).
3. Remove faucet button; real USDC balance/allowance UX (A1); event-parsed shares (A11);
   sell/redeem UI (A7/A8); WalletConnect + Coinbase connectors.

**Auth/security track:**
1. Google OAuth live: GCP client, consent screen, account-linking rules, conditional
   button (B1).
2. SIWE-style expiring nonce for wallet bind; re-verify existing bindings (B2).
3. Rate limiting middleware + security headers + CSRF on mutating routes (B5, B6).
4. Session policy: 24h + rotation (B8); email verification on register (B7).
5. `/terms`, `/privacy` pages (B11 — content from legal, see §5).

**Markets track (admin-first):**
1. Admin-gated market creation: form → API → `MarketFactory.createMarket()` (A12, C7-create).
2. `/markets` listing from factory enumeration + metadata (C7-markets).
3. Ops runbook for resolution: who resolves, evidence standard, payout flow (D5).

**Infra track:**
1. Staging env on Base Sepolia (reuse Dev VPS + CD pipeline from PR #38).
2. Domain + TLS; `NEXTAUTH_URL` https (E7).
3. Managed Postgres or hardened container + backups; secrets to AWS Secrets Manager (D2).
4. Sentry + uptime + on-chain event alerts on AMM/Treasury (E6).

**Phase-1 exit criteria:** a real user with a real wallet buys, sells, and — after an
admin resolves a real market — **redeems winnings in real USDC on Base mainnet**, having
signed up with Google, on a TLS domain, with rate-limited APIs and zero committed secrets.

### Phase 2 — Social goes real (~3–4 weeks, overlaps Phase 1 from week 2)

1. Schema: `Post`, `Comment`, `Reaction`, `Notification`, `User.handle`, `User.bio` (C1–C3, C9).
2. Feed API + composer + comments + reactions with optimistic UI (C1–C3); real pagination (C1).
3. Suggested-users API; kill fake personas; fix slug-as-ID follow bug (C4).
4. Market-attached posts: post composer can embed a market → MarketCard renders live
   prices → click-through to trade (C5, C6). *This is the core product loop — feed →
   market → trade.*
5. Portfolio page from on-chain positions (C7-portfolio); notifications MVP (follows,
   resolutions) (C7-notifications); settings/profile-edit (C7-settings); search via
   Postgres FTS (C8); mobile nav, real links (C10).

**Exit:** no hardcoded content anywhere in the product; the demo no longer needs a script.

### Phase 3 — Scale & decentralization (post-launch, ~4+ weeks)

1. Indexer (ponder.sh or The Graph) replacing direct RPC reads as market count grows.
2. UMA Optimistic Oracle (or equivalent) replacing the multisig resolver (A9 final form).
3. Permissionless/curated user market creation with moderation pipeline.
4. External smart-contract audit (if not done in Phase 1) before TVL grows.
5. Notification fan-out, performance (ISR/edge cache), horizontal scaling decision.

---

## 5. Decisions needed from CTO / Chief Software Delivery

These gate Phase 1 and are **not** engineering calls:

1. **Real money vs. testnet launch.** Going straight to Base mainnet + real USDC makes
   this a real-money market platform — in many jurisdictions a regulated activity
   (gambling/derivatives). Options: (a) mainnet, accept/structure the legal position;
   (b) public beta on **Base Sepolia** with test USDC — zero regulatory surface, full
   technical validation, weakest market signal; (c) mainnet with play-money points
   token. **This decision changes nothing in the engineering plan except which network
   ships first** — we build for both via config.
2. **Audit budget & timeline.** External audit of 4 money-handling contracts: ~1–3 wks
   calendar. Launching unaudited with a TVL cap + monitoring is a possible interim
   stance — explicit risk acceptance required.
3. **Oracle/resolution governance for Phase 1.** Who are the 2-of-3 multisig resolvers?
   What is the public evidence standard per market?
4. **Market creation policy at launch:** admin-only (recommended), curated, or open.
5. **Legal artifacts:** Terms of Service, Privacy Policy, geo-restrictions (some
   prediction-market operators geo-block US/UK) — needed before public sign-ups.
6. **Custody of deploy/admin keys:** which KMS/multisig product, who holds shares.
7. **Domain + brand confirmation** (prototype implies `justify.market`).

## 6. Top risks

| Risk | Exposure | Mitigation in plan |
|---|---|---|
| Launch without `redeem()` | Users' funds permanently locked = reputational/legal disaster | Phase 1 contracts track item 1; hard launch gate |
| Unaudited contracts on mainnet | Loss of all AMM/treasury funds | Audit decision (§5.2); TVL cap; pause role; monitoring |
| Replayable wallet nonce ships to prod | Account/wallet binding forgery | Phase 1 auth track item 2 |
| Regulatory (real-money predictions) | Forced shutdown | §5.1 decision; geo-blocking; staged testnet beta option |
| Single in-memory chain habit carried to staging | Data-loss surprises in demos | Base Sepolia staging from Phase 1 week 1 |
| Timeline pressure cuts security items (rate limits, CSRF, headers) | Brute force, spam, clickjacking on a money product | They are 2–3 dev-days total — explicitly cheap; keep in scope |

---

## 7. Suggested immediate next steps (this week)

1. CTO/CSD review this document; decide §5.1 (network) and §5.4 (creation policy) — the
   two decisions that re-order nothing but unblock everything.
2. Team starts **Phase 0 in full** (no decisions required) — issues to be opened
   mirroring §4 Phase 0 table.
3. Contracts engineer begins `sell()`/`redeem()` design + the token-ID fix (longest pole).
4. DevOps stands up Base Sepolia staging config alongside the existing Dev VPS.
5. Google Cloud OAuth client request initiated (consent-screen review has lead time).

*Prepared by the delivery team, 2026-06-11. Inventory derives from a full-code audit of
branch `mvp` @ `b3e91c1`; finding counts: 73. Companion docs: `README.md` (what was
built), `DeployRunbook.md` (how Dev runs), `CONTRIBUTING.md` (process).*
