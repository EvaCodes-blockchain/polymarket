/**
 * Unit tests for the background-trading module (generator/src/trading/**).
 * No live chain / API dependency: fetch is injected as a mock everywhere.
 * Covers the safety rails required by testing-market-generator.md Section 8:
 * environment-lock refusal (bad host, wrong chain id), PRNG determinism,
 * amount-range bounds, and tradable-market filtering.
 */

import { describe, expect, it } from "vitest";
import {
  loadTradingConfig,
  ConfigError,
  parseDurationMs,
  DEFAULT_API_BASE_URL,
  DEFAULT_MNEMONIC,
  DEFAULT_RPC_URL,
  DEFAULT_TRADES_PER_CYCLE,
} from "../src/trading/config";
import {
  assertEnvironmentLock,
  EnvLockError,
  fetchChainId,
  isAllowedApiBaseUrl,
  type FetchLike,
} from "../src/trading/envLock";
import { filterTradable, discoverTradableMarkets, type TradableMarket } from "../src/trading/markets";
import { createPrng, pick, randInt, randomTradeAmountUsdc6 } from "../src/trading/prng";
import { deriveAccount, BOT_ADDRESS_INDICES, DEPLOYER_ADDRESS_INDEX } from "../src/trading/wallets";
import { loadDeployments, defaultDeploymentsPath } from "../src/trading/deployments";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rpcFetchMock(chainIdHex: string): FetchLike {
  return async () => jsonResponse({ jsonrpc: "2.0", id: 1, result: chainIdHex });
}

function makeMarket(overrides: Partial<TradableMarket> = {}): TradableMarket {
  return {
    id: "cmkt000000000000000000001",
    marketId: 1,
    question: "Will the bots keep trading?",
    closeTime: new Date(Date.now() + 86_400_000).toISOString(),
    addresses: { amm: "0xd470E6668777090b791d4De49B71Ea7fe5DE7ca8" },
    creator: { isBot: true },
    ...overrides,
  };
}

describe("config (env parsing)", () => {
  it("applies documented defaults", () => {
    const cfg = loadTradingConfig({});
    expect(cfg.apiBaseUrl).toBe(DEFAULT_API_BASE_URL);
    expect(cfg.rpcUrl).toBe(DEFAULT_RPC_URL);
    expect(cfg.mnemonic).toBe(DEFAULT_MNEMONIC);
    expect(cfg.tradingEnabled).toBe(false);
    expect(cfg.tradesPerCycle).toBe(DEFAULT_TRADES_PER_CYCLE);
    expect(cfg.tradeMinUsdc).toBe(1);
    expect(cfg.tradeMaxUsdc).toBe(25);
    expect(cfg.tradeIntervalMs).toBe(60_000);
    expect(cfg.extraAllowedHosts).toEqual([]);
  });

  it("reads overrides, GENERATOR_SEED and EXTRA_ALLOWED_HOSTS", () => {
    const cfg = loadTradingConfig({
      API_BASE_URL: "http://web:3000",
      GENERATOR_TRADING: "on",
      TRADES_PER_CYCLE: "3",
      TRADE_MIN_USDC: "2",
      TRADE_MAX_USDC: "10",
      TRADE_INTERVAL: "5m",
      GENERATOR_SEED: "42",
      EXTRA_ALLOWED_HOSTS: "web, demo-host",
    });
    expect(cfg.apiBaseUrl).toBe("http://web:3000");
    expect(cfg.tradingEnabled).toBe(true);
    expect(cfg.tradesPerCycle).toBe(3);
    expect(cfg.tradeMinUsdc).toBe(2);
    expect(cfg.tradeMaxUsdc).toBe(10);
    expect(cfg.tradeIntervalMs).toBe(300_000);
    expect(cfg.seed).toBe(42);
    expect(cfg.seedWasProvided).toBe(true);
    expect(cfg.extraAllowedHosts).toEqual(["web", "demo-host"]);
  });

  it("rejects min > max and non-numeric knobs", () => {
    expect(() => loadTradingConfig({ TRADE_MIN_USDC: "30", TRADE_MAX_USDC: "10" })).toThrow(
      ConfigError,
    );
    expect(() => loadTradingConfig({ TRADES_PER_CYCLE: "five" })).toThrow(ConfigError);
    expect(() => loadTradingConfig({ GENERATOR_SEED: "not-a-seed" })).toThrow(ConfigError);
  });

  it("parses durations with units and bare seconds", () => {
    expect(parseDurationMs("T", "500ms", 0)).toBe(500);
    expect(parseDurationMs("T", "90s", 0)).toBe(90_000);
    expect(parseDurationMs("T", "2m", 0)).toBe(120_000);
    expect(parseDurationMs("T", "1h", 0)).toBe(3_600_000);
    expect(parseDurationMs("T", "60", 0)).toBe(60_000);
    expect(() => parseDurationMs("T", "soon", 0)).toThrow(ConfigError);
  });
});

