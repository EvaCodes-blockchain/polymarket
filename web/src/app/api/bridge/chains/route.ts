// Bridge dashboard — transport blockchains (feature/bridge-1, NEW additive).
//
// INTEGRATION CONTRACT (frozen — web/src/lib/client/bridgeApi.ts):
//
//   GET /api/bridge/chains
//     Auth: none
//     200 { chains: BridgeChainDTO[] } — ordered by sortOrder asc, each carrying
//         a denormalized marketCount (count of external markets on that chain).
//     500 { error }
//
// Mocked-data only: reads bridge_chains + a grouped count of external_markets.
// No on-chain calls.

import { NextResponse } from 'next/server';

import { db } from '@/lib/server/db';
import { toBridgeChainDTO } from '@/lib/server/bridgeDto';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const [chains, grouped] = await Promise.all([
      db.bridgeChain.findMany({ orderBy: { sortOrder: 'asc' } }),
      db.externalMarket.groupBy({
        by: ['chainKey'],
        _count: { _all: true },
      }),
    ]);

    const countByChainKey = new Map<string, number>(
      grouped.map((g) => [g.chainKey, g._count._all]),
    );

    const dtos = chains.map((chain) =>
      toBridgeChainDTO(chain, countByChainKey.get(chain.key) ?? 0),
    );

    return NextResponse.json({ chains: dtos });
  } catch (err) {
    console.error('[bridge/chains GET] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
