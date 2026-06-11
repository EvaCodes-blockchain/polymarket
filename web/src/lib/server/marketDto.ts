// Market DTO serializer — agentic sprint.
// Maps a Prisma Market (+ creator) to the frozen MarketDTO shape from
// web/src/lib/client/api.ts, enriched with live AMM prices. Never throws on
// chain failure — falls back to 0.5/0.5 prices and zero volume so the APIs
// don't 500 when Ganache is down.

import type { Market, User } from '@prisma/client';
import type { MarketDTO } from '@/lib/client/api';
import { readMarketPrices } from '@/lib/server/chain';

export type MarketWithCreator = Market & {
  creator: Pick<User, 'id' | 'name' | 'handle' | 'image' | 'isBot'>;
};

const MARKET_TYPES: ReadonlyArray<MarketDTO['marketType']> = ['FUN', 'CLASSIC', 'CHALLENGE'];
const STATUSES: ReadonlyArray<MarketDTO['status']> = ['LIVE', 'CLOSED', 'RESOLVED'];

function asMarketType(value: string): MarketDTO['marketType'] {
  return (MARKET_TYPES as readonly string[]).includes(value)
    ? (value as MarketDTO['marketType'])
    : 'FUN';
}

function asStatus(value: string): MarketDTO['status'] {
  return (STATUSES as readonly string[]).includes(value)
    ? (value as MarketDTO['status'])
    : 'LIVE';
}

async function safeReadPrices(amm: `0x${string}`): Promise<{
  priceYes: number;
  priceNo: number;
  volumeUsdc: number;
}> {
  try {
    return await readMarketPrices(amm);
  } catch {
    // Chain unreachable — neutral fallback, never throw.
    return { priceYes: 0.5, priceNo: 0.5, volumeUsdc: 0 };
  }
}

export async function toMarketDTO(market: MarketWithCreator): Promise<MarketDTO> {
  const ammAddress = market.ammAddress as `0x${string}`;
  const { priceYes, priceNo, volumeUsdc } = await safeReadPrices(ammAddress);

  return {
    id: market.id,
    marketId: market.marketId,
    question: market.question,
    description: market.description,
    category: market.category,
    imageUrl: market.imageUrl,
    oracleProofUrl: market.oracleProofUrl,
    marketType: asMarketType(market.marketType),
    outcomeYes: market.outcomeYes,
    outcomeNo: market.outcomeNo,
    priceYes,
    priceNo,
    chancePct: Math.round(priceYes * 100),
    volumeUsdc,
    closeTime: market.closeTime.toISOString(),
    createdAt: market.createdAt.toISOString(),
    status: asStatus(market.status),
    addresses: {
      market: market.marketAddress as `0x${string}`,
      amm: ammAddress,
    },
    creator: {
      id: market.creator.id,
      name: market.creator.name,
      handle: market.creator.handle,
      image: market.creator.image,
      isBot: market.creator.isBot,
    },
  };
}

export async function toMarketDTOs(markets: MarketWithCreator[]): Promise<MarketDTO[]> {
  return Promise.all(markets.map((m) => toMarketDTO(m)));
}
