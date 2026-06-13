// Bridge dashboard — external markets (feature/bridge-1, NEW additive).
//
// INTEGRATION CONTRACT (frozen — web/src/lib/client/bridgeApi.ts):
//
//   GET /api/bridge/markets?chain=<key>&system=<key>
//     Auth: none
//     200 { markets: ExternalMarketDTO[],
//           filter: { chainKey: string | null, systemKey: string | null } }
//         Both filters optional and combinable. Ordered by volumeUsdc desc,
//         then closeTime asc. priceNo/chancePct are derived in the serializer.
//         Unknown chain/system yields an empty list (not an error).
//     500 { error }
//
// Mocked-data only: reads external_markets with optional where filters. No
// on-chain calls.

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/server/db';
import { toExternalMarketDTOs } from '@/lib/server/bridgeDto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;

    const chainKey = searchParams.get('chain')?.trim() || null;
    const systemKey = searchParams.get('system')?.trim() || null;

    const rows = await db.externalMarket.findMany({
      where: {
        ...(chainKey ? { chainKey } : {}),
        ...(systemKey ? { systemKey } : {}),
      },
      orderBy: [{ volumeUsdc: 'desc' }, { closeTime: 'asc' }],
    });

    return NextResponse.json({
      markets: toExternalMarketDTOs(rows),
      filter: { chainKey, systemKey },
    });
  } catch (err) {
    console.error('[bridge/markets GET] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
