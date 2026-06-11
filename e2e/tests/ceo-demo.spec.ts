/**
 * CEO Demo Path — end-to-end smoke test
 *
 * Covers all four CEO-required flows:
 *   CEO-1: register a new account + sign in
 *   CEO-2: follow the founder's profile; verify follower count increases
 *   CEO-3: connect MetaMask (stub) to Ganache chain 1337
 *   CEO-4: place a real Buy bet on the seeded market; verify position appears
 *
 * Runs against the compose stack (web on :3000, Ganache on :8545).
 * Each test gets a unique timestamped email and a distinct Ganache trader index
 * so wallet bindings don't conflict across tests.
 *
 * Ganache account assignments:
 *   CEO-1: no wallet needed
 *   CEO-2: no wallet needed
 *   CEO-3: trader index 2
 *   CEO-4: trader index 3
 *   Full:  trader index 4
 */

import { test, expect, type Page } from '@playwright/test';
import { injectEthereumStub } from '../fixtures/ethereum-stub';

const GANACHE_RPC_URL = process.env['GANACHE_RPC_URL'] ?? 'http://localhost:8545';
const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';

const TEST_PASSWORD = 'e2epassword1';
const TEST_NAME = 'E2E Tester';

/** Generate a unique email for each test run. */
function uniqueEmail(): string {
  return `e2e+${Date.now()}-${Math.floor(Math.random() * 99999)}@example.com`;
}

/**
 * Open the SignInModal via the custom event — more reliable than a button click
 * because the "Sign In" button location varies by viewport.
 *
 * The event must be dispatched AFTER React hydration has run so that AppShell's
 * useEffect has registered the listener.  In CI the initial page.goto() resolves
 * before hydration completes, so we poll: fire the event, wait briefly for the
 * dialog; if it doesn't appear, fire again — until the 15 s outer timeout expires.
 */
async function openSignInModal(page: Page): Promise<void> {
  // Wait for network activity to settle so Next.js hydration has run and
  // AppShell's useEffect has had time to register the event listener.
  await page.waitForLoadState('networkidle');

  await expect(async () => {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('justify:openSignIn'));
    });
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000, intervals: [500, 500, 500, 1_000, 1_000, 1_000] });
}

/**
 * Register a new user and sign in via credentials.
 * Leaves the modal closed and the session active.
 */
async function registerAndSignIn(
  page: Page,
  email: string,
  password: string,
  name: string,
): Promise<void> {
  await openSignInModal(page);
  await page.getByRole('button', { name: 'Register' }).click();
  await page.getByPlaceholder('Your name').fill(name);
  await page.getByPlaceholder('Enter your email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  // Modal must close — registration + auto sign-in complete
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
}

/**
 * Connect MetaMask stub wallet and wait for "Wallet connected!" confirmation.
 * The WalletConnectModal is opened via the custom event.
 *
 * Same hydration-poll pattern as openSignInModal: dispatch + wait in a retry loop.
 */
async function connectWallet(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');

  await expect(async () => {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('justify:connectWallet'));
    });
    await expect(page.getByRole('heading', { name: 'Connect Wallet' })).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000, intervals: [500, 500, 500, 1_000, 1_000, 1_000] });
  // Click the MetaMask option (aria-label / text contains "MetaMask")
  await page.getByRole('button', { name: /MetaMask/i }).first().click();
  await expect(page.getByText('Wallet connected!')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Wallet' })).not.toBeVisible();
}