describe("environment lock (safety rail)", () => {
  it("allows localhost, 127.0.0.1, *.test, *.staging", () => {
    expect(isAllowedApiBaseUrl("http://localhost:3000")).toBe(true);
    expect(isAllowedApiBaseUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isAllowedApiBaseUrl("https://justify.test")).toBe(true);
    expect(isAllowedApiBaseUrl("https://demo.staging")).toBe(true);
  });

  it("refuses non-allowlisted hosts and junk URLs", () => {
    expect(isAllowedApiBaseUrl("https://polymarket.com")).toBe(false);
    expect(isAllowedApiBaseUrl("https://api.justify.io")).toBe(false);
    expect(isAllowedApiBaseUrl("https://evil-localhost.com")).toBe(false);
    expect(isAllowedApiBaseUrl("not a url")).toBe(false);
    expect(isAllowedApiBaseUrl("ftp://localhost")).toBe(false);
  });

  it("honors EXTRA_ALLOWED_HOSTS (compose: web)", () => {
    expect(isAllowedApiBaseUrl("http://web:3000")).toBe(false);
    expect(isAllowedApiBaseUrl("http://web:3000", ["web"])).toBe(true);
    expect(isAllowedApiBaseUrl("https://prod.example.com", ["web"])).toBe(false);
  });

  it("refuses a non-allowlisted API_BASE_URL before touching the RPC", async () => {
    let rpcCalled = false;
    const fetchMock: FetchLike = async () => {
      rpcCalled = true;
      return jsonResponse({ result: "0x539" });
    };
    await expect(
      assertEnvironmentLock(
        {
          apiBaseUrl: "https://production.example.com",
          rpcUrl: "http://localhost:8545",
          extraAllowedHosts: [],
        },
        fetchMock,
      ),
    ).rejects.toThrow(EnvLockError);
    expect(rpcCalled).toBe(false);
  });

  it("refuses when the node reports a chain ID other than 1337", async () => {
    await expect(
      assertEnvironmentLock(
        { apiBaseUrl: "http://localhost:3000", rpcUrl: "http://localhost:8545", extraAllowedHosts: [] },
        rpcFetchMock("0x1"), // mainnet!
      ),
    ).rejects.toThrow(/chain ID 1/);
  });

  it("passes for allowlisted URL + chain ID 0x539 (1337)", async () => {
    await expect(
      assertEnvironmentLock(
        { apiBaseUrl: "http://localhost:3000", rpcUrl: "http://localhost:8545", extraAllowedHosts: [] },
        rpcFetchMock("0x539"),
      ),
    ).resolves.toBeUndefined();
  });

  it("treats unreachable / malformed RPC as a lock failure", async () => {
    const unreachable: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(fetchChainId("http://localhost:8545", unreachable)).rejects.toThrow(EnvLockError);
    const malformed: FetchLike = async () => jsonResponse({ result: 1337 });
    await expect(fetchChainId("http://localhost:8545", malformed)).rejects.toThrow(EnvLockError);
  });
});

