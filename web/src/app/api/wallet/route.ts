// Wallet bind / lookup endpoints (CEO-3)
//
// INTEGRATION CONTRACT (frozen — announce before changing):
//
//   POST /api/wallet
//     Body: { address: string, message: string, signature: string }
//       address   — checksummed EVM address (0x…, 42 chars)
//       message   — the plain-text message that was signed (use SIGN_MESSAGE below)
//       signature — 0x… hex signature produced by MetaMask personal_sign
//     Auth: session required (401 if not)
//     Verifies ownership via viem verifyMessage (ECDSA)
//     201 { id, address, userId, createdAt }  — wallet bound
//     200 { id, address, userId, createdAt }  — already bound to this user (idempotent re-bind)
//     400 { error }                           — validation error
//     409 { error }                           — address already bound to a different user
//     422 { error }                           — signature verification failed
//     500 { error }                           — server error
//
//   GET /api/wallet
//     Auth: session required (401 if not)
//     Returns the wallet(s) bound to the current user
//     200 { wallets: Array<{ id, address, createdAt }> }
//
// SIGN_MESSAGE (frontend must use exactly this string):
//   "Sign in to Justify\nThis request will not trigger a blockchain transaction or cost any gas fees.\nNonce: {userId}"
//   (replace {userId} with session.user.id)

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage } from 'viem';

import { authOptions } from '@/lib/server/auth';
import { db } from '@/lib/server/db';

// The frontend must build the sign message as:
// `Sign in to Justify\nThis request will not trigger a blockchain transaction or cost any gas fees.\nNonce: ${session.user.id}`
function buildExpectedMessage(userId: string): string {
  return `Sign in to Justify\nThis request will not trigger a blockchain transaction or cost any gas fees.\nNonce: ${userId}`;
}

// ---------------------------------------------------------------------------
// POST — bind wallet
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body is required' }, { status: 400 });
  }

  const { address, message, signature } = body as Record<string, unknown>;

  // --- Input validation ---
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: 'address must be a valid EVM address (0x…, 42 chars)' }, { status: 400 });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (typeof signature !== 'string' || !/^0x/.test(signature)) {
    return NextResponse.json({ error: 'signature must be a 0x-prefixed hex string' }, { status: 400 });
  }

  // --- Verify message content matches expected nonce ---
  const expectedMessage = buildExpectedMessage(userId);
  if (message !== expectedMessage) {
    return NextResponse.json({ error: 'Message content does not match expected format' }, { status: 422 });
  }

  // --- Verify signature (ECDSA via viem) ---
  let valid: boolean;
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch (err) {
    console.error('[wallet POST] verifyMessage error', err);
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 422 });
  }

  if (!valid) {
    return NextResponse.json({ error: 'Signature does not match address' }, { status: 422 });
  }

  // --- Check for address conflict ---
  const existing = await db.wallet.findUnique({
    where: { address },
    select: { id: true, userId: true, createdAt: true },
  });

  if (existing) {
    if (existing.userId === userId) {
      // Already bound to this user — idempotent re-bind
      return NextResponse.json({ id: existing.id, address, userId, createdAt: existing.createdAt }, { status: 200 });
    } else {
      // Bound to a different user — conflict
      return NextResponse.json({ error: 'Address already bound to another account' }, { status: 409 });
    }
  }

  // --- Persist ---
  try {
    const wallet = await db.wallet.create({
      data: { userId, address },
      select: { id: true, address: true, userId: true, createdAt: true },
    });
    return NextResponse.json(wallet, { status: 201 });
  } catch (err) {
    console.error('[wallet POST] db error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET — list wallets for current user
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const wallets = await db.wallet.findMany({
      where: { userId: session.user.id },
      select: { id: true, address: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ wallets });
  } catch (err) {
    console.error('[wallet GET] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