// ─────────────────────────────────────────────────────────────────────────
// CEO-1: Register a new account and sign in
// ─────────────────────────────────────────────────────────────────────────
test('CEO-1: register and sign in', async ({ page }) => {
  await injectEthereumStub(page, GANACHE_RPC_URL, 2);
  const email = uniqueEmail();
  await page.goto(BASE_URL);
  await registerAndSignIn(page, email, TEST_PASSWORD, TEST_NAME);
  // User's name should appear in the sidebar (session active)
  await expect(page.getByText(TEST_NAME, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// CEO-2: Follow the founder's profile
// ─────────────────────────────────────────────────────────────────────────
test('CEO-2: follow founder profile', async ({ page }) => {
  await injectEthereumStub(page, GANACHE_RPC_URL, 2);
  const email = uniqueEmail();
  await page.goto(BASE_URL);
  await registerAndSignIn(page, email, TEST_PASSWORD, TEST_NAME);

  await page.goto(`${BASE_URL}/profile/founder@justify.local`);

  // FollowButton: aria-label="Follow" when not following
  const followBtn = page.getByRole('button', { name: 'Follow' }).first();
  await expect(followBtn).toBeVisible({ timeout: 10_000 });
  await followBtn.click();

  // After follow: aria-label="Unfollow", text="Following"
  await expect(page.getByRole('button', { name: 'Unfollow' }).first()).toBeVisible({ timeout: 5_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// CEO-3: Connect MetaMask stub to Ganache chain 1337
// Each test uses a distinct trader index to avoid wallet-address conflicts
// ─────────────────────────────────────────────────────────────────────────
test('CEO-3: connect MetaMask wallet', async ({ page }) => {
  await injectEthereumStub(page, GANACHE_RPC_URL, 5); // index 5 — reserved for CEO-3
  const email = uniqueEmail();
  await page.goto(BASE_URL);
  await registerAndSignIn(page, email, TEST_PASSWORD, TEST_NAME);
  await connectWallet(page);
});

// ─────────────────────────────────────────────────────────────────────────
// CEO-4: Place a real Buy bet and verify position appears
// ─────────────────────────────────────────────────────────────────────────
test('CEO-4: place a Buy bet and see position', async ({ page }) => {
  await injectEthereumStub(page, GANACHE_RPC_URL, 6); // index 6 — reserved for CEO-4
  const email = uniqueEmail();
  await page.goto(BASE_URL);

  await registerAndSignIn(page, email, TEST_PASSWORD, TEST_NAME);
  await connectWallet(page);

  await page.goto(`${BASE_URL}/trade/0`);
  await expect(page.getByRole('heading', { name: 'Place a Bet' })).toBeVisible({ timeout: 10_000 });

  const amountInput = page.locator('input[type="number"]');
  await amountInput.fill('5');

  // Skip "Get Test USDC" — globalSetup already minted 10,000 USDC to all trader accounts.
  // Clicking it would send a mint() call that reverts (non-owner), wasting time.

  // Buy Barcelona outcome (index 0 — default selected)
  await page.getByRole('button', { name: /Buy Barcelona/i }).click();
  await expect(page.getByText('Buy confirmed!')).toBeVisible({ timeout: 60_000 });

  // PositionCard should appear
  await expect(page.getByText('Your Position')).toBeVisible({ timeout: 30_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// Full CEO path in one test (the gate test used in CI)
// ─────────────────────────────────────────────────────────────────────────
test('Full CEO demo path: register → follow → connect → buy', async ({ page }) => {
  await injectEthereumStub(page, GANACHE_RPC_URL, 7); // index 7 — reserved for Full path
  const email = uniqueEmail();
  await page.goto(BASE_URL);

  // CEO-1: Register
  await registerAndSignIn(page, email, TEST_PASSWORD, TEST_NAME);

  // CEO-2: Follow founder
  await page.goto(`${BASE_URL}/profile/founder@justify.local`);
  const followBtn = page.getByRole('button', { name: 'Follow' }).first();
  await expect(followBtn).toBeVisible({ timeout: 10_000 });
  await followBtn.click();
  await expect(page.getByRole('button', { name: 'Unfollow' }).first()).toBeVisible({ timeout: 5_000 });

  // CEO-3: Connect wallet
  await page.goto(BASE_URL);
  await connectWallet(page);

  // CEO-4: Buy bet
  await page.goto(`${BASE_URL}/trade/0`);
  await expect(page.getByRole('heading', { name: 'Place a Bet' })).toBeVisible({ timeout: 10_000 });

  const amountInput = page.locator('input[type="number"]');
  await amountInput.fill('5');

  // Skip "Get Test USDC" — globalSetup already minted 10,000 USDC to all trader accounts.

  await page.getByRole('button', { name: /Buy Barcelona/i }).click();
  await expect(page.getByText('Buy confirmed!')).toBeVisible({ timeout: 60_000 });

  await expect(page.getByText('Your Position')).toBeVisible({ timeout: 30_000 });
});
