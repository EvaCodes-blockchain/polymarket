import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for CEO demo path smoke test.
 *
 * Runs against the compose stack (web on :3000).
 * Set E2E_BASE_URL env var to override (default: http://localhost:3000).
 */
export default defineConfig({
  globalSetup: './fixtures/global-setup.ts',
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on',
    video: 'on',
    screenshot: 'only-on-failure',
    // Longer timeouts for blockchain tx confirmations
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
  outputDir: 'test-results',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
