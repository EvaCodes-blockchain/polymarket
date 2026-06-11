// Users generator — creates the initial demo user set + generator bots + a
// deterministic follow graph (agentic sprint goal 4: "Users generator").
//
// Run with (from web/):
//   corepack pnpm exec tsx prisma/seed-users.ts
// (DATABASE_URL must be in the environment — source web/.env first.)
//
// Idempotent: safe to run multiple times; users are upserted, credentials
// accounts are created only when missing, follow rows use skipDuplicates.
//
// What it creates:
//   - 12 demo users with crypto-twitter personas (images all exist in
//     web/public/img). Each has a credentials account:
//       email:    <handle>@demo.justify.local
//       password: demo1234
//   - 3 generator bots (bot-news / bot-sports / bot-business, isBot: true) —
//     upserted by handle so they coexist with the markets API's bot upserts.
//   - Follow graph: every demo user follows the founder (handle "founder",
//     seeded by prisma/seed.ts — run that first), so the founder is always the
//     most-followed user; then each demo user follows 2–5 other demo users via
//     a seeded LCG (deterministic across runs).

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

const DEMO_PASSWORD = 'demo1234';
const DEMO_EMAIL_DOMAIN = 'demo.justify.local';
const BOT_IMAGE = '/img/8805139.png';
const FOUNDER_HANDLE = 'founder';
const LCG_SEED = 1337;

interface DemoUserSpec {
  handle: string;
  name: string;
  image: string; // must exist in web/public/img
  bio: string;
}

// All images verified against web/public/img — never reference a missing file.
const DEMO_USERS: DemoUserSpec[] = [
  {
    handle: 'vitalik',
    name: 'Vitalik',
    image: '/img/vitalik.jpg',
    bio: 'Ethereum researcher energy. Quadratic everything. Prediction markets are info finance.',
  },
  {
    handle: 'cryptowhale',
    name: 'Crypto Whale',
    image: '/img/zVpm_8at_400x400.jpg',
    bio: 'Moving markets since 2017. My buys are your exit liquidity. Not financial advice.',
  },
  {
    handle: 'sofiachen',
    name: 'Sofia Chen',
    image: '/img/1605931037447.jpeg',
    bio: 'Macro analyst. Prediction markets are the purest form of price discovery.',
  },
  {
    handle: 'degendave',
    name: 'Degen Dave',
    image: '/img/download.jpeg',
    bio: 'Full-time degen, part-time oracle. Either 100x or instant ramen. No in-between.',
  },
  {
    handle: 'yorha2b',
    name: '2B',
    image: '/img/2b.jpeg',
    bio: 'Anime PFP, machine-like execution. I trade the probabilities, not the vibes.',
  },
  {
    handle: 'satoshijr',
    name: 'Satoshi Jr',
    image: '/img/images.jpeg',
    bio: 'Running a full node since before it was cool. Verify, then bet.',
  },
  {
    handle: 'marketmaven',
    name: 'Market Maven',
    image: '/img/30923488-6597266487e33.jpg',
    bio: 'If it can happen, it can be priced. I put odds on everything.',
  },
  {
    handle: 'madridista',
    name: 'Madridista Prime',
    image: '/img/rmate1.jpg',
    bio: 'Hala Madrid. Betting YES on every Clasico and never logging losses.',
  },
  {
    handle: 'culerforever',
    name: 'Culer Forever',
    image: '/img/rmate2.jpg',
    bio: 'Visca Barca. Fading every Madrid market on principle.',
  },
  {
    handle: 'goalpostgary',
    name: 'Goalpost Gary',
    image: '/img/rmate3.jpg',
    bio: 'Sports markets only. Expected goals are just probabilities with shin pads.',
  },
  {
    handle: 'pitchsidepundit',
    name: 'Pitchside Pundit',
    image: '/img/rmate4.jpg',
    bio: 'Hot takes, cold odds. I call the result before the lineup drops.',
  },
  {
    handle: 'ballknower',
    name: 'Ball Knower',
    image: '/img/rmate5.jpg',
    bio: 'I simply know ball. Sweeping the football markets one Clasico at a time.',
  },
];

const BOT_USERS: DemoUserSpec[] = [
  {
    handle: 'bot-news',
    name: 'News',
    image: BOT_IMAGE,
    bio: 'Generator bot — auto-creates test markets from world news headlines. Not a human.',
  },
  {
    handle: 'bot-sports',
    name: 'Sports',
    image: BOT_IMAGE,
    bio: 'Generator bot — auto-creates test markets from sports headlines. Not a human.',
  },
  {
    handle: 'bot-business',
    name: 'Business',
    image: BOT_IMAGE,
    bio: 'Generator bot — auto-creates test markets from business headlines. Not a human.',
  },
];

// ---------------------------------------------------------------------------
// Deterministic pseudo-random source — inline LCG (numerical recipes constants),
// no deps. Same seed → same follow graph on every run (idempotency-friendly).
// ---------------------------------------------------------------------------
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Deterministic Fisher–Yates shuffle (copy, not in place). */
function shuffled<T>(items: T[], rand: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
  return arr;
}

