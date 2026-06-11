# Agentic Sprint — Frozen Integration Contracts

**Status: FROZEN.** Every seat builds against these shapes. Breaking changes go through the
orchestrator only. Date: 2026-06-12.

Sprint goal (CEO demo = **Feed** + **Markets** pages only):

1. News-driven **market generator** (per `documentation_polymarket_social/testing-market-generator.md`).
2. **Markets API** returns generated + seeded markets with live AMM prices.
3. **Feed + Markets UI** display and trade real markets.
4. **Users generator** + **Users API** + UI users from API.
5. Integration tests for all of the above.

---

## 1. Environment (local dev on this machine)

- `corepack pnpm` — plain `pnpm` is NOT on PATH. Always `corepack pnpm <cmd>`.
- Docker via `sg docker -c "docker …"` (user not in docker group for current login shell).
- Compose stack is already UP: ganache :8545 (chain 1337), prototype :3001,
  postgres on **host port 5433** (local `docker-compose.override.yaml`; container-internal stays 5432).
- `web/.env` exists (DATABASE_URL → localhost:5433, RPC_URL, GANACHE_MNEMONIC, GENERATOR_API_KEY).
- Contracts deployed; artifact `contracts/deployments/ganache.json` is canonical (addresses match
  `web/src/lib/client/contracts.ts`).
- Ganache account mapping (mnemonic in compose): 0 deployer/admin, 1 oracle, 2–5 test traders,
  6 market creator (has FACTORY_ROLE), **7–9 generator bots**.
- Web dev server for verification: `cd web && corepack pnpm dev` (port 3000).

### New/changed env vars (catalog in `web/.env.example` — devops-infra keeps it in sync)

| Var | Default (dev) | Used by |
|-----|---------------|---------|
| `RPC_URL` | `http://localhost:8545` | web server-side chain lib, generator, tests |
| `GANACHE_MNEMONIC` | compose mnemonic | web server-side signers, generator trading |
| `GENERATOR_API_KEY` | `dev-generator-key` | POST /api/markets, /api/posts from generator |
| `API_BASE_URL` | `http://localhost:3000` | generator, tests |

Generator-only knobs: see Section 7 of testing-market-generator.md
(`GENERATOR_ENABLED`, `NEWS_SOURCE=fixture|live`, `NEWS_TOPICS`, `POLL_INTERVAL`,
`MARKETS_PER_HOUR`, `MAX_LIVE_MARKETS`, `CLOSE_WINDOW`, `GENERATOR_TRADING`,
`RESOLVE_YES_BIAS`, `GENERATOR_SEED`).

---

## 2. Prisma schema additions (be-platform owns; migration name `agentic_sprint_markets`)

```prisma
// User — ADD fields (keep all existing):
//   handle  String?  @unique        // url-safe, e.g. "founder", "bot-news"
//   bio     String?
//   isBot   Boolean  @default(false)
//   markets Market[] posts Post[]

model Market {
  id             String   @id @default(cuid())
  marketId       Int      @unique          // on-chain id from MarketFactory
  question       String
  description    String
  category       String                    // generic|world|business|technology|sports|science|entertainment|health|politics|crypto
  imageUrl       String?
  oracleProofUrl String
  marketType     String   @default("FUN")  // FUN | CLASSIC | CHALLENGE
  outcomeYes     String                    // label, e.g. "Yes"
  outcomeNo      String
  closeTime      DateTime
  status         String   @default("LIVE") // LIVE | CLOSED | RESOLVED
  marketAddress  String                    // PredictionMarket address
  ammAddress     String                    // MarketAMM address
  txHash         String?
  creatorId      String
  creator        User     @relation(fields: [creatorId], references: [id])
  posts          Post[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@map("markets")
}

model Post {
  id           String   @id @default(cuid())
  authorId     String
  author       User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  text         String   @db.VarChar(500)
  imageUrl     String?
  marketId     String?                     // FK to Market.id (nullable — plain posts)
  market       Market?  @relation(fields: [marketId], references: [id], onDelete: SetNull)
  likeCount    Int      @default(0)        // display-only counters (engagement API out of scope)
  repostCount  Int      @default(0)
  commentCount Int      @default(0)
  createdAt    DateTime @default(now())
  @@index([createdAt])
  @@map("posts")
}
```

