// PostgreSQL helpers for the integration suite (pg Pool on DATABASE_URL —
// host port 5433 on this machine, see env.ts).
//
// CLEANUP CONTRACT (never wholesale truncation — the database is shared with
// the live dev stack and its seed data, e.g. the founder user and the seeded
// El Clásico market, which must survive every test run):
//
//   - test USERS are identified by email  LIKE 'it-%@test.local'
//   - test MARKETS are identified by question starting with 'IT: '
//     (markets created by test users count as test data too)
//
// Anything a test creates MUST follow these conventions or it will leak.
// `registerAndSignIn` (helpers/api.ts) already produces conforming emails.

import { Pool, type QueryResultRow } from 'pg';

import { DATABASE_URL } from './env';

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

/** Email pattern matching users created by this suite. */
export const TEST_USER_EMAIL_PATTERN = 'it-%@test.local';

/** Question prefix marking markets created by this suite. */
export const TEST_MARKET_QUESTION_PREFIX = 'IT: ';

/**
 * Run a raw SQL query against the application database.
 * Convenience for assertions; mutations in tests should go through the API.
 */
export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<R[]> {
  const result = await pool.query<R>(text, params as unknown[]);
  return result.rows;
}

/**
 * Delete ONLY rows created by tests, in FK-safe order:
 * posts → markets → follows/wallets/accounts/sessions → users.
 *
 * Scope: users with email LIKE 'it-%@test.local'; markets whose question
 * starts with 'IT: ' or whose creator is a test user (markets.creatorId has
 * no ON DELETE CASCADE, so they must go before their creators).
 */
export async function cleanupTestData(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const testUsers = `SELECT id FROM users WHERE email LIKE $1`;
    const testMarkets = `SELECT id FROM markets WHERE question LIKE $2 OR "creatorId" IN (${testUsers})`;

    // 1. posts authored by test users or embedding test markets
    await client.query(
      `DELETE FROM posts WHERE "authorId" IN (${testUsers}) OR "marketId" IN (${testMarkets})`,
      [TEST_USER_EMAIL_PATTERN, `${TEST_MARKET_QUESTION_PREFIX}%`],
    );

    // 2. test markets (question prefix or test-user creator)
    await client.query(
      `DELETE FROM markets WHERE question LIKE $2 OR "creatorId" IN (${testUsers})`,
      [TEST_USER_EMAIL_PATTERN, `${TEST_MARKET_QUESTION_PREFIX}%`],
    );

    // 3. relations hanging off test users
    await client.query(
      `DELETE FROM follows WHERE "followerId" IN (${testUsers}) OR "followeeId" IN (${testUsers})`,
      [TEST_USER_EMAIL_PATTERN],
    );
    await client.query(`DELETE FROM wallets WHERE "userId" IN (${testUsers})`, [
      TEST_USER_EMAIL_PATTERN,
    ]);
    await client.query(`DELETE FROM accounts WHERE "userId" IN (${testUsers})`, [
      TEST_USER_EMAIL_PATTERN,
    ]);
    await client.query(`DELETE FROM sessions WHERE "userId" IN (${testUsers})`, [
      TEST_USER_EMAIL_PATTERN,
    ]);

    // 4. the test users themselves
    await client.query(`DELETE FROM users WHERE email LIKE $1`, [TEST_USER_EMAIL_PATTERN]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** End the pool. Call once in the suite's last afterAll, or the run may hang. */
export async function closeDb(): Promise<void> {
  await pool.end();
}
