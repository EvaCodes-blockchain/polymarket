/**
 * Generator configuration — environment variables per
 * documentation_polymarket_social/testing-market-generator.md Section 7.
 *
 * Note: GENERATOR_ENABLED is the master switch for --loop mode only;
 * --once always runs (it is the dev/test entry point).
 */

export const NEWS_TOPICS = [
  'WORLD',
  'BUSINESS',
  'TECHNOLOGY',
  'SPORTS',
  'SCIENCE',
  'ENTERTAINMENT',
  'HEALTH',
] as const;

export type NewsTopic = (typeof NEWS_TOPICS)[number];

export type NewsSource = 'fixture' | 'live';

export interface CloseWindow {
  /** Minimum close offset from now, in hours. */
  minHours: number;
  /** Maximum close offset from now, in hours. */
  maxHours: number;
}

export interface GeneratorConfig {
  /** Master switch — enforced in --loop mode only. */
  enabled: boolean;
  newsSource: NewsSource;
  apiBaseUrl: string;
  apiKey: string;
  rpcUrl: string;
  marketsPerHour: number;
  maxLiveMarkets: number;
  closeWindow: CloseWindow;
  seed: string;
  /** True when GENERATOR_SEED was unset and the seed was derived from the fixed constant. */
  seedWasDerived: boolean;
  topics: readonly NewsTopic[];
  pollIntervalMs: number;
  resolveYesBias: number;
  /**
   * Extra hostnames permitted by the environment lock, from EXTRA_ALLOWED_HOSTS
   * (comma-separated). Needed inside docker compose where the API base URL is
   * http://web:3000 (the service sets EXTRA_ALLOWED_HOSTS=web).
   */
  extraAllowedHosts: readonly string[];
}

/** Fixed constant used to derive a seed when GENERATOR_SEED is unset. */
export const DEFAULT_SEED_CONSTANT = 'justify-market-generator-v1';

const DURATION_UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parse a duration token like "15m", "1h", "30d" into milliseconds. */
export function parseDuration(token: string): number {
  const match = /^(\d+)([smhd])$/.exec(token.trim());
  if (!match) {
    throw new Error(`Invalid duration "${token}" — expected <number><s|m|h|d>`);
  }
  const value = Number(match[1]);
  const unit = match[2] as string;
  const unitMs = DURATION_UNIT_MS[unit];
  if (unitMs === undefined) {
    throw new Error(`Invalid duration unit in "${token}"`);
  }
  return value * unitMs;
}

/**
 * Parse a close-window spec "<min><unit>-<max><unit>" with h/d units,
 * e.g. "1d-30d" or "2h-48h".
 */
export function parseCloseWindow(spec: string): CloseWindow {
  const match = /^(\d+)([hd])-(\d+)([hd])$/.exec(spec.trim());
  if (!match) {
    throw new Error(`Invalid CLOSE_WINDOW "${spec}" — expected e.g. "1d-30d" or "2h-48h"`);
  }
  const toHours = (value: string, unit: string): number =>
    Number(value) * (unit === 'd' ? 24 : 1);
  const minHours = toHours(match[1] as string, match[2] as string);
  const maxHours = toHours(match[3] as string, match[4] as string);
  if (minHours <= 0 || maxHours < minHours) {
    throw new Error(`Invalid CLOSE_WINDOW "${spec}" — min must be > 0 and max >= min`);
  }
  return { minHours, maxHours };
}

function parseTopics(raw: string | undefined): readonly NewsTopic[] {
  if (!raw || raw.trim() === '') return NEWS_TOPICS;
  const wanted = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0);
  const valid = wanted.filter((t): t is NewsTopic =>
    (NEWS_TOPICS as readonly string[]).includes(t),
  );
  if (valid.length === 0) {
    throw new Error(`NEWS_TOPICS "${raw}" contains no valid topics (${NEWS_TOPICS.join(', ')})`);
  }
  return valid;
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GeneratorConfig {
  const newsSourceRaw = env.NEWS_SOURCE ?? 'fixture';
  if (newsSourceRaw !== 'fixture' && newsSourceRaw !== 'live') {
    throw new Error(`NEWS_SOURCE must be "fixture" or "live", got "${newsSourceRaw}"`);
  }

  const seedRaw = env.GENERATOR_SEED?.trim() ?? '';
  const seedWasDerived = seedRaw === '';
  const seed = seedWasDerived ? DEFAULT_SEED_CONSTANT : seedRaw;

  const resolveYesBias = env.RESOLVE_YES_BIAS ? Number(env.RESOLVE_YES_BIAS) : 0.5;
  if (Number.isNaN(resolveYesBias) || resolveYesBias < 0 || resolveYesBias > 1) {
    throw new Error(`RESOLVE_YES_BIAS must be in [0,1], got "${env.RESOLVE_YES_BIAS ?? ''}"`);
  }

  return {
    enabled: env.GENERATOR_ENABLED === 'true',
    newsSource: newsSourceRaw,
    apiBaseUrl: (env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    apiKey: env.GENERATOR_API_KEY ?? 'dev-generator-key',
    rpcUrl: env.RPC_URL ?? 'http://localhost:8545',
    marketsPerHour: parsePositiveInt(env.MARKETS_PER_HOUR, 12, 'MARKETS_PER_HOUR'),
    maxLiveMarkets: parsePositiveInt(env.MAX_LIVE_MARKETS, 100, 'MAX_LIVE_MARKETS'),
    closeWindow: parseCloseWindow(env.CLOSE_WINDOW ?? '1d-30d'),
    seed,
    seedWasDerived,
    topics: parseTopics(env.NEWS_TOPICS),
    pollIntervalMs: parseDuration(env.POLL_INTERVAL ?? '15m'),
    resolveYesBias,
    extraAllowedHosts: (env.EXTRA_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0),
  };
}