`web/prisma/seed.ts` (be-platform) additionally: gives founder `handle: "founder"`,
`image: "/img/leo.jpg"`, a bio; **backfills the seeded El Clásico market** (marketId 0, addresses
from `contracts/deployments/ganache.json` `seededMarket`, category `sports`,
image `/img/el-classico.png`) and one founder post embedding it. Idempotent upserts only.

---

## 3. Server libs (be-platform owns)

### `web/src/lib/server/chain.ts`

viem-based. Reads `RPC_URL` + `GANACHE_MNEMONIC`. Loads addresses/ABIs from
`contracts/deployments/ganache.json` (path: `path.join(process.cwd(), "..", "contracts", "deployments", "ganache.json")`
with fallback env `DEPLOYMENTS_FILE`). Exports:

```ts
export interface OnChainMarket { marketId: number; marketAddress: `0x${string}`;
  ammAddress: `0x${string}`; txHash: `0x${string}` }
export async function createMarketOnChain(p: { question: string; outcomeYes: string; outcomeNo: string;
  closeTime: Date; oracleProofUrl: string; seedYesUsdc: number; seedNoUsdc: number }): Promise<OnChainMarket>
// uses creator signer (account 6) for createMarket; deployer (account 0) for mint+approve+seed
export async function readMarketPrices(amm: `0x${string}`): Promise<{ priceYes: number; priceNo: number;
  volumeUsdc: number }>   // impliedProbabilityBps/10000; volume = (reserves0+reserves1)/1e6
export async function mintUsdcTo(to: `0x${string}`, amountUsdc: number): Promise<`0x${string}`> // deployer mints
```

### `web/src/lib/server/generatorAuth.ts`

```ts
export function isGeneratorRequest(req: NextRequest): boolean
// true iff header x-generator-key === process.env.GENERATOR_API_KEY (non-empty)
```

### `web/src/lib/server/marketDto.ts`

```ts
export async function toMarketDTO(market: MarketWithCreator): Promise<MarketDTO>
// MarketWithCreator = Prisma Market & { creator: pick(id,name,handle,image,isBot) }
// fetches live prices via readMarketPrices(ammAddress); on chain failure returns priceYes/priceNo
// derived 0.5/0.5 and volumeUsdc 0 (never throw — APIs must not 500 because chain is down)
export async function toMarketDTOs(markets: MarketWithCreator[]): Promise<MarketDTO[]>
```

---

## 4. API contracts (HTTP shapes — FROZEN)

All DTO TypeScript definitions live in **`web/src/lib/client/api.ts`** (written by orchestrator,
already in repo — import, never redefine).

### MarketDTO / PostDTO / UserSummaryDTO — see api.ts. Summary:

```ts
MarketDTO {
  id, marketId, question, description, category, imageUrl, oracleProofUrl,
  marketType, outcomeYes, outcomeNo,
  priceYes, priceNo,          // 0..1 floats, live from AMM
  chancePct,                  // Math.round(priceYes*100)
  volumeUsdc,                 // pool collateral, USDC float
  closeTime, createdAt,       // ISO strings
  status, addresses: { market, amm },
  creator: { id, name, handle, image, isBot }
}
PostDTO { id, text, imageUrl, createdAt, likeCount, repostCount, commentCount,
  author: { id, name, handle, image, isBot }, market: MarketDTO | null }
UserSummaryDTO { id, name, handle, image, bio, isBot, followerCount, followingCount, viewerFollows }
```

### Markets API (be-markets) — `web/src/app/api/markets/`

- `GET /api/markets?category=<cat>&status=<LIVE|...>&cursor=<cuid>&limit=<n≤50, default 20>`
  → `200 { markets: MarketDTO[], nextCursor: string | null }` — newest first.
- `GET /api/markets/[id]` — id is Market.id (cuid) **or** numeric on-chain marketId
  → `200 { market: MarketDTO }` | `404 { error }`.
