/**
 * Market discovery via the public Markets API (sprint contracts Section 4):
 *   GET {API_BASE_URL}/api/markets?status=LIVE&limit=50  (single page)
 * Tradable = generated markets only: `creator.isBot === true` AND closeTime in
 * the future. Minimal local DTO — only the fields this module reads (the full
 * MarketDTO lives in web/src/lib/client/api.ts; we must not import across
 * workspaces, and redefining the whole shape would violate the freeze).
 */

import type { FetchLike } from "./envLock";

/** Subset of the frozen MarketDTO needed for background trading. */
export interface TradableMarket {
  readonly id: string;
  readonly marketId: number;
  readonly question: string;
  readonly closeTime: string; // ISO
  readonly addresses: { readonly amm: string };
  readonly creator: { readonly isBot: boolean };
}

export class MarketsApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketsApiError";
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function parseMarket(value: unknown): TradableMarket | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  const addresses = m.addresses as Record<string, unknown> | undefined;
  const creator = m.creator as Record<string, unknown> | undefined;
  if (
    typeof m.id !== "string" ||
    typeof m.marketId !== "number" ||
    typeof m.question !== "string" ||
    typeof m.closeTime !== "string" ||
    typeof addresses !== "object" ||
    addresses === null ||
    typeof addresses.amm !== "string" ||
    !ADDRESS_RE.test(addresses.amm) ||
    typeof creator !== "object" ||
    creator === null ||
    typeof creator.isBot !== "boolean"
  ) {
    return null;
  }
  return {
    id: m.id,
    marketId: m.marketId,
    question: m.question,
    closeTime: m.closeTime,
    addresses: { amm: addresses.amm },
    creator: { isBot: creator.isBot },
  };
}

/** Bot-created AND not yet closed (closeTime strictly in the future of `now`). */
export function filterTradable(
  markets: readonly TradableMarket[],
  now: Date = new Date(),
): TradableMarket[] {
  return markets.filter((market) => {
    if (!market.creator.isBot) return false;
    const closeMs = Date.parse(market.closeTime);
    return Number.isFinite(closeMs) && closeMs > now.getTime();
  });
}

/**
 * Fetches one page (limit 50) of LIVE markets and applies the tradable filter.
 * Malformed entries are skipped, not fatal.
 */
export async function discoverTradableMarkets(
  apiBaseUrl: string,
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<TradableMarket[]> {
  const url = `${apiBaseUrl.replace(/\/+$/, "")}/api/markets?status=LIVE&limit=50`;
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new MarketsApiError(`markets API unreachable at ${url} (${String(cause)})`);
  }
  if (!response.ok) {
    throw new MarketsApiError(`GET ${url} returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { markets?: unknown };
  if (!Array.isArray(payload.markets)) {
    throw new MarketsApiError(`GET ${url} returned an unexpected shape (no markets array)`);
  }
  const parsed = payload.markets
    .map(parseMarket)
    .filter((market): market is TradableMarket => market !== null);
  return filterTradable(parsed, now);
}
