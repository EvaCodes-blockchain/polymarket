/**
 * Tiny seedable PRNG (mulberry32) — local to the trading module so it stays
 * self-contained (testing-market-generator.md Section 4.1: all generator
 * randomness must be seedable/reproducible; seed logged at startup).
 */

export type Rng = () => number;

/** Returns a deterministic generator of floats in [0, 1). */
export function createPrng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [min, max] (inclusive). */
export function randInt(rng: Rng, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    throw new Error(`randInt: invalid range [${min}, ${max}]`);
  }
  return min + Math.floor(rng() * (max - min + 1));
}

/** Uniform pick from a non-empty array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick: empty array");
  const item = items[randInt(rng, 0, items.length - 1)];
  if (item === undefined) throw new Error("pick: index out of range");
  return item;
}

/**
 * Random trade amount in micro-USDC (6 decimals), uniform over
 * [minUsdc * 1e6, maxUsdc * 1e6] inclusive.
 */
export function randomTradeAmountUsdc6(rng: Rng, minUsdc: number, maxUsdc: number): bigint {
  if (!(minUsdc > 0) || !(maxUsdc >= minUsdc)) {
    throw new Error(`randomTradeAmountUsdc6: invalid range [${minUsdc}, ${maxUsdc}] USDC`);
  }
  const min6 = Math.round(minUsdc * 1_000_000);
  const max6 = Math.round(maxUsdc * 1_000_000);
  return BigInt(randInt(rng, min6, max6));
}
