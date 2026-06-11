/**
 * Playwright global setup.
 *
 * 1. Resets wallet bindings in the DB so trader accounts can be re-bound
 *    across repeated local test runs without 409 conflicts.
 * 2. Mints test USDC to each trader account (indices 2-9) from the deployer
 *    (account index 0, the MockUSDC owner), so BuyPanel's "Get Test USDC"
 *    works even though mint() is onlyOwner.
 *
 * Uses raw JSON-RPC for Ganache and docker exec for the DB reset.
 */

import { request } from '@playwright/test';
import { execSync } from 'child_process';

const GANACHE_RPC_URL = process.env['GANACHE_RPC_URL'] ?? 'http://localhost:8545';
// 10,000 USDC per account (6 decimals = 10_000 * 1_000_000)
const MINT_AMOUNT = BigInt(10_000) * BigInt(1_000_000);
const MockUSDC = '0xAF7244998ee2969df3D436935E455934121da5C0';
// Indices to pre-fund (covers all test-reserved trader slots 2-9)
const TRADER_INDICES = [2, 3, 4, 5, 6, 7, 8, 9];
// Postgres connection inside the compose network — available from host
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://justify:justify@localhost:5432/justify';

export default async function globalSetup(): Promise<void> {
  // ── 1. Reset wallet bindings so trader addresses can be reused ─────────────
  //
  // In CI: the DB is freshly seeded, so this is a no-op.
  // Locally: repeated runs bind the same Ganache address to DIFFERENT new users
  // which triggers 409. We delete all Wallet records so each run starts clean.
  try {
    execSync(
      `psql "${DATABASE_URL}" -c "DELETE FROM wallets;"`,
      { stdio: 'pipe' },
    );
    console.log('[global-setup] Wallet table cleared');
  } catch (_) {
    // psql may not be installed; fall back to docker exec
    try {
      execSync(
        'docker exec polymarket-social-postgres-1 psql -U justify -d justify -c "DELETE FROM wallets;"',
        { stdio: 'pipe' },
      );
      console.log('[global-setup] Wallet table cleared via docker exec');
    } catch (err2) {
      console.warn('[global-setup] Could not reset wallet table:', (err2 as Error).message?.slice(0, 100));
    }
  }

  // ── 2. Pre-mint USDC to all trader accounts from the deployer ─────────────
  const ctx = await request.newContext();

  async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
    const res = await ctx.post(GANACHE_RPC_URL, {
      data: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      headers: { 'content-type': 'application/json' },
    });
    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
    return json.result;
  }

  const accounts = (await rpcCall('eth_accounts', [])) as string[];
  const deployer = accounts[0]; // owner of MockUSDC
  console.log('[global-setup] Pre-minting USDC from deployer:', deployer);

  // mint(address to, uint256 amount) selector = 0x40c10f19
  const mintSelector = '0x40c10f19';
  const amountHex = MINT_AMOUNT.toString(16).padStart(64, '0');

  for (const idx of TRADER_INDICES) {
    const trader = accounts[idx];
    if (!trader) continue;
    const paddedTrader = trader.slice(2).toLowerCase().padStart(64, '0');
    const data = mintSelector + paddedTrader + amountHex;

    try {
      const txHash = (await rpcCall('eth_sendTransaction', [{
        from: deployer,
        to: MockUSDC,
        data,
        gas: '0x30000',
      }])) as string;

      // Wait for receipt (up to 5 s)
      let receipt = null;
      for (let i = 0; i < 10; i++) {
        receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);
        if (receipt !== null) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const status = (receipt as { status?: string } | null)?.status;
      console.log(`[global-setup] Minted USDC to index ${idx} (${trader.slice(0, 10)}...): ${status}`);
    } catch (err) {
      console.warn(`[global-setup] Mint to index ${idx} failed:`, (err as Error).message);
    }
  }

  await ctx.dispose();
}