- `POST /api/markets` — auth: NextAuth session **or** generator key header.
  Body: `{ question (≤120), description, category, imageUrl?, oracleProofUrl (http URL),
  marketType? (FUN|CLASSIC|CHALLENGE), outcomeYes? ("Yes"), outcomeNo? ("No"),
  closeTime (ISO, future), seedYesUsdc? (default 500, 10..10000), seedNoUsdc? (default 500),
  creatorHandle? (generator-key only — upserts bot user `isBot: true`, name from handle),
  createPost? (boolean — also create a feed post embedding the market, text = question) }`
  → `201 { market: MarketDTO }` | `400/401/502 { error }` (502 = chain tx failed).
  Server flow: resolve creator user → `createMarketOnChain` → persist Market → optional Post.
- `POST /api/faucet` — body `{ address: 0x…, amountUsdc?: number (default 100, ≤1000) }`,
  auth: session or generator key → `200 { txHash }`. (Mints MockUSDC via deployer — Ganache only.)

### Posts API (be-posts) — `web/src/app/api/posts/`

- `GET /api/posts?cursor=<cuid>&limit=<n≤50, default 20>`
  → `200 { posts: PostDTO[], nextCursor: string | null }` — newest first, includes author + market DTO.
- `POST /api/posts` — session or generator key.
  Body: `{ text (1..500), imageUrl?, marketId? (Market.id), authorHandle? (generator-key only),
  likeCount?/repostCount?/commentCount? (generator-key only, for demo-realistic numbers) }`
  → `201 { post: PostDTO }` | `400/401/404`.

### Users API (be-users) — `web/src/app/api/users/`

- `GET /api/users?limit=<n≤50, default 20>&bots=<include|exclude (default exclude)>&order=<followers|recent>`
  → `200 { users: UserSummaryDTO[] }` — `followers` (default): follower count desc.
  `viewerFollows` from optional session, else false. Excludes the viewer themself.

Existing frozen routes (do NOT touch): `/api/auth/*`, `/api/profile/[handle]`,
`/api/social/follow`, `/api/wallet`.

---

## 5. Generator workspace (`generator/` — scaffolded, deps installed)

Standalone API client per testing-market-generator.md. TypeScript run with `tsx`, no build step.

- `generator/src/index.ts` — CLI: `--once` (one cycle, default) / `--loop` (poll interval).
- News: live Google News RSS + `generator/fixtures/headlines.json` (~60 canned items across
  topics; `NEWS_SOURCE=fixture` default). Parse with `fast-xml-parser`.
- Dedup store: JSON file `generator/.state/dedup.json` (gitignored).
- Templating per spec Section 4 (subject extraction, category template pools, seedable PRNG —
  use `seedrandom` style LCG implemented inline; log seed at startup; `GENERATOR_SEED` env).
- Marker line: `⚠ Auto-generated test market — resolves randomly. Source headline: "{title}" ({source}, {pubDate})`.
- Creates markets via `POST {API_BASE_URL}/api/markets` with header `x-generator-key`,
  `creatorHandle` one of `bot-news|bot-sports|bot-business`, `createPost: true`, randomized
  `seedYesUsdc/seedNoUsdc` (total 1000, split 20/80..80/20), `closeTime` now+1..30d
  (compressible via `CLOSE_WINDOW`), marketType FUN 70/Classic 20/Challenge 10.
- Images: map category → existing `/img/*` files (sports `/img/el-classico.png`, crypto
  `/img/ETHfullsize.webp`, business `/img/will-microstrategy-purchase-bitcoin-july-1-7-mzoE5TYk_cCI.webp`,
  world/politics `/img/russia-x-ukraine-ceasefire-in-2025-w2voYOygx80B.webp`, fallback `/img/trend1.jpg`).
- Safety rails: API_BASE_URL allowlist (`localhost`, `127.0.0.1`, `*.test`, `*.staging`),
  chain-id check 1337 via RPC, `MARKETS_PER_HOUR` (12) + `MAX_LIVE_MARKETS` (100) caps,
  denylist filter (configurable word list; skip tragedy/violence headlines).
- Trading module (`generator/src/trading/` — **qa-generator-lifecycle owns this dir**):
  bots = Ganache accounts 7–9 derived from mnemonic; deployer (account 0) mints them USDC;
  random small buys (1–25 USDC) on random LIVE generated markets via viem directly against each
  market's AMM (`GET /api/markets` to discover, filter `creator.isBot`). `--once`/`--loop`.
  Exported entry: `generator/src/trading/index.ts`, run via `corepack pnpm -F generator trade`.

