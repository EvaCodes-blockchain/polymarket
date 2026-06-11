/**
 * Background-trading entry point (testing-market-generator.md Section 5.2):
 * bot trader accounts (Ganache 7-9) place small random buys on random LIVE
 * generated markets so prices keep moving in demo/test environments.
 *
 * CLI: `--once` (default; one cycle, always runs) / `--loop`
 * (requires GENERATOR_TRADING=on; repeats every TRADE_INTERVAL).
 * Run via: corepack pnpm -F generator trade
 *
 * Safety: environment lock first (allowlisted API_BASE_URL + chain ID 1337) —
 * refuses with a non-zero exit otherwise. Single-trade errors are logged and
 * skipped; a cycle never crashes the process.
 */

import { parseEventLogs, type Address } from "viem";
import { loadTradingConfig, ConfigError, type TradingConfig } from "./config";
import { assertEnvironmentLock, EnvLockError } from "./envLock";
import { loadDeployments, DeploymentsError, type DeploymentArtifacts } from "./deployments";
import { discoverTradableMarkets, MarketsApiError, type TradableMarket } from "./markets";
import { createTradingWallets, type BotWallet, type TradingWallets } from "./wallets";
import { createPrng, pick, randInt, randomTradeAmountUsdc6, type Rng } from "./prng";

const MINT_TOPUP_USDC6 = 1_000n * 1_000_000n; // deployer mints 1000 USDC to a broke bot

function log(message: string): void {
  console.log(`[trading] ${message}`);
}

function logError(message: string): void {
  console.error(`[trading] ${message}`);
}

function truncate(text: string, max = 48): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatUsdc(amount6: bigint): string {
  return `${(Number(amount6) / 1_000_000).toFixed(2)} USDC`;
}

function extractSharesOut(args: unknown): bigint | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const sharesOut = (args as Record<string, unknown>).sharesOut;
  return typeof sharesOut === "bigint" ? sharesOut : undefined;
}

async function ensureBotFunded(
  wallets: TradingWallets,
  artifacts: DeploymentArtifacts,
  bot: BotWallet,
  needed6: bigint,
): Promise<void> {
  const balance = (await wallets.publicClient.readContract({
    address: artifacts.usdcAddress,
    abi: artifacts.usdcAbi,
    functionName: "balanceOf",
    args: [bot.account.address],
  })) as bigint;
  if (balance >= needed6) return;

  log(
    `${bot.label} balance ${formatUsdc(balance)} < ${formatUsdc(needed6)} — ` +
      `deployer mints ${formatUsdc(MINT_TOPUP_USDC6)}`,
  );
  const mintHash = await wallets.deployer.client.writeContract({
    address: artifacts.usdcAddress,
    abi: artifacts.usdcAbi,
    functionName: "mint",
    args: [bot.account.address, MINT_TOPUP_USDC6],
  });
  await wallets.publicClient.waitForTransactionReceipt({ hash: mintHash });
}

async function executeTrade(
  wallets: TradingWallets,
  artifacts: DeploymentArtifacts,
  bot: BotWallet,
  market: TradableMarket,
  outcomeIndex: number,
  amount6: bigint,
): Promise<void> {
  const amm = market.addresses.amm as Address;

  await ensureBotFunded(wallets, artifacts, bot, amount6);

  const approveHash = await bot.client.writeContract({
    address: artifacts.usdcAddress,
    abi: artifacts.usdcAbi,
    functionName: "approve",
    args: [amm, amount6],
  });
  await wallets.publicClient.waitForTransactionReceipt({ hash: approveHash });

  const buyHash = await bot.client.writeContract({
    address: amm,
    abi: artifacts.ammAbi,
    functionName: "buy",
    args: [outcomeIndex, amount6, 0n],
  });
  const receipt = await wallets.publicClient.waitForTransactionReceipt({ hash: buyHash });

  let sharesNote = `tx ${buyHash}`;
  try {
    const buyLogs = parseEventLogs({ abi: artifacts.ammAbi, logs: receipt.logs, eventName: "Buy" });
    const sharesOut = extractSharesOut(buyLogs[0]?.args);
    if (sharesOut !== undefined) sharesNote = `sharesOut ${formatUsdc(sharesOut)} (tx ${buyHash})`;
  } catch {
    // Buy event parse is best-effort — tx hash is enough.
  }

  log(
    `${bot.label} bought outcome ${outcomeIndex} on "${truncate(market.question)}" ` +
      `(market ${market.marketId}) for ${formatUsdc(amount6)} — ${sharesNote}`,
  );
}

