// Bridge dashboard — aggregated systems (feature/bridge-1, NEW additive).
//
// INTEGRATION CONTRACT (frozen — web/src/lib/client/bridgeApi.ts):
//
//   GET /api/bridge/systems
//     Auth: none
//     200 { systems: BridgeSystemDTO[] } — ordered by sortOrder asc, each with
//         chainKeys: the distinct chain slugs the system has markets on,
//         ordered by the chain's sortOrder.
//     500 { error }
//
// Mocked-data only: reads bridge_systems, the external_markets (system,chain)
// pairs, and bridge_chains (for sortOrder). No on-chain calls.

import { NextResponse } from 'next/server';

import { db } from '@/lib/server/db';
import { toBridgeSystemDTO } from '@/lib/server/bridgeDto';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const [systems, pairs, chains] = await Promise.all([
      db.bridgeSystem.findMany({ orderBy: { sortOrder: 'asc' } }),
      // Distinct (systemKey, chainKey) pairs across all external markets.
      db.externalMarket.findMany({
        distinct: ['systemKey', 'chainKey'],
        select: { systemKey: true, chainKey: true },
      }),
      db.bridgeChain.findMany({
        orderBy: { sortOrder: 'asc' },
        select: { key: true },
      }),
    ]);

    // Chain sortOrder lookup (lower index == earlier sortOrder).
    const chainRank = new Map<string, number>(chains.map((c, i) => [c.key, i]));

    // Group distinct chainKeys per system.
    const chainKeysBySystem = new Map<string, Set<string>>();
    for (const { systemKey, chainKey } of pairs) {
      const set = chainKeysBySystem.get(systemKey) ?? new Set<string>();
      set.add(chainKey);
      chainKeysBySystem.set(systemKey, set);
    }

    const dtos = systems.map((system) => {
      const keys = Array.from(chainKeysBySystem.get(system.key) ?? []);
      keys.sort((a, b) => (chainRank.get(a) ?? Infinity) - (chainRank.get(b) ?? Infinity));
      return toBridgeSystemDTO(system, keys);
    });

    return NextResponse.json({ systems: dtos });
  } catch (err) {
    console.error('[bridge/systems GET] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
