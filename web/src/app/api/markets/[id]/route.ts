// Market detail (FR-MKT-1, agentic sprint)
//
// INTEGRATION CONTRACT (frozen — docs/delivery/agentic-sprint-contracts.md §4):
//
//   GET /api/markets/[id]
//     id: Market.id (cuid) OR numeric on-chain marketId
//     Auth: none
//     200 { market: MarketDTO }
//     404 { error: 'Market not found' }
//     500 { error }

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/server/db';
import { toMarketDTO } from '@/lib/server/marketDto';

export const dynamic = 'force-dynamic';

const CREATOR_SELECT = {
  id: true,
  name: true,
  handle: true,
  image: true,
  isBot: true,
} as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const id = params.id.trim();

    const market = await db.market.findUnique({
      where: /^\d+$/.test(id)
        ? { marketId: Number.parseInt(id, 10) }
        : { id },
      include: { creator: { select: CREATOR_SELECT } },
    });

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 });
    }

    return NextResponse.json({ market: await toMarketDTO(market) });
  } catch (err) {
    console.error('[markets/[id] GET] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
