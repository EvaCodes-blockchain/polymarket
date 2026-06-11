// Test-USDC faucet (Ganache only — agentic sprint)
//
// INTEGRATION CONTRACT (frozen — docs/delivery/agentic-sprint-contracts.md §4):
//
//   POST /api/faucet
//     Auth: NextAuth session OR x-generator-key header (401 otherwise)
//     Body: { address: 0x… (40 hex chars), amountUsdc?: number (default 100, clamped 1..1000) }
//     200 { txHash } — MockUSDC minted to the address by the deployer
//     400 { error }  — invalid body
//     401 { error }  — no session and no valid generator key
//     502 { error }  — on-chain mint failed
//     500 { error }  — server error

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { authOptions } from '@/lib/server/auth';
import { mintUsdcTo } from '@/lib/server/chain';
import { isGeneratorRequest } from '@/lib/server/generatorAuth';

export const dynamic = 'force-dynamic';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const DEFAULT_AMOUNT_USDC = 100;
const MIN_AMOUNT_USDC = 1;
const MAX_AMOUNT_USDC = 1_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const generator = isGeneratorRequest(req);
  const session = generator ? null : await getServerSession(authOptions);
  if (!generator && !session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'Request body is required' }, { status: 400 });
  }

  const { address, amountUsdc } = raw as Record<string, unknown>;

  if (typeof address !== 'string' || !ADDRESS_RE.test(address)) {
    return NextResponse.json(
      { error: 'address must be a 0x-prefixed 40-hex-char EVM address' },
      { status: 400 }
    );
  }

  let amount = DEFAULT_AMOUNT_USDC;
  if (amountUsdc !== undefined && amountUsdc !== null) {
    if (typeof amountUsdc !== 'number' || !Number.isFinite(amountUsdc)) {
      return NextResponse.json({ error: 'amountUsdc must be a number' }, { status: 400 });
    }
    amount = Math.min(Math.max(amountUsdc, MIN_AMOUNT_USDC), MAX_AMOUNT_USDC);
  }

  try {
    const txHash = await mintUsdcTo(address as `0x${string}`, amount);
    return NextResponse.json({ txHash });
  } catch (err) {
    console.error('[faucet POST] mint failed', err);
    return NextResponse.json({ error: 'On-chain mint failed' }, { status: 502 });
  }
}
