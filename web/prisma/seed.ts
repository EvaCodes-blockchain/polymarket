// Prisma seed — creates the founder profile required for CEO-2 demo, and
// backfills the seeded El Clásico market (on-chain marketId 0) + one founder
// feed post embedding it (agentic sprint).
//
// The founder is the canonical "market creator" user shown in the prototype.
// Run with: pnpm db:seed (or: node_modules/.bin/tsx prisma/seed.ts)
//
// Idempotent: safe to run multiple times; uses upserts so re-running won't
// create duplicate records.
//
// FOUNDER CREDENTIALS (for local dev only):
//   email:    founder@justify.local
//   password: founder1234
//
// The handle used in GET /api/profile/[handle] for the founder:
//   /api/profile/founder@justify.local

import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

const FOUNDER_EMAIL = 'founder@justify.local';
const FOUNDER_PASSWORD = 'founder1234';
const FOUNDER_NAME = 'Founder';
const FOUNDER_HANDLE = 'founder';
const FOUNDER_IMAGE = '/img/leo.jpg';
const FOUNDER_BIO =
  'Founder of Justify — turning every hot take into a tradeable prediction market.';

const SEEDED_POST_TEXT = 'El Clasico - Barcelona vs Real Madrid! Who will win?';

/** Shape of the slice of contracts/deployments/ganache.json the seed needs. */
interface DeploymentsArtifact {
  chainId: number;
  seededMarket: {
    marketId: number;
    question: string;
    outcomeLabels: [string, string];
    oracleProofUrl?: string;
    contracts: {
      PredictionMarket: { address: string };
      MarketAMM: { address: string };
    };
  };
}

function loadDeployments(): DeploymentsArtifact {
  const file =
    process.env.DEPLOYMENTS_FILE ??
    path.join(process.cwd(), '..', 'contracts', 'deployments', 'ganache.json');
  const raw = fs.readFileSync(file, 'utf-8');
  return JSON.parse(raw) as DeploymentsArtifact;
}

async function main(): Promise<void> {
  console.log('🌱  Seeding founder profile…');

  const passwordHash = await bcrypt.hash(FOUNDER_PASSWORD, 12);

  // Upsert the User
  const founder = await db.user.upsert({
    where: { email: FOUNDER_EMAIL },
    update: {
      name: FOUNDER_NAME,
      handle: FOUNDER_HANDLE,
      image: FOUNDER_IMAGE,
      bio: FOUNDER_BIO,
    },
    create: {
      email: FOUNDER_EMAIL,
      name: FOUNDER_NAME,
      handle: FOUNDER_HANDLE,
      image: FOUNDER_IMAGE,
      bio: FOUNDER_BIO,
    },
    select: { id: true, email: true, name: true, handle: true },
  });

  // Upsert the credentials Account (provider=credentials, providerAccountId=hash)
  await db.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: 'credentials',
        providerAccountId: passwordHash,
      },
    },
    update: {},
    create: {
      userId: founder.id,
      type: 'credentials',
      provider: 'credentials',
      providerAccountId: passwordHash,
    },
  });

  console.log(`✅  Founder seeded: id=${founder.id} email=${founder.email} handle=${founder.handle}`);
  console.log(`    Sign-in at /sign-in with email="${FOUNDER_EMAIL}" password="${FOUNDER_PASSWORD}"`);
  console.log(`    Profile endpoint: GET /api/profile/${FOUNDER_EMAIL}`);

  // ── Backfill the seeded El Clásico market (on-chain marketId 0) ──────────
  console.log('🌱  Seeding El Clásico market…');

  const deployments = loadDeployments();
  const seeded = deployments.seededMarket;

  const closeTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days out

  const market = await db.market.upsert({
    where: { marketId: seeded.marketId },
    update: {
      question: seeded.question,
      outcomeYes: seeded.outcomeLabels[0],
      outcomeNo: seeded.outcomeLabels[1],
      marketAddress: seeded.contracts.PredictionMarket.address,
      ammAddress: seeded.contracts.MarketAMM.address,
      category: 'sports',
      imageUrl: '/img/el-classico.png',
      marketType: 'FUN',
      creatorId: founder.id,
    },
    create: {
      marketId: seeded.marketId,
      question: seeded.question,
      description:
        'The eternal rivalry: FC Barcelona face Real Madrid in El Clásico. ' +
        'Will Barcelona take the win? Settled by the official full-time result.',
      category: 'sports',
      imageUrl: '/img/el-classico.png',
      oracleProofUrl: seeded.oracleProofUrl ?? 'https://example.com/el-clasico-oracle',
      marketType: 'FUN',
      outcomeYes: seeded.outcomeLabels[0],
      outcomeNo: seeded.outcomeLabels[1],
      closeTime,
      status: 'LIVE',
      marketAddress: seeded.contracts.PredictionMarket.address,
      ammAddress: seeded.contracts.MarketAMM.address,
      creatorId: founder.id,
    },
    select: { id: true, marketId: true, question: true, ammAddress: true },
  });

  console.log(
    `✅  Market seeded: id=${market.id} marketId=${market.marketId} amm=${market.ammAddress}`
  );

  // ── One founder post embedding the market (create only if missing) ───────
  const existingPost = await db.post.findFirst({
    where: { authorId: founder.id, marketId: market.id },
    select: { id: true },
  });

  if (existingPost) {
    console.log(`✅  Founder post already exists: id=${existingPost.id}`);
  } else {
    const post = await db.post.create({
      data: {
        authorId: founder.id,
        text: SEEDED_POST_TEXT,
        marketId: market.id,
        likeCount: 30400,
        commentCount: 4000,
        repostCount: 617,
      },
      select: { id: true },
    });
    console.log(`✅  Founder post created: id=${post.id}`);
  }
}

main()
  .catch((e) => {
    console.error('❌  Seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
