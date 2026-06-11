// GET /api/profile/[handle] — public profile data
//
// INTEGRATION CONTRACT (frozen — announce before changing):
//
//   GET /api/profile/:handle
//     handle — the user's email prefix or display name slug (case-insensitive)
//              For the MVP, handle == user.id or user.email (the seed uses email)
//     No auth required (public endpoint); optional session for viewerFollows
//
//   200 {
//     profile: {
//       id: string,
//       name: string | null,
//       email: string | null,
//       image: string | null,
//       createdAt: string (ISO),
//     },
//     followerCount: number,
//     followingCount: number,
//     viewerFollows: boolean,   // true if authenticated viewer follows this profile
//   }
//   404 { error: 'User not found' }
//   500 { error: string }
//
// Handle resolution order:
//   1. Exact match on user.id
//   2. Exact match on user.email (lowercase)
//   3. Case-insensitive match on user.name (first match)

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { authOptions } from '@/lib/server/auth';
import { db } from '@/lib/server/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: { handle: string } },
): Promise<NextResponse> {
  const { handle } = params;
  if (!handle) {
    return NextResponse.json({ error: 'Handle is required' }, { status: 400 });
  }

  const decodedHandle = decodeURIComponent(handle).toLowerCase().trim();

  try {
    // Resolve handle → user
    const user = await db.user.findFirst({
      where: {
        OR: [
          { id: decodedHandle },
          { email: decodedHandle },
          { name: { equals: decodedHandle, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
        _count: {
          select: {
            followers: true,
            following: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if the authenticated viewer follows this user
    let viewerFollows = false;
    const session = await getServerSession(authOptions);
    if (session?.user?.id && session.user.id !== user.id) {
      const follow = await db.follow.findUnique({
        where: {
          followerId_followeeId: {
            followerId: session.user.id,
            followeeId: user.id,
          },
        },
        select: { id: true },
      });
      viewerFollows = follow !== null;
    }

    return NextResponse.json({
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        createdAt: user.createdAt.toISOString(),
      },
      followerCount: user._count.followers,
      followingCount: user._count.following,
      viewerFollows,
    });
  } catch (err) {
    console.error('[profile GET] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
