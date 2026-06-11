/**
 * Market generator CLI — news-driven test/demo market creation.
 *
 *   corepack pnpm -F generator generate        # --once (default): one cycle
 *   corepack pnpm -F generator generate:loop   # --loop: poll on POLL_INTERVAL
 *
 * One cycle: safety checks → fetch headlines → dedup filter → denylist filter
 * → template → rate caps (MARKETS_PER_HOUR per cycle, MAX_LIVE_MARKETS total)
 * → create via API → record dedup → log summary.
 *
 * --loop requires GENERATOR_ENABLED=true (master switch); --once always runs.
 * Exit 0 even when 0 markets created (degrade silently); non-zero only when
 * the environment lock refuses.
 */

import { loadConfig, type GeneratorConfig } from './config.js';
import { Prng } from './prng.js';
import { fetchHeadlines, type Headline } from './news.js';
import { DedupStore } from './dedup.js';
import { buildMarket } from './templating.js';
import { environmentLock, filterDenied } from './safety.js';
import { MarketsApiClient } from './api.js';

interface CycleSummary {
  created: number;
  skippedDedup: number;
  skippedDenylist: number;
  skippedRateCap: number;
  failed: number;
}

async function runCycle(config: GeneratorConfig, prng: Prng): Promise<CycleSummary> {
  const summary: CycleSummary = {
    created: 0,
    skippedDedup: 0,
    skippedDenylist: 0,
    skippedRateCap: 0,
    failed: 0,
  };

  const api = new MarketsApiClient(config.apiBaseUrl, config.apiKey);

  // 1. Headlines
  const headlines = await fetchHeadlines(config);
  console.log(`[cycle] fetched ${headlines.length} headlines (source=${config.newsSource})`);

  // 2. Dedup filter
  const dedup = new DedupStore();
  await dedup.load();
  const fresh: Headline[] = [];
  for (const h of headlines) {
    if (dedup.has(h.title)) summary.skippedDedup++;
    else fresh.push(h);
  }

  // 3. Denylist filter
  const safe = filterDenied(fresh);
  summary.skippedDenylist = fresh.length - safe.length;

  // 4. Rate caps
  let budget = config.marketsPerHour; // per-cycle creation cap
  const liveCount = await api.countLiveGeneratedMarkets(config.maxLiveMarkets);
  if (liveCount === null) {
    console.warn('[cycle] could not count live generated markets (API down?) — proceeding with per-cycle cap only');
  } else {
    const headroom = config.maxLiveMarkets - liveCount;
    if (headroom <= 0) {
      console.log(`[cycle] MAX_LIVE_MARKETS reached (${liveCount}/${config.maxLiveMarkets}) — idling`);
      budget = 0;
    } else {
      budget = Math.min(budget, headroom);
    }
  }

  // 5. Template + create
  for (let i = 0; i < safe.length; i++) {
    if (budget <= 0) {
      summary.skippedRateCap += safe.length - i;
      break;
    }
    const headline = safe[i] as Headline;
    const market = buildMarket(headline, prng, config.closeWindow);
    const body = api.buildCreateBody(market, prng);
    const result = await api.createMarket(body);
    if (result.ok) {
      summary.created++;
      budget--;
      dedup.add(headline.title);
      console.log(
        `[cycle] created market #${result.market.marketId} [${market.category}/${market.marketType}] ${market.question}`,
      );
    } else {
      summary.failed++;
      console.error(`[cycle] create failed (${result.status}): ${result.error}`);
      if (result.status === 0 || result.status === 401) {
        // API unreachable or key rejected — no point hammering the rest.
        break;
      }
    }
  }

  // 6. Persist dedup state
  await dedup.save();

  console.log(
    `[cycle] summary: created=${summary.created} skipped(dedup=${summary.skippedDedup}, ` +
      `denylist=${summary.skippedDenylist}, rate-cap=${summary.skippedRateCap}) failed=${summary.failed}`,
  );
  return summary;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const loop = args.includes('--loop');

  const config = loadConfig();
  console.log(
    `[generator] seed=${config.seed}${config.seedWasDerived ? ' (derived from fixed constant — set GENERATOR_SEED to override)' : ''}`,
  );
  console.log(
    `[generator] target=${config.apiBaseUrl} source=${config.newsSource} ` +
      `caps=${config.marketsPerHour}/h,${config.maxLiveMarkets} live ` +
      `closeWindow=${config.closeWindow.minHours}h-${config.closeWindow.maxHours}h`,
  );

  if (loop && !config.enabled) {
    console.log('[generator] GENERATOR_ENABLED is not "true" — loop mode disabled, exiting 0');
    return;
  }

  // Safety: environment lock (allowlist + chain id) — refusal is the only non-zero exit.
  const refusal = await environmentLock({
    apiBaseUrl: config.apiBaseUrl,
    rpcUrl: config.rpcUrl,
    extraAllowedHosts: config.extraAllowedHosts,
  });
  if (refusal !== null) {
    console.error(`[generator] SAFETY LOCK: ${refusal}`);
    process.exitCode = 1;
    return;
  }

  const prng = new Prng(config.seed);

  if (!loop) {
    await runCycle(config, prng);
    return;
  }

  console.log(`[generator] loop mode — polling every ${config.pollIntervalMs / 60000} min`);
  await runCycle(config, prng);
  setInterval(() => {
    runCycle(config, prng).catch((err) => {
      console.error('[generator] cycle error (continuing):', err);
    });
  }, config.pollIntervalMs);
}

main().catch((err) => {
  // Unexpected top-level failure: log but degrade silently (exit 0) unless
  // it was the safety lock (handled above with exitCode=1).
  console.error('[generator] fatal error (degrading silently):', err);
});
