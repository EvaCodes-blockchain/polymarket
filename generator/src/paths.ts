/**
 * Package-root resolution that works in both runtimes this package uses:
 * - tsx in CommonJS mode (package has no "type": "module") → __dirname exists;
 * - vitest/vite-node → falls back to process.cwd(), which is the generator
 *   package dir when run via `corepack pnpm -F generator <script>`.
 */

import path from 'node:path';

export function packageRoot(): string {
  if (typeof __dirname === 'string') {
    // src/ → package root
    return path.join(__dirname, '..');
  }
  return process.cwd();
}
