// Markets catalog + creation (FR-MKT-1..3, agentic sprint)
//
// INTEGRATION CONTRACT (frozen — docs/delivery/agentic-sprint-contracts.md §4):
//
//   GET /api/markets?category=<cat>&status=<LIVE|CLOSED|RESOLVED>&cursor=<cuid>&limit=<n≤50>
//     Auth: none
//     200 { markets: MarketDTO[], nextCursor: string | null } — newest first,
//         cursor-based pagination (cursor = Market.id of the last item of the page)
//     500 { error }
//
//   POST /api/markets
//     Auth: NextAuth session OR x-generator-key header (401 otherwise)
//     Body: { question (1..120), description, category, imageUrl?,
//             oracleProofUrl (http/https URL), marketType? (FUN|CLASSIC|CHALLENGE),
//             outcomeYes? ("Yes"), outcomeNo? ("No"), closeTime (ISO, future),
//             seedYesUsdc? (default 500, clamped 10..10000), seedNoUsdc? (default 500),
//             creatorHandle? (generator-key only — upserts a bot user),
//             createPost? (boolean — also create a feed post embedding the market) }
//     201 { market: MarketDTO }
//     400 { error } — validation failure
//     401 { error } — no session and no valid generator key
//     502 { error } — on-chain market creation failed
//     500 { error } — server error

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { authOptions } from '@/lib/server/auth';
import { createMarketOnChain, type OnChainMarket } from '@/lib/server/chain';
import { db } from '@/lib/server/db';
import { isGeneratorRequest } from '@/lib/server/generatorAuth';
import { toMarketDTO, toMarketDTOs } from '@/lib/server/marketDto';

export const dynamic = 'force-dynamic';

const CREATOR_SELECT = {
  id: true,
  name: true,
  handle: true,
  image: true,
  isBot: true,
} as const;

const MARKET_TYPES = ['FUN', 'CLASSIC', 'CHALLENGE'] as const;
type MarketType = (typeof MARKET_TYPES)[number];

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const DEFAULT_SEED_USDC = 500;
const MIN_SEED_USDC = 10;
const MAX_SEED_USDC = 10_000;

const BOT_IMAGE = '/img/8805139.png';
const DEFAULT_BOT_HANDLE = 'bot-news';