interface UpsertResult {
  id: string;
  handle: string;
  created: boolean;
}

async function upsertDemoUser(spec: DemoUserSpec): Promise<UpsertResult> {
  const email = `${spec.handle}@${DEMO_EMAIL_DOMAIN}`;

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });

  const user = await db.user.upsert({
    where: { email },
    update: {
      name: spec.name,
      handle: spec.handle,
      image: spec.image,
      bio: spec.bio,
      isBot: false,
    },
    create: {
      email,
      name: spec.name,
      handle: spec.handle,
      image: spec.image,
      bio: spec.bio,
      isBot: false,
    },
    select: { id: true },
  });

  // Credentials account (hash stored as providerAccountId — same pattern as
  // prisma/seed.ts). bcrypt salts differ per run, so create only when missing
  // to keep re-runs from stacking duplicate accounts.
  const credAccount = await db.account.findFirst({
    where: { userId: user.id, provider: 'credentials' },
    select: { id: true },
  });
  if (!credAccount) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    await db.account.create({
      data: {
        userId: user.id,
        type: 'credentials',
        provider: 'credentials',
        providerAccountId: passwordHash,
      },
    });
  }

  return { id: user.id, handle: spec.handle, created: existing === null };
}

async function upsertBotUser(spec: DemoUserSpec): Promise<UpsertResult> {
  // Keyed by handle (no email) so the markets API's own bot upserts (also
  // keyed by handle) coexist — whichever runs first, the other only updates.
  const existing = await db.user.findUnique({
    where: { handle: spec.handle },
    select: { id: true },
  });

  const user = await db.user.upsert({
    where: { handle: spec.handle },
    update: {
      name: spec.name,
      image: spec.image,
      bio: spec.bio,
      isBot: true,
    },
    create: {
      handle: spec.handle,
      name: spec.name,
      image: spec.image,
      bio: spec.bio,
      isBot: true,
    },
    select: { id: true },
  });

  return { id: user.id, handle: spec.handle, created: existing === null };
}

async function main(): Promise<void> {
  console.log('🌱  Seeding demo users + generator bots…');

  // Founder must exist (prisma/seed.ts) — the follow graph centers on them.
  const founder = await db.user.findUnique({
    where: { handle: FOUNDER_HANDLE },
    select: { id: true },
  });
  if (!founder) {
    throw new Error(
      `Founder (handle "${FOUNDER_HANDLE}") not found — run "corepack pnpm exec tsx prisma/seed.ts" first.`,
    );
  }

  // ── Demo users ────────────────────────────────────────────────────────────
  const demoResults: UpsertResult[] = [];
  for (const spec of DEMO_USERS) {
    demoResults.push(await upsertDemoUser(spec));
  }

  // ── Bot users ─────────────────────────────────────────────────────────────
  const botResults: UpsertResult[] = [];
  for (const spec of BOT_USERS) {
    botResults.push(await upsertBotUser(spec));
  }

  // ── Follow graph ──────────────────────────────────────────────────────────
  // 1. Every demo user follows the founder → founder is always most-followed
  //    (12 followers; no demo user can exceed 11 from the random graph below).
  // 2. Each demo user follows 2–5 other demo users, chosen by a seeded LCG —
  //    deterministic across runs, deduped by the unique constraint.
  const rand = makeLcg(LCG_SEED);
  const followRows: { followerId: string; followeeId: string }[] = [];

  for (const follower of demoResults) {
    followRows.push({ followerId: follower.id, followeeId: founder.id });

    const others = demoResults.filter((u) => u.id !== follower.id);
    const count = 2 + Math.floor(rand() * 4); // 2..5
    for (const followee of shuffled(others, rand).slice(0, count)) {
      followRows.push({ followerId: follower.id, followeeId: followee.id });
    }
  }

  const followResult = await db.follow.createMany({
    data: followRows,
    skipDuplicates: true,
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const createdDemo = demoResults.filter((r) => r.created).length;
  const createdBots = botResults.filter((r) => r.created).length;

  console.log('');
  console.table([
    {
      group: 'demo users',
      total: demoResults.length,
      created: createdDemo,
      existing: demoResults.length - createdDemo,
    },
    {
      group: 'bot users',
      total: botResults.length,
      created: createdBots,
      existing: botResults.length - createdBots,
    },
    {
      group: 'follows',
      total: followRows.length,
      created: followResult.count,
      existing: followRows.length - followResult.count,
    },
  ]);

  const founderFollowers = await db.follow.count({ where: { followeeId: founder.id } });
  console.log(`✅  Founder follower count: ${founderFollowers}`);
  console.log(
    `    Demo sign-in: email="<handle>@${DEMO_EMAIL_DOMAIN}" password="${DEMO_PASSWORD}"`,
  );
}

main()
  .catch((e) => {
    console.error('❌  Users seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
