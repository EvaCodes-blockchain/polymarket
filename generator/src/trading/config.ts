/**
 * Trading-module configuration (env parsing).
 *
 * Self-contained on purpose: the trading module (`src/trading/**`) is owned by
 * qa-generator-lifecycle and must not import from sibling generator dirs that
 * may not exist yet (single-writer rule). Knobs per
 * documentation_polymarket_social/testing-market-generator.md Section 7 and the
 * frozen sprint contracts (docs/delivery/agentic-sprint-contracts.md Section 5).
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface TradingConfig {
  /** Target environment, validated against the allowlist before any call. */
  readonly apiBaseUrl: string;
  /** JSON-RPC endpoint (Ganache, chain id 1337). */
  readonly rpcUrl: string;
  /** Mnemonic the bot trader accounts (indices 7-9) + deployer (0) derive from. */
  readonly mnemonic: string;
  /** `GENERATOR_TRADING === "on"` — required for --loop; --once always runs. */
  readonly tradingEnabled: boolean;
  readonly tradesPerCycle: number;
  /** Inclusive bounds for a single random buy, in whole USDC. */
  readonly tradeMinUsdc: number;
  readonly tradeMaxUsdc: number;
  /** Pause between cycles in --loop mode. */
  readonly tradeIntervalMs: number;
  /** PRNG seed (logged at startup; settable via GENERATOR_SEED). */
  readonly seed: number;
  /** True when GENERATOR_SEED was explicitly provided. */
  readonly seedWasProvided: boolean;
  /** Optional override for contracts/deployments/ganache.json. */
  readonly deploymentsFile: string | undefined;
  /**
   * Extra hostnames permitted by the environment lock, beyond the built-in
   * allowlist (comma-separated EXTRA_ALLOWED_HOSTS; compose runs with
   * API_BASE_URL=http://web:3000 and EXTRA_ALLOWED_HOSTS=web).
   */
  readonly extraAllowedHosts: readonly string[];
}

/** Mnemonic used by docker-compose Ganache (`--wallet.mnemonic=...`). */
export const DEFAULT_MNEMONIC =
  "justify social prediction market mvp test test test test test test junk";

export const DEFAULT_API_BASE_URL = "http://localhost:3000";
export const DEFAULT_RPC_URL = "http://localhost:8545";
export const DEFAULT_TRADES_PER_CYCLE = 5;
export const DEFAULT_TRADE_MIN_USDC = 1;
export const DEFAULT_TRADE_MAX_USDC = 25;
export const DEFAULT_TRADE_INTERVAL_MS = 60_000;

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function parsePositiveNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive number, got "${raw}"`);
  }
  return value;
}

const DURATION_RE = /^(\d+)(ms|s|m|h)?$/;
const DURATION_UNIT_MS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

/** Parses "500ms" | "60s" | "5m" | "1h" | "60" (bare number = seconds). */
export function parseDurationMs(name: string, raw: string | undefined, fallbackMs: number): number {
  if (raw === undefined || raw.trim() === "") return fallbackMs;
  const match = DURATION_RE.exec(raw.trim());
  if (match === null || match[1] === undefined) {
    throw new ConfigError(`${name} must look like "60s", "5m" or a number of seconds, got "${raw}"`);
  }
  const unit = match[2] ?? "s";
  const factor = DURATION_UNIT_MS[unit];
  if (factor === undefined) {
    throw new ConfigError(`${name} has unknown duration unit "${unit}"`);
  }
  const value = Number(match[1]) * factor;
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive duration, got "${raw}"`);
  }
  return value;
}

export function loadTradingConfig(env: NodeJS.ProcessEnv = process.env): TradingConfig {
  const apiBaseUrl = env.API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const rpcUrl = env.RPC_URL?.trim() || DEFAULT_RPC_URL;
  const mnemonic = env.GANACHE_MNEMONIC?.trim() || DEFAULT_MNEMONIC;
  const tradingEnabled = (env.GENERATOR_TRADING ?? "").trim().toLowerCase() === "on";

  const tradesPerCycle = parsePositiveInt(
    "TRADES_PER_CYCLE",
    env.TRADES_PER_CYCLE,
    DEFAULT_TRADES_PER_CYCLE,
  );
  const tradeMinUsdc = parsePositiveNumber(
    "TRADE_MIN_USDC",
    env.TRADE_MIN_USDC,
    DEFAULT_TRADE_MIN_USDC,
  );
  const tradeMaxUsdc = parsePositiveNumber(
    "TRADE_MAX_USDC",
    env.TRADE_MAX_USDC,
    DEFAULT_TRADE_MAX_USDC,
  );
  if (tradeMinUsdc > tradeMaxUsdc) {
    throw new ConfigError(
      `TRADE_MIN_USDC (${tradeMinUsdc}) must be <= TRADE_MAX_USDC (${tradeMaxUsdc})`,
    );
  }
  const tradeIntervalMs = parseDurationMs(
    "TRADE_INTERVAL",
    env.TRADE_INTERVAL,
    DEFAULT_TRADE_INTERVAL_MS,
  );

  const rawSeed = env.GENERATOR_SEED?.trim();
  const seedWasProvided = rawSeed !== undefined && rawSeed !== "";
  let seed: number;
  if (seedWasProvided) {
    seed = Number(rawSeed);
    if (!Number.isInteger(seed)) {
      throw new ConfigError(`GENERATOR_SEED must be an integer, got "${rawSeed ?? ""}"`);
    }
  } else {
    seed = Math.floor(Math.random() * 0x7fff_ffff);
  }

  const deploymentsFile = env.DEPLOYMENTS_FILE?.trim() || undefined;

  const extraAllowedHosts = (env.EXTRA_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== "");

  return {
    apiBaseUrl,
    rpcUrl,
    mnemonic,
    tradingEnabled,
    tradesPerCycle,
    tradeMinUsdc,
    tradeMaxUsdc,
    tradeIntervalMs,
    seed,
    seedWasProvided,
    deploymentsFile,
    extraAllowedHosts,
  };
}
