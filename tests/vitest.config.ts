// Vitest configuration for the integration-test workspace.
//
// The suite runs against the LIVE local stack (compose Ganache :8545, Postgres :5433,
// web dev server :3000) — never against mocks. Determinism rules:
//   - tests within a file run sequentially (no concurrent tests);
//   - files also run one at a time (shared DB + shared chain state);
//   - generous timeouts because every test crosses HTTP + Postgres + Ganache.
//
// No globals: tests import { describe, it, expect, ... } from 'vitest' explicitly.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Sequential execution within files (no test-level concurrency)...
    sequence: { concurrent: false },
    // ...and across files: all suites share one database and one chain.
    fileParallelism: false,
  },
});
