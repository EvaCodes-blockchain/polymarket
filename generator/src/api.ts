/**
 * Thin client for the platform's public Markets API
 * (docs/delivery/agentic-sprint-contracts.md Section 4 — FROZEN shapes).
 *
 * The generator is a pure API consumer: POST /api/markets with the
 * x-generator-key header, GET /api/markets to count live generated markets
 * for the MAX_LIVE_MARKETS cap. No internal imports, no DB access.
 */

import type { GeneratedMarket } from './templating.js';
import type { Prng } from './prng.js';

export type BotHandle = 'bot-news' | 'bot-sports' | 'bot-business';

/** Category → existing /img/* file (contract doc Section 5 image map). */
const CATEGORY_IMAGES: Record<string, string> = {
  sports: '/img/el-classico.png',
  crypto: '/img/ETHfullsize.webp',
  business: '/img/will-microstrategy-purchase-bitcoin-july-1-7-mzoE5TYk_cCI.webp',
  world: '/img/russia-x-ukraine-ceasefire-in-2025-w2voYOygx80B.webp',
  politics: '/img/russia-x-ukraine-ceasefire-in-2025-w2voYOygx80B.webp',
};
const FALLBACK_IMAGE = '/img/trend1.jpg';

export function imageForCategory(category: string): string {
  return CATEGORY_IMAGES[category] ?? FALLBACK_IMAGE;
}

/** Creator identity per topic (spec Section 4.3 — bot-prefixed handles). */
export function creatorHandleFor(category: string): BotHandle {
  if (category === 'sports') return 'bot-sports';
  if (category === 'business' || category === 'technology') return 'bot-business';
  return 'bot-news';
}

/**
 * Seeded-random USDC split: total 1000, between 20/80 and 80/20.
 */
export function randomSeedSplit(prng: Prng): { seedYesUsdc: number; seedNoUsdc: number } {
  const seedYesUsdc = prng.int(200, 800);
  return { seedYesUsdc, seedNoUsdc: 1000 - seedYesUsdc };
}

// ── Request/response shapes (per contract Section 4) ─────────────────────────

export interface CreateMarketBody {
  question: string;
  description: string;
  category: string;
  imageUrl: string;
  oracleProofUrl: string;
  marketType: 'FUN' | 'CLASSIC' | 'CHALLENGE';
  closeTime: string; // ISO
  seedYesUsdc: number;
  seedNoUsdc: number;
  creatorHandle: BotHandle;
  createPost: true;
}

interface CreatorRef {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
  isBot: boolean;
}

interface MarketSummary {
  id: string;
  marketId: number;
  question: string;
  status: string;
  creator: CreatorRef;
}

interface MarketsListResponse {
  markets: MarketSummary[];
  nextCursor: string | null;
}

export type CreateMarketResult =
  | { ok: true; market: MarketSummary }
  | { ok: false; status: number; error: string };

export class MarketsApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  /** Build the POST /api/markets body for a generated market. */
  buildCreateBody(market: GeneratedMarket, prng: Prng): CreateMarketBody {
    const { seedYesUsdc, seedNoUsdc } = randomSeedSplit(prng);
    return {
      question: market.question,
      description: market.description,
      category: market.category,
      imageUrl: imageForCategory(market.category),
      oracleProofUrl: market.oracleProofUrl,
      marketType: market.marketType,
      closeTime: market.closeTime.toISOString(),
      seedYesUsdc,
      seedNoUsdc,
      creatorHandle: creatorHandleFor(market.category),
      createPost: true,
    };
  }

  async createMarket(body: CreateMarketBody): Promise<CreateMarketResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/markets`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-generator-key': this.apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        return {
          ok: false,
          status: res.status,
          error: errBody.error ?? `POST /api/markets failed: ${res.status}`,
        };
      }
      const data = (await res.json()) as { market: MarketSummary };
      return { ok: true, market: data.market };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        error: `POST /api/markets unreachable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Count LIVE markets created by bot users (creator.isBot) — the
   * MAX_LIVE_MARKETS cap input. Pages through GET /api/markets up to `cap`.
   * On API failure returns null (caller decides; never throws).
   */
  async countLiveGeneratedMarkets(cap: number): Promise<number | null> {
    let count = 0;
    let cursor: string | null = null;
    try {
      do {
        const params = new URLSearchParams({ status: 'LIVE', limit: '50' });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`${this.baseUrl}/api/markets?${params.toString()}`, {
          headers: { 'x-generator-key': this.apiKey },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as MarketsListResponse;
        count += data.markets.filter((m) => m.creator.isBot).length;
        cursor = data.nextCursor;
        if (count >= cap) return count;
      } while (cursor !== null);
      return count;
    } catch {
      return null;
    }
  }
}
