// Users API — suggested-users / people listing (FR-PROF-1..6, sprint goal 4)
//
// INTEGRATION CONTRACT (frozen — docs/delivery/agentic-sprint-contracts.md §4):
//
//   GET /api/users?limit=<n≤50, default 20>&bots=<include|exclude (default exclude)>&order=<followers|recent>
//     No auth required; optional session powers viewerFollows + self-exclusion.
//     order=followers (default) — follower count desc; order=recent — createdAt desc.
//     bots=exclude (default) filters isBot users out of the listing.
//     Excludes the authenticated viewer themself when a session exists.
//
//     200 { users: UserSummaryDTO[] }
//     500 { error }
//
// UserSummaryDTO lives in web/src/lib/client/api.ts — imported, never redefined.

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import type { UserSummaryDTO } from '@/lib/client/api';
import { authOptions } from '@/lib/server/auth';
import { db } from '@/lib/server/db';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const userSelect = {
  id: true,
  name: true,
  handle: true,
  image: true,
  bio: true,
  isBot: true,
  _count: {
    select: {
      followers: true,
      following: true,
    },
  },
} satisfies Prisma.UserSelect;

type UserWithCounts = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function toUserSummaryDTO(user: UserWithCounts, viewerFollows: boolean): UserSummaryDTO {
  return {
    id: user.id,
    name: user.name,
    handle: user.handle,
    image: user.image,
    bio: user.bio,
    isBot: user.isBot,
    followerCount: user._count.followers,
    followingCount: user._count.following,
    viewerFollows,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;

    const limitParam = Number.parseInt(searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const includeBots = searchParams.get('bots') === 'include';
    const order = searchParams.get('order') === 'recent' ? 'recent' : 'followers';

    const session = await getServerSession(authOptions);
    const viewerId = session?.user?.id ?? null;

    const where: Prisma.UserWhereInput = {
      ...(includeBots ? {} : { isBot: false }),
      ...(viewerId ? { id: { not: viewerId } } : {}),
    };

    const orderBy: Prisma.UserOrderByWithRelationInput =
      order === 'recent'
        ? { createdAt: 'desc' }
        : { followers: { _count: 'desc' } };

    const users = await db.user.findMany({
      where,
      orderBy,
      take: limit,
      select: userSelect,
    });

    // viewerFollows — one query for all returned ids
    let followedIds = new Set<string>();
    if (viewerId && users.length > 0) {
      const follows = await db.follow.findMany({
        where: {
          followerId: viewerId,
          followeeId: { in: users.map((u) => u.id) },
        },
        select: { followeeId: true },
      });
      followedIds = new Set(follows.map((f) => f.followeeId));
    }

    return NextResponse.json({
      users: users.map((u) => toUserSummaryDTO(u, followedIds.has(u.id))),
    });
  } catch (err) {
    console.error('[users GET] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
