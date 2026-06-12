// Reconcile DB markets against the live chain — CI/CD pre-seed step.
//
// Postgres (postgres-data volume) and Ganache (ganache-data volume) persist
// independently; if the chain is ever reset while the DB survives (volume
// removed, `make down-volumes` on one side, fresh VPS), Market rows point at
// contract addresses with no code, and their on-chain marketIds collide with
// the ids a fresh MarketFactory hands out — blocking every new generated
// market on the `marketId @unique` constraint.
//
// This script deletes Market rows whose PredictionMarket address has no code
// on the chain, plus the feed posts embedding them (a market card without a
// market is dead weight in a test feed). Idempotent: a consistent DB/chain
// pair is a no-op.
//
// Safety: aborts (non-zero exit, no deletes) unless the RPC node is reachable
// AND reports the expected chain id — never prunes on doubt.
//
// Run with (from web/): npx tsx prisma/reconcile-markets.ts
// Env: DATABASE_URL, RPC_URL (defaults to http://localhost:8545),
//      NEXT_PUBLIC_CHAIN_ID / CHAIN_ID (expected chain id; defaults to 1337).

import { PrismaClient } from '@prisma/client';
import { createPublicClient, http } from 'viem';

const db = new PrismaClient();

const RPC_URL = process.env.RPC_URL ?? 'http://localhost:8545';
// Env-driven so reconcile works on Ganache (1337) or Arc (5042002) alike.
const EXPECTED_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.CHAIN_ID ?? '1337',
);

async function main(): Promise<void> {
  const client = createPublicClient({ transport: http(RPC_URL) });

  const chainId = await client.getChainId();
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `RPC ${RPC_URL} reports chain id ${chainId}, expected ${EXPECTED_CHAIN_ID} — refusing to reconcile`,
    );
  }

  const markets = await db.market.findMany({
    select: { id: true, marketId: true, marketAddress: true, question: true },
  });
  console.log(`🔎  Checking ${markets.length} DB market(s) against chain ${chainId} (${RPC_URL})…`);

  const orphans: typeof markets = [];
  for (const market of markets) {
    const code = await client.getCode({ address: market.marketAddress as `0x${string}` });
    if (!code || code === '0x') orphans.push(market);
  }

  if (orphans.length === 0) {
    console.log('✅  All DB markets have live contracts — nothing to reconcile.');
    return;
  }

  for (const o of orphans) {
    console.log(`  ✗ orphan: marketId=${o.marketId} ${o.marketAddress} "${o.question}"`);
  }

  const orphanIds = orphans.map((m) => m.id);
  const posts = await db.post.deleteMany({ where: { marketId: { in: orphanIds } } });
  const deleted = await db.market.deleteMany({ where: { id: { in: orphanIds } } });

  console.log(
    `✅  Reconciled: deleted ${deleted.count} orphaned market(s) and ${posts.count} embedding post(s).`,
  );
}

main()
  .catch((e) => {
    console.error('❌  Market reconcile failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
