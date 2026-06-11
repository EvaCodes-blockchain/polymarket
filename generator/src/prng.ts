/**
 * Small seedable PRNG — mulberry32 over a string-hashed seed (xmur3).
 * Pure TypeScript, no dependencies. All generator randomness flows through
 * this so a dataset is exactly reproducible from GENERATOR_SEED
 * (testing-market-generator.md Section 4.1 / Section 8 determinism check).
 */

/** xmur3 string hash — produces a 32-bit seed from an arbitrary string. */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 — fast 32-bit state PRNG returning floats in [0, 1). */
export function mulberry32(a: number): () => number {
  let state = a >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Prng {
  private readonly rand: () => number;

  constructor(seed: string) {
    this.rand = mulberry32(hashSeed(seed));
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.rand();
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Prng.int: max (${max}) < min (${min})`);
    return min + Math.floor(this.rand() * (max - min + 1));
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.rand() * (max - min);
  }

  /** Pick one element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Prng.pick: empty array');
    const idx = this.int(0, items.length - 1);
    return items[idx] as T;
  }
}
