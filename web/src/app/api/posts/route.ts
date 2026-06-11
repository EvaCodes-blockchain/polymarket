// Posts API — feed posts with optional market-card embeds (FR-FEED-1..5, FR-FEED-9)
//
// INTEGRATION CONTRACT (frozen — docs/delivery/agentic-sprint-contracts.md §4):
//
//   GET /api/posts?cursor=<cuid>&limit=<n≤50, default 20>
//     200 { posts: PostDTO[], nextCursor: string | null } — newest first,
//         each post includes author CreatorRef + market MarketDTO (live AMM prices) or null
//     500 { error }
//
//   POST /api/posts
//     Auth: NextAuth session OR x-generator-key header (401 otherwise)
//     Body: { text (1..500 after trim), imageUrl?, marketId? (Market.id),
//             authorHandle? (generator-key only — upserts a bot user),
//             likeCount?/repostCount?/commentCount? (generator-key only, non-negative ints) }
//     201 { post: PostDTO }
//     400 { error } — invalid body / text length / bad counters
//     401 { error } — no session and no valid generator key
//     404 { error } — marketId given but market not found
//     500 { error } — server error
//
// PostDTO / MarketDTO shapes live in web/src/lib/client/api.ts — imported, never redefined.

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import type { PostDTO } from '@/lib/client/api';
import { authOptions } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { isGeneratorRequest } from '@/lib/server/generatorAuth';
import { toMarketDTO } from '@/lib/server/marketDto';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_TEXT_LENGTH = 500;
const BOT_IMAGE = '/img/8805139.png';
const DEFAULT_BOT_HANDLE = 'bot-news';

// ---------------------------------------------------------------------------
// Shared query shape + serializer
// ---------------------------------------------------------------------------

const creatorSelect = {
  id: true,
  name: true,
  handle: true,
  image: true,
  isBot: true,
} as const;

const postInclude = {
  author: { select: creatorSelect },
  market: { include: { creator: { select: creatorSelect } } },
} satisfies Prisma.PostInclude;

type PostWithRelations = Prisma.PostGetPayload<{ include: typeof postInclude }>;

async function toPostDTO(post: PostWithRelations): Promise<PostDTO> {
  return {
    id: post.id,
    text: post.text,
    imageUrl: post.imageUrl,
    createdAt: post.createdAt.toISOString(),
    likeCount: post.likeCount,
    repostCount: post.repostCount,
    commentCount: post.commentCount,
    author: {
      id: post.author.id,
      name: post.author.name,
      handle: post.author.handle,
      image: post.author.image,
      isBot: post.author.isBot,
    },
    market: post.market ? await toMarketDTO(post.market) : null,
  };
}

// ---------------------------------------------------------------------------
// GET — paginated feed, newest first
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;

    const limitParam = Number.parseInt(searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const cursor = searchParams.get('cursor');

    // +1 trick: fetch one extra row to know whether a next page exists.
    const rows = await db.post.findMany({
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: postInclude,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    // Market DTOs fetch live AMM prices — serialize the page in parallel.
    const posts = await Promise.all(page.map((post) => toPostDTO(post)));

    return NextResponse.json({ posts, nextCursor });
  } catch (err) {
    console.error('[posts GET] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — create a post (session user or generator bot)
// ---------------------------------------------------------------------------

function botNameFromHandle(handle: string): string {
  const base = handle.startsWith('bot-') ? handle.slice('bot-'.length) : handle;
  return base.length > 0 ? base.charAt(0).toUpperCase() + base.slice(1) : handle;
}

/** Returns the parsed counter, the default 0, or null when invalid. */
function parseCounter(value: unknown): number | null {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const isGenerator = isGeneratorRequest(req);

  if (!session?.user?.id && !isGenerator) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body is required' }, { status: 400 });
  }

  const { text, imageUrl, marketId, authorHandle, likeCount, repostCount, commentCount } =
    body as Record<string, unknown>;

  // text — required, 1..500 chars after trim
  const trimmedText = typeof text === 'string' ? text.trim() : '';
  if (trimmedText.length < 1 || trimmedText.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: 'Text must be 1–500 characters' }, { status: 400 });
  }

  // imageUrl — optional
  if (imageUrl !== undefined && typeof imageUrl !== 'string') {
    return NextResponse.json({ error: 'imageUrl must be a string' }, { status: 400 });
  }

  // marketId — optional, must reference an existing market
  if (marketId !== undefined && (typeof marketId !== 'string' || !marketId.trim())) {
    return NextResponse.json({ error: 'marketId must be a non-empty string' }, { status: 400 });
  }

  // Counter overrides — generator-key requests only; session requests get defaults.
  let counters = { likeCount: 0, repostCount: 0, commentCount: 0 };
  if (isGenerator) {
    const like = parseCounter(likeCount);
    const repost = parseCounter(repostCount);
    const comment = parseCounter(commentCount);
    if (like === null || repost === null || comment === null) {
      return NextResponse.json(
        { error: 'Counters must be non-negative integers' },
        { status: 400 },
      );
    }
    counters = { likeCount: like, repostCount: repost, commentCount: comment };
  }

  try {
    if (marketId !== undefined) {
      const market = await db.market.findUnique({
        where: { id: marketId as string },
        select: { id: true },
      });
      if (!market) {
        return NextResponse.json({ error: 'Market not found' }, { status: 404 });
      }
    }

    // Resolve author: session user, or an upserted bot user for generator requests.
    let authorId: string;
    if (session?.user?.id && !isGenerator) {
      authorId = session.user.id;
    } else if (isGenerator) {
      let handle = DEFAULT_BOT_HANDLE;
      if (authorHandle !== undefined) {
        if (typeof authorHandle !== 'string' || !authorHandle.trim()) {
          return NextResponse.json(
            { error: 'authorHandle must be a non-empty string' },
            { status: 400 },
          );
        }
        handle = authorHandle.trim();
      }
      const bot = await db.user.upsert({
        where: { handle },
        create: {
          handle,
          name: botNameFromHandle(handle),
          isBot: true,
          image: BOT_IMAGE,
        },
        update: {},
        select: { id: true },
      });
      authorId = bot.id;
    } else {
      // Session present alongside generator key was handled above; unreachable in practice.
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const created = await db.post.create({
      data: {
        authorId,
        text: trimmedText,
        imageUrl: imageUrl !== undefined ? (imageUrl as string) : null,
        marketId: marketId !== undefined ? (marketId as string) : null,
        ...counters,
      },
      include: postInclude,
    });

    const post = await toPostDTO(created);
    return NextResponse.json({ post }, { status: 201 });
  } catch (err) {
    console.error('[posts POST] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