// ---------------------------------------------------------------------------
// GET — paginated catalog, newest first
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;

    const category = searchParams.get('category')?.trim().toLowerCase() || undefined;
    const status = searchParams.get('status')?.trim().toUpperCase() || undefined;
    const cursor = searchParams.get('cursor')?.trim() || undefined;

    const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const rows = await db.market.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
      },
      include: { creator: { select: CREATOR_SELECT } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // +1 record to detect whether a next page exists
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lastOnPage = page[page.length - 1];
    const nextCursor = hasMore && lastOnPage ? lastOnPage.id : null;

    const markets = await toMarketDTOs(page);
    return NextResponse.json({ markets, nextCursor });
  } catch (err) {
    console.error('[markets GET] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — create a market (session user or generator bot)
// ---------------------------------------------------------------------------

interface ValidatedBody {
  question: string;
  description: string;
  category: string;
  imageUrl: string | null;
  oracleProofUrl: string;
  marketType: MarketType;
  outcomeYes: string;
  outcomeNo: string;
  closeTime: Date;
  seedYesUsdc: number;
  seedNoUsdc: number;
  creatorHandle: string | null;
  createPost: boolean;
}

function clampSeed(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_SEED_USDC;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, MIN_SEED_USDC), MAX_SEED_USDC);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Returns the validated body or a string describing the validation error. */
function validateBody(raw: Record<string, unknown>): ValidatedBody | string {
  const question = typeof raw.question === 'string' ? raw.question.trim() : '';
  if (question.length < 1 || question.length > 120) {
    return 'question is required (1..120 characters)';
  }

  if (typeof raw.description !== 'string') {
    return 'description is required (string)';
  }
  const description = raw.description;

  const category =
    typeof raw.category === 'string' ? raw.category.trim().toLowerCase() : '';
  if (!category) {
    return 'category is required (non-empty string)';
  }

  const oracleProofUrl =
    typeof raw.oracleProofUrl === 'string' ? raw.oracleProofUrl.trim() : '';
  if (!oracleProofUrl || !isHttpUrl(oracleProofUrl)) {
    return 'oracleProofUrl must be a valid http(s) URL';
  }

  let marketType: MarketType = 'FUN';
  if (raw.marketType !== undefined) {
    if (
      typeof raw.marketType !== 'string' ||
      !(MARKET_TYPES as readonly string[]).includes(raw.marketType)
    ) {
      return 'marketType must be one of FUN | CLASSIC | CHALLENGE';
    }
    marketType = raw.marketType as MarketType;
  }

  const outcomeYes =
    typeof raw.outcomeYes === 'string' && raw.outcomeYes.trim()
      ? raw.outcomeYes.trim()
      : 'Yes';
  const outcomeNo =
    typeof raw.outcomeNo === 'string' && raw.outcomeNo.trim()
      ? raw.outcomeNo.trim()
      : 'No';

  const closeTimeMs =
    typeof raw.closeTime === 'string' ? Date.parse(raw.closeTime) : Number.NaN;
  if (!Number.isFinite(closeTimeMs)) {
    return 'closeTime must be an ISO date string';
  }
  const closeTime = new Date(closeTimeMs);
  if (closeTime.getTime() <= Date.now()) {
    return 'closeTime must be in the future';
  }

  const seedYesUsdc = clampSeed(raw.seedYesUsdc);
  if (seedYesUsdc === null) return 'seedYesUsdc must be a number';
  const seedNoUsdc = clampSeed(raw.seedNoUsdc);
  if (seedNoUsdc === null) return 'seedNoUsdc must be a number';

  if (raw.imageUrl !== undefined && raw.imageUrl !== null && typeof raw.imageUrl !== 'string') {
    return 'imageUrl must be a string';
  }
  const imageUrl = typeof raw.imageUrl === 'string' && raw.imageUrl.trim() ? raw.imageUrl : null;

  if (raw.createPost !== undefined && typeof raw.createPost !== 'boolean') {
    return 'createPost must be a boolean';
  }
  const createPost = raw.createPost === true;

  if (
    raw.creatorHandle !== undefined &&
    raw.creatorHandle !== null &&
    typeof raw.creatorHandle !== 'string'
  ) {
    return 'creatorHandle must be a string';
  }
  const creatorHandle =
    typeof raw.creatorHandle === 'string' && raw.creatorHandle.trim()
      ? raw.creatorHandle.trim()
      : null;

  return {
    question,
    description,
    category,
    imageUrl,
    oracleProofUrl,
    marketType,
    outcomeYes,
    outcomeNo,
    closeTime,
    seedYesUsdc,
    seedNoUsdc,
    creatorHandle,
    createPost,
  };
}

/** "bot-news" → "News"; "founder" → "Founder". */
function botNameFromHandle(handle: string): string {
  const base = handle.startsWith('bot-') ? handle.slice('bot-'.length) : handle;
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : handle;
}

async function upsertBotUser(handle: string): Promise<string> {
  const user = await db.user.upsert({
    where: { handle },
    update: {},
    create: {
      handle,
      name: botNameFromHandle(handle),
      isBot: true,
      image: BOT_IMAGE,
    },
    select: { id: true },
  });
  return user.id;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const generator = isGeneratorRequest(req);
  const session = generator ? null : await getServerSession(authOptions);
  const sessionUserId = session?.user?.id ?? null;
  if (!generator && !sessionUserId) {
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

  const validated = validateBody(raw as Record<string, unknown>);
  if (typeof validated === 'string') {
    return NextResponse.json({ error: validated }, { status: 400 });
  }

  try {
    // Resolve creator: generator requests act as a bot user; sessions act as themselves.
    // creatorHandle is honored ONLY for generator-key requests.
    const creatorId = generator
      ? await upsertBotUser(validated.creatorHandle ?? DEFAULT_BOT_HANDLE)
      : sessionUserId;
    if (!creatorId) {
      // unreachable — guarded above; keeps the type narrow without assertions
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Create the market on-chain (factory createMarket + AMM seed).
    let onChain: OnChainMarket;
    try {
      onChain = await createMarketOnChain({
        question: validated.question,
        outcomeYes: validated.outcomeYes,
        outcomeNo: validated.outcomeNo,
        closeTime: validated.closeTime,
        oracleProofUrl: validated.oracleProofUrl,
        seedYesUsdc: validated.seedYesUsdc,
        seedNoUsdc: validated.seedNoUsdc,
      });
    } catch (err) {
      console.error('[markets POST] on-chain creation failed', err);
      return NextResponse.json(
        { error: 'On-chain market creation failed' },
        { status: 502 }
      );
    }

    const market = await db.market.create({
      data: {
        marketId: onChain.marketId,
        question: validated.question,
        description: validated.description,
        category: validated.category,
        imageUrl: validated.imageUrl,
        oracleProofUrl: validated.oracleProofUrl,
        marketType: validated.marketType,
        outcomeYes: validated.outcomeYes,
        outcomeNo: validated.outcomeNo,
        closeTime: validated.closeTime,
        marketAddress: onChain.marketAddress,
        ammAddress: onChain.ammAddress,
        txHash: onChain.txHash,
        creatorId,
      },
      include: { creator: { select: CREATOR_SELECT } },
    });

    if (validated.createPost) {
      await db.post.create({
        data: {
          authorId: creatorId,
          text: validated.question.slice(0, 500),
          imageUrl: validated.imageUrl,
          marketId: market.id,
        },
      });
    }

    return NextResponse.json({ market: await toMarketDTO(market) }, { status: 201 });
  } catch (err) {
    console.error('[markets POST] error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
