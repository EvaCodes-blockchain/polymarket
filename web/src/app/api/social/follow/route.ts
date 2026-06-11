// Follow / unfollow social graph endpoints (CEO-2)
//
// INTEGRATION CONTRACT (frozen — announce before changing):
//
//   POST /api/social/follow
//     Body: { followeeId: string }
//     Auth: session required (401 if not)
//     201 { followerId, followeeId, createdAt } — follow created
//     200 { followerId, followeeId, createdAt } — already following (idempotent)
//     400 { error }                             — missing/invalid body
//     403 { error }                             — cannot follow yourself
//     404 { error }                             — followee not found
//     500 { error }                             — server error
//
//   DELETE /api/social/follow
//     Body: { followeeId: string }
//     Auth: session required (401 if not)
//     200 { unfollowed: true }  — unfollowed (or was never following, idempotent)
//     400 { error }             — missing/invalid body
//     500 { error }             — server error

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { authOptions } from '@/lib/server/auth';
import { db } from '@/lib/server/db';

// ---------------------------------------------------------------------------
// POST — follow
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const followerId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body is required' }, { status: 400 });
  }

  const { followeeId } = body as Record<string, unknown>;
  if (typeof followeeId !== 'string' || !followeeId.trim()) {
    return NextResponse.json({ error: 'followeeId is required' }, { status: 400 });
  }

  if (followeeId === followerId) {
    return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 403 });
  }

  // Verify followee exists
  const followee = await db.user.findUnique({
    where: { id: followeeId },
    select: { id: true },
  });
  if (!followee) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  try {
    // upsert: idempotent — re-following returns the existing row
    const follow = await db.follow.upsert({
      where: { followerId_followeeId: { followerId, followeeId } },
      create: { followerId, followeeId },
      update: {},
      select: { followerId: true, followeeId: true, createdAt: true },
    });

    // 201 if just created, 200 if it already existed
    const alreadyExisted =
      follow.createdAt < new Date(Date.now() - 1000);
    return NextResponse.json(follow, { status: alreadyExisted ? 200 : 201 });
  } catch (err) {
    console.error('[follow POST] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — unfollow
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const followerId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body is required' }, { status: 400 });
  }

  const { followeeId } = body as Record<string, unknown>;
  if (typeof followeeId !== 'string' || !followeeId.trim()) {
    return NextResponse.json({ error: 'followeeId is required' }, { status: 400 });
  }

  try {
    await db.follow.deleteMany({
      where: { followerId, followeeId },
    });
    return NextResponse.json({ unfollowed: true });
  } catch (err) {
    console.error('[follow DELETE] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