describe("PRNG", () => {
  it("is deterministic for the same seed", () => {
    const a = createPrng(1234);
    const b = createPrng(1234);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    const a = createPrng(1);
    const b = createPrng(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("randInt stays inclusive within bounds and hits both ends", () => {
    const rng = createPrng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) {
      const v = randInt(rng, 0, 1);
      expect(v === 0 || v === 1).toBe(true);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([0, 1]));
  });

  it("pick only returns elements of the array", () => {
    const rng = createPrng(99);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 100; i += 1) {
      expect(items).toContain(pick(rng, items));
    }
    expect(() => pick(rng, [])).toThrow();
  });
});

describe("trade amount range (1-25 USDC, 6 decimals)", () => {
  it("always lands in [min*1e6, max*1e6]", () => {
    const rng = createPrng(2026);
    for (let i = 0; i < 2000; i += 1) {
      const amount = randomTradeAmountUsdc6(rng, 1, 25);
      expect(amount >= 1_000_000n).toBe(true);
      expect(amount <= 25_000_000n).toBe(true);
    }
  });

  it("is deterministic under the same seed and rejects bad ranges", () => {
    const a = createPrng(5);
    const b = createPrng(5);
    expect(randomTradeAmountUsdc6(a, 1, 25)).toBe(randomTradeAmountUsdc6(b, 1, 25));
    expect(() => randomTradeAmountUsdc6(createPrng(1), 25, 1)).toThrow();
    expect(() => randomTradeAmountUsdc6(createPrng(1), 0, 5)).toThrow();
  });
});

describe("market filtering", () => {
  const now = new Date("2026-06-12T12:00:00Z");

  it("excludes closed (past closeTime) and non-bot markets", () => {
    const open = makeMarket({ id: "m-open", closeTime: "2026-06-13T12:00:00Z" });
    const closed = makeMarket({ id: "m-closed", closeTime: "2026-06-11T12:00:00Z" });
    const human = makeMarket({
      id: "m-human",
      closeTime: "2026-06-13T12:00:00Z",
      creator: { isBot: false },
    });
    const badDate = makeMarket({ id: "m-bad", closeTime: "not-a-date" });
    expect(filterTradable([open, closed, human, badDate], now).map((m) => m.id)).toEqual(["m-open"]);
  });

  it("discoverTradableMarkets requests one LIVE page (limit 50) and filters", async () => {
    let requestedUrl = "";
    const fetchMock: FetchLike = async (input) => {
      requestedUrl = input;
      return jsonResponse({
        markets: [
          makeMarket({ id: "m-1" }),
          makeMarket({ id: "m-2", creator: { isBot: false } }),
          { garbage: true }, // malformed entries are skipped, not fatal
        ],
        nextCursor: null,
      });
    };
    const markets = await discoverTradableMarkets("http://localhost:3000/", fetchMock, now);
    expect(requestedUrl).toBe("http://localhost:3000/api/markets?status=LIVE&limit=50");
    expect(markets.map((m) => m.id)).toEqual(["m-1"]);
  });

  it("propagates API errors as MarketsApiError", async () => {
    const failing: FetchLike = async () => jsonResponse({ error: "boom" }, 500);
    await expect(discoverTradableMarkets("http://localhost:3000", failing)).rejects.toThrow(
      /HTTP 500/,
    );
  });
});

describe("wallets (derivation only — no RPC)", () => {
  it("derives deployer (index 0) and bots (7-9) matching the canonical artifact", () => {
    expect(DEPLOYER_ADDRESS_INDEX).toBe(0);
    expect([...BOT_ADDRESS_INDICES]).toEqual([7, 8, 9]);
    // Deployer address is pinned in contracts/deployments/ganache.json.
    const deployer = deriveAccount(DEFAULT_MNEMONIC, 0);
    expect(deployer.address).toBe("0x6B4eCA7B7C93518082e5B651420C3336aCD398c2");
    // Bots must be distinct from each other and from deployer.
    const addresses = BOT_ADDRESS_INDICES.map((i) => deriveAccount(DEFAULT_MNEMONIC, i).address);
    expect(new Set([deployer.address, ...addresses]).size).toBe(4);
  });
});

describe("deployments artifact", () => {
  it("loads MockUSDC address + USDC/AMM ABIs from the canonical file", () => {
    const artifacts = loadDeployments(defaultDeploymentsPath());
    expect(artifacts.chainId).toBe(1337);
    expect(artifacts.usdcAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const usdcFns = artifacts.usdcAbi
      .filter((e): e is Extract<typeof e, { type: "function" }> => e.type === "function")
      .map((e) => e.name);
    expect(usdcFns).toEqual(expect.arrayContaining(["mint", "approve", "balanceOf"]));
    const ammFns = artifacts.ammAbi
      .filter((e): e is Extract<typeof e, { type: "function" }> => e.type === "function")
      .map((e) => e.name);
    expect(ammFns).toContain("buy");
    const ammEvents = artifacts.ammAbi
      .filter((e): e is Extract<typeof e, { type: "event" }> => e.type === "event")
      .map((e) => e.name);
    expect(ammEvents).toContain("Buy");
  });
});
