// Harness self-test (owned by qa-test-infra) — verifies the shared helpers work
// against the live local stack before any feature suite depends on them:
//
//   1. auth round-trip: register → csrf → credentials callback → session (FR-AUTH-1)
//   2. chain reads: MarketFactory.getMarket(seeded) + AMM implied prices (FR-MKT-1)
//   3. db cleanup deletes only it-%@test.local rows and never seed data

import { afterAll, describe, expect, it } from 'vitest';

import {
  ApiClient,
  DEPLOYMENTS,
  cleanupTestData,
  closeDb,
  erc20BalanceOf,
  getMarketOnChain,
  publicClient,
  query,
  readAmmPrices,
  registerAndSignIn,
} from '../helpers';

describe('harness smoke', () => {
  afterAll(async () => {
    await cleanupTestData();
    await closeDb();
  });

  it('auth helper: registerAndSignIn round-trips against the live web server', async () => {
    const client = new ApiClient();
    const user = await registerAndSignIn(client);

    expect(user.userId).toBeTruthy();
    expect(user.email).toMatch(/^it-.*@test\.local$/);

    // The session cookie in the jar authenticates subsequent requests.
    const session = await client.get<{ user?: { id?: string; email?: string } }>(
      '/api/auth/session',
    );
    expect(session.status).toBe(200);
    expect(session.body.user?.id).toBe(user.userId);

    // And the user exists in the database.
    const rows = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      user.email,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(user.userId);
  });

  it('chain helper: reads the seeded market and its AMM prices from Ganache', async () => {
    expect(await publicClient.getChainId()).toBe(DEPLOYMENTS.chainId);
    expect(DEPLOYMENTS.chainId).toBe(1337);

    const [marketAddress, ammAddress] = await getMarketOnChain(DEPLOYMENTS.seededMarket.marketId);
    expect(marketAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(ammAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const { priceYes, priceNo } = await readAmmPrices(ammAddress);
    expect(priceYes).toBeGreaterThan(0);
    expect(priceYes).toBeLessThan(1);
    expect(priceNo).toBeGreaterThan(0);
    expect(priceNo).toBeLessThan(1);
    // CPMM: complementary prices sum to ~1 (integer bps rounding tolerance).
    expect(priceYes + priceNo).toBeGreaterThan(0.999);
    expect(priceYes + priceNo).toBeLessThan(1.001);

    // ERC-20 read helper works (trader account 2 is pre-funded with MockUSDC).
    const trader = DEPLOYMENTS.accounts.traders[0];
    expect(trader).toBeTruthy();
    const balance = await erc20BalanceOf(trader as `0x${string}`);
    expect(balance).toBeGreaterThanOrEqual(0n);
  });

  it('db helper: cleanupTestData removes test users without touching seed data', async () => {
    const client = new ApiClient();
    const user = await registerAndSignIn(client);

    const seedUsersBefore = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM users WHERE email NOT LIKE 'it-%@test.local'",
    );

    await cleanupTestData();

    const gone = await query<{ id: string }>('SELECT id FROM users WHERE id = $1', [user.userId]);
    expect(gone).toHaveLength(0);

    const leftovers = await query<{ id: string }>(
      "SELECT id FROM users WHERE email LIKE 'it-%@test.local'",
    );
    expect(leftovers).toHaveLength(0);

    const seedUsersAfter = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM users WHERE email NOT LIKE 'it-%@test.local'",
    );
    expect(seedUsersAfter[0]?.n).toBe(seedUsersBefore[0]?.n);
  });
});
