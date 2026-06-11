# tests — API integration suite

Integration tests for PolyMarket Social ("Justify"), run **against the live local stack**
(no mocks): the compose services plus the web dev server. Strategy:
[`documentation_polymarket_social/testing-integration.md`](../documentation_polymarket_social/testing-integration.md);
frozen shapes: [`docs/delivery/agentic-sprint-contracts.md`](../docs/delivery/agentic-sprint-contracts.md).

## Running

1. **Stack up** (Ganache :8545 chain 1337, Postgres host port **5433**, contracts deployed —
   the artifact `contracts/deployments/ganache.json` must exist):

   ```bash
   sg docker -c "docker compose up -d"
   ```

2. **Web dev server** on :3000:

   ```bash
   cd web && corepack pnpm dev
   ```

3. **Run the suite** (from repo root; plain `pnpm` is not on PATH — use corepack):

   ```bash
   corepack pnpm -F tests test          # vitest run
   corepack pnpm -F tests typecheck     # tsc --noEmit
   ```

Configuration is env-overridable (defaults in `helpers/env.ts`):

| Var                | Default                                          |
|--------------------|--------------------------------------------------|
| `API_BASE_URL`     | `http://localhost:3000`                          |
| `RPC_URL`          | `http://localhost:8545`                          |
| `DATABASE_URL`     | `postgresql://justify:justify@localhost:5433/justify` |
| `GENERATOR_API_KEY`| `dev-generator-key`                              |
| `DEPLOYMENTS_FILE` | `<repo>/contracts/deployments/ganache.json`      |

Vitest runs files **sequentially** (one shared DB + one shared chain), tests within a file
sequentially, `testTimeout`/`hookTimeout` 60 s, environment `node`, **no globals** — import
`describe/it/expect` from `vitest` explicitly.

## Conventions (cleanup contract — REQUIRED)

The database is shared with the dev stack; seed data (founder user, seeded El Clásico
market) must survive test runs. `cleanupTestData()` therefore deletes **only** rows that
follow these conventions — anything else a test creates will leak:

- **Test users**: email matching `it-%@test.local`
  (e.g. `it-1718220000000-x4k2q9@test.local`). `registerAndSignIn` generates conforming
  emails by default — use it.
- **Test markets**: `question` starting with **`IT: `** (e.g. `IT: Will the smoke pass?`).
  Markets created by test users are also cleaned regardless of prefix, but generator-key
  creations attribute to bot users — always use the `IT: ` prefix.
- FR tags in test names per testing-integration.md §3.2, e.g.
  `it('rejects over-limit post — FR-FEED-3', ...)`.
- Call `cleanupTestData()` in your suite's `afterAll` (it is idempotent), and
  `closeDb()` in the **last** hook that touches the DB, or the run hangs on the open pool.

## Helper API (`tests/helpers/` — import from `../helpers`)

### `env.ts`

```ts
API_BASE_URL: string                  // http://localhost:3000
RPC_URL: string                       // http://localhost:8545
DATABASE_URL: string                  // postgresql://justify:justify@localhost:5433/justify
GENERATOR_API_KEY: string             // dev-generator-key
DEPLOYMENTS: Deployments              // parsed contracts/deployments/ganache.json
// Deployments = { chainId; contracts: Record<name, { address: `0x${string}`; abi: unknown[] }>;
//                 accounts: { deployer; oracleResolver; traders[]; creator };
//                 seededMarket: { marketId: number } }
```

### `api.ts`

```ts
class ApiClient {
  constructor(baseUrl?: string)                       // default API_BASE_URL
  get<T>(path, headers?): Promise<{ status: number; body: T }>
  post<T>(path, body?, headers?): Promise<{ status: number; body: T }>
  del<T>(path, body?): Promise<{ status: number; body: T }>
  cookie(name): string | undefined                    // inspect the jar
  clearCookies(): void
}
// Cookie jar: set-cookie headers (incl. multiple) are captured automatically and
// sent on every subsequent request — one ApiClient instance = one browser session.

registerAndSignIn(client: ApiClient, opts?: { email?; password?; name? })
  : Promise<{ userId: string; email: string }>
// register → /api/auth/csrf → POST /api/auth/callback/credentials (form-urlencoded)
// → session cookie in the jar → verifies GET /api/auth/session returns user.id.
// Defaults: email `it-${Date.now()}-${rand}@test.local`, password 'integration1234'.

generatorHeaders(): { 'x-generator-key': string }     // for generator-authed POSTs
```

### `chain.ts`

```ts
publicClient                                          // viem PublicClient, chain 1337
getDeployedContract(name): { address: Address; abi: Abi }   // from DEPLOYMENTS
getMarketOnChain(marketId: number): Promise<readonly [Address, Address]>
                                                      // MarketFactory.getMarket → [market, amm]
erc20BalanceOf(address: Address): Promise<bigint>     // MockUSDC, raw units (6 decimals)
readAmmPrices(amm: Address): Promise<{ priceYes: number; priceNo: number }>
                                                      // impliedProbabilityBps / 10000
```

### `db.ts`

```ts
query<R>(text: string, params?: unknown[]): Promise<R[]>   // raw SQL (assertions only)
cleanupTestData(): Promise<void>   // FK-safe delete of test rows ONLY (see conventions)
closeDb(): Promise<void>           // end the pg pool — call once, in the last afterAll
TEST_USER_EMAIL_PATTERN            // 'it-%@test.local'
TEST_MARKET_QUESTION_PREFIX        // 'IT: '
```

## Ownership

- `helpers/**`, `vitest.config.ts`, `integration/harness.smoke.test.ts`, this README —
  **qa-test-infra**. Do not fork helpers; request changes via the orchestrator.
- `integration/**` (everything else) — qa-it-* seats.
