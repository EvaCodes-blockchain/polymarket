// Public chain config — runtime address resolution (closes BUG-002).
//
// The browser bundle must NOT bake in contract addresses at build time: after a
// redeploy (e.g. Ganache→Arc) those would drift. This endpoint serves the two
// global addresses (MockUSDC, OutcomeToken) + chain id from the live deployment
// artifact the server actually reads, so the client fetches them at runtime.
//
//   GET /api/config
//     200 { chainId, rpcUrl, addresses: { MockUSDC, OutcomeToken } }
//     500 { error }  — artifact unreadable

import { NextResponse } from 'next/server';
import { getPublicChainConfig } from '@/lib/server/chain';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(getPublicChainConfig());
  } catch (err) {
    console.error('[config GET] failed to load chain config', err);
    return NextResponse.json({ error: 'Chain config unavailable' }, { status: 500 });
  }
}