File ownership inside generator/: qa-generator-acquisition = everything except `src/trading/`;
qa-generator-lifecycle = `src/trading/` only. package.json/tsconfig pre-created — do not edit
(ask orchestrator to add deps).

---

## 6. Frontend (Feed + Markets pages ONLY — CEO demo)

Shared client lib `web/src/lib/client/api.ts` (frozen): DTO types + `fetchMarkets`, `fetchMarket`,
`fetchPosts`, `fetchUsers`, `requestFaucet`. SWR-less — plain fetch + React state is fine.

- **fe-feed** owns `FeedPage.tsx`, `FeedItem.tsx`, deletes usage of `feedData.ts` (file may stay,
  unused). Feed tab = `fetchPosts` with infinite scroll (IntersectionObserver on the spinner,
  cursor pagination). Follow-Creators carousel + People tab = `fetchUsers` (real users,
  FollowButton with real ids — it already posts to /api/social/follow). Keep exact visual design.
  `FeedPost` type replaced by `PostDTO`; FeedItem renders `MarketCard` when `post.market`.
- **fe-market-card** owns `MarketCard.tsx`, `BuyPanel.tsx`, `MarketInfoCard.tsx`,
  `PositionCard.tsx`, `web/src/app/trade/[id]/page.tsx`, new `web/src/lib/client/useBuyMarket.ts`.
  `MarketCard` prop becomes `{ market: MarketDTO }`. Flip-to-trade Buy executes the real
  approve+buy against `market.addresses.amm` (wagmi, ABIs from `contracts.ts`). "Get Test USDC"
  → `requestFaucet` API (replaces direct mint — mint is onlyOwner and fails for users).
  Trade page fetches `fetchMarket(params.id)` and passes MarketDTO down; BuyPanel/MarketInfoCard/
  PositionCard become parametric (`market: MarketDTO` prop). Payout calc: `amount / price`.
- **fe-markets** owns `web/src/app/markets/page.tsx` + new `web/src/components/markets/*`.
  Catalog grid styled like prototype `market.html`: image, question, chance arc, Yes/No prices,
  volume, close time, link to `/trade/{market.id}`; category filter chips (All + categories
  present); uses `fetchMarkets`.

Rules: client components (`'use client'`), Tailwind classes consistent with existing glass theme,
`next/image` needs no new remote domains (all images are local `/img/*`). next.config images:
unoptimized already? If `next/image` complains about dynamic local paths use `<img>` — acceptable.

---

## 7. Tests (`tests/` workspace — scaffolded, deps installed: vitest, viem, pg)

- qa-test-infra owns `tests/helpers/**` + `tests/vitest.config.ts`:
  `api.ts` (base-url client with cookie jar for NextAuth session: register → csrf → credentials
  callback → session cookie), `generator.ts` (x-generator-key requests), `chain.ts` (viem public
  client + deployer wallet), `db.ts` (pg pool to localhost:5433, cleanup helpers that delete only
  rows created by tests — match by `it-` prefixes; never truncate users/markets wholesale).
- qa-it-markets-trading owns `tests/integration/**`:
  `markets/` (POST /api/markets with generator key → assert 201 DTO shape → on-chain
  `MarketFactory.getMarket(marketId)` matches → GET list contains it → GET detail by cuid and by
  number → prices sum ≈ 1 → faucet mints), `social/posts` (POST/GET posts, embed DTO, 500-char
  reject, pagination), `users/` (list shape, order=followers, bots excluded by default),
  `generator/` (run one fixture-mode generator cycle as a child process with MARKETS_PER_HOUR=3,
  assert ≥1 market created with marker line + bot creator + oracle URL).
- Conventions: FR tags in test names per testing-integration.md 3.2. Suite must run with
  `corepack pnpm -F tests test` against the live local stack (web dev server :3000).

---

## 8. Verification gates (every seat, before reporting done)

1. `cd web && corepack pnpm typecheck && corepack pnpm lint` (or workspace equivalent).
2. TypeScript strict, no `any`.
3. Don't edit files outside your ownership; don't redefine DTOs; report API-shape problems to the
   orchestrator instead of changing api.ts.
