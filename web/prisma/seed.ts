// Prisma seed — creates the founder profile required for CEO-2 demo.
//
// The founder is the canonical "market creator" user shown in the prototype.
// Run with: pnpm db:seed (or: node_modules/.bin/ts-node prisma/seed.ts)
//
// Idempotent: safe to run multiple times; uses upsert so re-running won't
// create duplicate records.
//
// FOUNDER CREDENTIALS (for local dev only):
//   email:    founder@justify.local
//   password: founder1234
//
// The handle used in GET /api/profile/[handle] for the founder:
//   /api/profile/founder@justify.local

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

const FOUNDER_EMAIL = 'founder@justify.local';
const FOUNDER_PASSWORD = 'founder1234';
const FOUNDER_NAME = 'Founder';

async function main(): Promise<void> {
  console.log('🌱  Seeding founder profile…');

  const passwordHash = await bcrypt.hash(FOUNDER_PASSWORD, 12);

  // Upsert the User
  const founder = await db.user.upsert({
    where: { email: FOUNDER_EMAIL },
    update: { name: FOUNDER_NAME },
    create: {
      email: FOUNDER_EMAIL,
      name: FOUNDER_NAME,
      image: null,
    },
    select: { id: true, email: true, name: true },
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

  console.log(`✅  Founder seeded: id=${founder.id} email=${founder.email}`);
  console.log(`    Sign-in at /sign-in with email="${FOUNDER_EMAIL}" password="${FOUNDER_PASSWORD}"`);
  console.log(`    Profile endpoint: GET /api/profile/${FOUNDER_EMAIL}`);
}

main()
  .catch((e) => {
    console.error('❌  Seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