async function runCycle(cfg: TradingConfig, rng: Rng): Promise<void> {
  let markets: TradableMarket[];
  try {
    markets = await discoverTradableMarkets(cfg.apiBaseUrl);
  } catch (cause) {
    if (cause instanceof MarketsApiError) {
      log(`${cause.message} — no tradable markets this cycle.`);
      return;
    }
    throw cause;
  }
  if (markets.length === 0) {
    log("no tradable markets (need LIVE, bot-created, closeTime in the future) — nothing to do.");
    return;
  }
  log(`${markets.length} tradable market(s) discovered; placing ${cfg.tradesPerCycle} trade(s).`);

  const artifacts = loadDeployments(cfg.deploymentsFile);
  const wallets = createTradingWallets(cfg.mnemonic, cfg.rpcUrl);

  for (let i = 0; i < cfg.tradesPerCycle; i += 1) {
    const bot = pick(rng, wallets.bots);
    const market = pick(rng, markets);
    const outcomeIndex = randInt(rng, 0, 1);
    const amount6 = randomTradeAmountUsdc6(rng, cfg.tradeMinUsdc, cfg.tradeMaxUsdc);
    try {
      await executeTrade(wallets, artifacts, bot, market, outcomeIndex, amount6);
    } catch (cause) {
      logError(
        `trade ${i + 1}/${cfg.tradesPerCycle} failed ` +
          `(${bot.label}, market ${market.marketId}, outcome ${outcomeIndex}, ` +
          `${formatUsdc(amount6)}): ${String(cause)} — continuing.`,
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const loop = argv.includes("--loop");

  let cfg: TradingConfig;
  try {
    cfg = loadTradingConfig();
  } catch (cause) {
    if (cause instanceof ConfigError) {
      logError(cause.message);
      return 1;
    }
    throw cause;
  }

  log(
    `mode=${loop ? "loop" : "once"} api=${cfg.apiBaseUrl} rpc=${cfg.rpcUrl} ` +
      `trades/cycle=${cfg.tradesPerCycle} amount=${cfg.tradeMinUsdc}-${cfg.tradeMaxUsdc} USDC`,
  );
  log(`PRNG seed=${cfg.seed}${cfg.seedWasProvided ? " (from GENERATOR_SEED)" : " (random)"}`);

  if (loop && !cfg.tradingEnabled) {
    log('GENERATOR_TRADING is not "on" — loop mode disabled, exiting (idle is not an error).');
    return 0;
  }

  try {
    await assertEnvironmentLock(cfg);
  } catch (cause) {
    if (cause instanceof EnvLockError) {
      logError(cause.message);
      return 1;
    }
    throw cause;
  }
  log(`environment lock OK (host allowlisted, chain ID 1337 at ${cfg.rpcUrl}).`);

  const rng = createPrng(cfg.seed);

  if (!loop) {
    try {
      await runCycle(cfg, rng);
    } catch (cause) {
      if (cause instanceof DeploymentsError) {
        logError(cause.message);
        return 1;
      }
      logError(`cycle failed: ${String(cause)}`);
      return 1;
    }
    return 0;
  }

  for (;;) {
    try {
      await runCycle(cfg, rng);
    } catch (cause) {
      // Degrade silently (Section 3.2 spirit): log and try again next interval.
      logError(`cycle failed: ${String(cause)} — retrying next interval.`);
    }
    log(`sleeping ${Math.round(cfg.tradeIntervalMs / 1000)}s until next cycle.`);
    await sleep(cfg.tradeIntervalMs);
  }
}

/* istanbul ignore next -- CLI bootstrap */
if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause: unknown) => {
      logError(`fatal: ${String(cause)}`);
      process.exitCode = 1;
    });
}
