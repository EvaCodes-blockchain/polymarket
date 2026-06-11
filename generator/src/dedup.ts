/**
 * Deduplication store — testing-market-generator.md Section 3.3.
 *
 * JSON file of normalized-headline hashes at generator/.state/dedup.json
 * (the .state/ dir is gitignored and wiped with the environment).
 * The generator is the only writer.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { packageRoot } from './paths.js';

const DEFAULT_STORE_PATH = path.join(packageRoot(), '.state', 'dedup.json');

/** Lowercase + collapse all whitespace runs to single spaces + trim. */
export function normalizeHeadline(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** FNV-1a 32-bit hash of the normalized headline, hex-encoded. */
export function hashHeadline(title: string): string {
  const normalized = normalizeHeadline(title);
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

interface DedupFile {
  hashes: string[];
}

export class DedupStore {
  private readonly hashes = new Set<string>();

  constructor(private readonly storePath: string = DEFAULT_STORE_PATH) {}

  async load(): Promise<void> {
    this.hashes.clear();
    try {
      const raw = await readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw) as DedupFile;
      if (Array.isArray(parsed.hashes)) {
        for (const h of parsed.hashes) {
          if (typeof h === 'string') this.hashes.add(h);
        }
      }
    } catch {
      // Missing or corrupt store — start fresh (it is regenerable test state).
    }
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const payload: DedupFile = { hashes: [...this.hashes].sort() };
    await writeFile(this.storePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  has(title: string): boolean {
    return this.hashes.has(hashHeadline(title));
  }

  add(title: string): void {
    this.hashes.add(hashHeadline(title));
  }

  get size(): number {
    return this.hashes.size;
  }
}
