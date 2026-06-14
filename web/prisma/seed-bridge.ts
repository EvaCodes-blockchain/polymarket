// Bridge dashboard seed (feature/bridge-1) — NEW, standalone, additive.
//
// Seeds MOCKED data for the bridging / Global Event Markets dashboard:
//   - 6 transport blockchains (BridgeChain), emphasizing the cross-chain
//     transports (Chainlink CCIP for EVM, Wormhole for Sui).
//   - 4 prediction-market systems (BridgeSystem): Justify (first-party) +
//     third-party venues (Polymarket, Azuro, SX Bet).
//   - >= 24 external markets (ExternalMarket), every chain with >= 3 and
//     every system with >= 3.
//
// This does NOT touch the existing markets/posts/users flow or prisma/seed.ts.
// Mocked-data only — no chain calls.
//
// Idempotent: chains/systems upsert by unique `key`; external markets use a
// findFirst-by-(systemKey, question) guard so re-running won't duplicate.
//
// Run with: node_modules/.bin/tsx prisma/seed-bridge.ts

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
/** Deterministic-ish future close time `days` out from a fixed-ish base. */
function future(days: number): Date {
  return new Date(Date.now() + days * DAY);
}
/** A past close time `days` ago (for CLOSED / RESOLVED markets). */
function past(days: number): Date {
  return new Date(Date.now() - days * DAY);
}

interface ChainSeed {
  key: string;
  name: string;
  chainId: string;
  family: string;
  transport: string;
  transportLabel: string;
  collateral: string;
  accent: string;
  explorerUrl: string;
  blurb: string;
  sortOrder: number;
}

const CHAINS: ChainSeed[] = [
  {
    key: 'arc',
    name: 'Arc (Circle)',
    chainId: '5042002',
    family: 'evm',
    transport: 'chainlink-ccip',
    transportLabel: 'Chainlink CCIP',
    collateral: 'USDC',
    accent: '#22d3ee',
    explorerUrl: 'https://explorer.arc.network',
    blurb:
      'Circle’s USDC-native settlement layer — Justify’s preferred home base, bridged in and out over Chainlink CCIP.',
    sortOrder: 1,
  },
  {
    key: 'base',
    name: 'Base',
    chainId: '8453',
    family: 'evm',
    transport: 'chainlink-ccip',
    transportLabel: 'Chainlink CCIP',
    collateral: 'USDC',
    accent: '#3b82f6',
    explorerUrl: 'https://basescan.org',
    blurb:
      'Coinbase’s L2 and the retail on-ramp for new traders — markets flow to and from Arc via Chainlink CCIP.',
    sortOrder: 2,
  },
  {
    key: 'ethereum',
    name: 'Ethereum',
    chainId: '1',
    family: 'evm',
    transport: 'chainlink-ccip',
    transportLabel: 'Chainlink CCIP',
    collateral: 'USDC',
    accent: '#6366f1',
    explorerUrl: 'https://etherscan.io',
    blurb:
      'The deepest-liquidity settlement layer for high-stakes markets — connected to the network through Chainlink CCIP.',
    sortOrder: 3,
  },
  {
    key: 'polygon',
    name: 'Polygon',
    chainId: '137',
    family: 'evm',
    transport: 'chainlink-ccip',
    transportLabel: 'Chainlink CCIP',
    collateral: 'USDC',
    accent: '#a855f7',
    explorerUrl: 'https://polygonscan.com',
    blurb:
      'Low-fee EVM chain and the original Polymarket home — bridged into Justify over Chainlink CCIP.',
    sortOrder: 4,
  },
  {
    key: 'bsc',
    name: 'BNB Smart Chain',
    chainId: '56',
    family: 'evm',
    transport: 'chainlink-ccip',
    transportLabel: 'Chainlink CCIP',
    collateral: 'USDC',
    accent: '#f59e0b',
    explorerUrl: 'https://bscscan.com',
    blurb:
      'High-throughput EVM chain reaching APAC retail flow — linked to Justify via Chainlink CCIP.',
    sortOrder: 5,
  },
  {
    key: 'sui',
    name: 'Sui',
    chainId: 'sui:mainnet',
    family: 'move',
    transport: 'wormhole',
    transportLabel: 'Wormhole',
    collateral: 'USDC',
    accent: '#d946ef',
    explorerUrl: 'https://suiscan.xyz',
    blurb:
      'A high-performance Move chain reaching non-EVM users — bridged to the EVM network over Wormhole.',
    sortOrder: 6,
  },
];

interface SystemSeed {
  key: string;
  name: string;
  kind: string;
  logoUrl: string | null;
  blurb: string;
  websiteUrl: string | null;
  sortOrder: number;
}

const SYSTEMS: SystemSeed[] = [
  {
    key: 'justify',
    name: 'Justify',
    kind: 'first-party',
    logoUrl: null,
    blurb: 'Native social prediction markets — every hot take, tradeable and bridged cross-chain.',
    websiteUrl: null,
    sortOrder: 1,
  },
  {
    key: 'polymarket',
    name: 'Polymarket (original)',
    kind: 'third-party',
    logoUrl: null,
    blurb: 'The original Polygon-based prediction market, aggregated for cross-chain discovery.',
    websiteUrl: 'https://polymarket.com',
    sortOrder: 2,
  },
  {
    key: 'azuro',
    name: 'Azuro Protocol',
    kind: 'third-party',
    logoUrl: null,
    blurb: 'Decentralized betting and prediction liquidity protocol, surfaced via the bridge.',
    websiteUrl: 'https://azuro.org',
    sortOrder: 3,
  },
  {
    key: 'sxbet',
    name: 'SX Bet',
    kind: 'third-party',
    logoUrl: null,
    blurb: 'Sports-focused prediction and betting venue, aggregated alongside Justify markets.',
    websiteUrl: 'https://sx.bet',
    sortOrder: 4,
  },
];

interface MarketSeed {
  systemKey: string;
  chainKey: string;
  question: string;
  category: string;
  priceYes: number;
  volumeUsdc: number;
  liquidityUsdc: number;
  closeTime: Date;
  status?: string; // default LIVE
  sourceUrl?: string;
}

// >= 24 external markets. Coverage targets:
//   chains: arc, base, ethereum, polygon, bsc, sui each >= 3
//   systems: justify, polymarket, azuro, sxbet each >= 3
const MARKETS: MarketSeed[] = [
  // ── Justify (first-party) — spread across ALL six chains ──────────────────
  {
    systemKey: 'justify',
    chainKey: 'arc',
    question: 'Will USDC supply on Arc exceed $5B by end of Q3 2026?',
    category: 'crypto',
    priceYes: 0.62,
    volumeUsdc: 412_000,
    liquidityUsdc: 88_000,
    closeTime: future(80),
    sourceUrl: '#',
  },
  {
    systemKey: 'justify',
    chainKey: 'base',
    question: 'Will Base process over 1B transactions in a single month in 2026?',
    category: 'crypto',
    priceYes: 0.71,
    volumeUsdc: 305_500,
    liquidityUsdc: 64_200,
    closeTime: future(120),
    sourceUrl: '#',
  },
  {
    systemKey: 'justify',
    chainKey: 'ethereum',
    question: 'Will ETH close above $5,000 on December 31, 2026?',
    category: 'crypto',
    priceYes: 0.44,
    volumeUsdc: 1_280_000,
    liquidityUsdc: 240_000,
    closeTime: future(200),
    sourceUrl: '#',
  },
  {
    systemKey: 'justify',
    chainKey: 'polygon',
    question: 'Will a major sports league launch official markets on Justify in 2026?',
    category: 'sports',
    priceYes: 0.33,
    volumeUsdc: 96_700,
    liquidityUsdc: 31_000,
    closeTime: future(150),
    sourceUrl: '#',
  },
  {
    systemKey: 'justify',
    chainKey: 'bsc',
    question: 'Will BNB flip its all-time high before the next halving cycle?',
    category: 'crypto',
    priceYes: 0.29,
    volumeUsdc: 154_300,
    liquidityUsdc: 42_500,
    closeTime: future(95),
    sourceUrl: '#',
  },
  {
    systemKey: 'justify',
    chainKey: 'sui',
    question: 'Will Sui rank in the top 10 chains by TVL at any point in 2026?',
    category: 'crypto',
    priceYes: 0.58,
    volumeUsdc: 211_900,
    liquidityUsdc: 57_400,
    closeTime: future(170),
    sourceUrl: '#',
  },
  {
    systemKey: 'justify',
    chainKey: 'arc',
    question: 'Will the Justify x Circle bridge settle over $1B notional in its first year?',
    category: 'crypto',
    priceYes: 0.49,
    volumeUsdc: 523_000,
    liquidityUsdc: 110_000,
    closeTime: future(300),
    sourceUrl: '#',
  },
  {
    systemKey: 'justify',
    chainKey: 'sui',
    question: 'Did the first Wormhole-bridged Justify market on Sui resolve YES?',
    category: 'tech',
    priceYes: 0.86,
    volumeUsdc: 78_200,
    liquidityUsdc: 0,
    closeTime: past(5),
    status: 'RESOLVED',
    sourceUrl: '#',
  },

  // ── Polymarket (original) — home on Polygon, a couple bridged to base/arc ──
  {
    systemKey: 'polymarket',
    chainKey: 'polygon',
    question: 'Will the US Federal Reserve cut rates at its next meeting?',
    category: 'politics',
    priceYes: 0.67,
    volumeUsdc: 4_350_000,
    liquidityUsdc: 920_000,
    closeTime: future(40),
    sourceUrl: 'https://polymarket.com',
  },
  {
    systemKey: 'polymarket',
    chainKey: 'polygon',
    question: 'Will Bitcoin reach a new all-time high in 2026?',
    category: 'crypto',
    priceYes: 0.78,
    volumeUsdc: 8_900_000,
    liquidityUsdc: 1_650_000,
    closeTime: future(200),
    sourceUrl: 'https://polymarket.com',
  },
  {
    systemKey: 'polymarket',
    chainKey: 'polygon',
    question: 'Will global average temperature set a new record in 2026?',
    category: 'science',
    priceYes: 0.81,
    volumeUsdc: 612_000,
    liquidityUsdc: 145_000,
    closeTime: future(210),
    sourceUrl: 'https://polymarket.com',
  },
  {
    systemKey: 'polymarket',
    chainKey: 'base',
    question: 'Will a US presidential candidate be declared winner before Nov 6, 2028?',
    category: 'politics',
    priceYes: 0.12,
    volumeUsdc: 220_000,
    liquidityUsdc: 60_000,
    closeTime: future(360),
    sourceUrl: 'https://polymarket.com',
  },
  {
    systemKey: 'polymarket',
    chainKey: 'arc',
    question: 'Will a top-5 prediction venue announce native USDC settlement on Arc in 2026?',
    category: 'crypto',
    priceYes: 0.41,
    volumeUsdc: 175_000,
    liquidityUsdc: 48_000,
    closeTime: future(140),
    sourceUrl: 'https://polymarket.com',
  },
  {
    systemKey: 'polymarket',
    chainKey: 'polygon',
    question: 'Did the EU pass landmark AI regulation in Q1 2026?',
    category: 'world',
    priceYes: 0.9,
    volumeUsdc: 333_000,
    liquidityUsdc: 0,
    closeTime: past(20),
    status: 'CLOSED',
    sourceUrl: 'https://polymarket.com',
  },

  // ── Azuro Protocol (third-party) — EVM subset ─────────────────────────────
  {
    systemKey: 'azuro',
    chainKey: 'polygon',
    question: 'Will the home team win the Champions League final?',
    category: 'sports',
    priceYes: 0.53,
    volumeUsdc: 740_000,
    liquidityUsdc: 190_000,
    closeTime: future(60),
    sourceUrl: 'https://azuro.org',
  },
  {
    systemKey: 'azuro',
    chainKey: 'base',
    question: 'Will the underdog cover the spread in the season opener?',
    category: 'sports',
    priceYes: 0.46,
    volumeUsdc: 128_000,
    liquidityUsdc: 37_000,
    closeTime: future(25),
    sourceUrl: 'https://azuro.org',
  },
  {
    systemKey: 'azuro',
    chainKey: 'ethereum',
    question: 'Will total Grand Slam tennis upsets exceed 10 this season?',
    category: 'sports',
    priceYes: 0.38,
    volumeUsdc: 95_000,
    liquidityUsdc: 26_000,
    closeTime: future(180),
    sourceUrl: 'https://azuro.org',
  },
  {
    systemKey: 'azuro',
    chainKey: 'bsc',
    question: 'Will an APAC esports team win the next international major?',
    category: 'sports',
    priceYes: 0.57,
    volumeUsdc: 210_000,
    liquidityUsdc: 54_000,
    closeTime: future(70),
    sourceUrl: 'https://azuro.org',
  },

  // ── SX Bet (third-party) — sports/world subset ────────────────────────────
  {
    systemKey: 'sxbet',
    chainKey: 'polygon',
    question: 'Will the reigning F1 champion repeat as world champion this season?',
    category: 'sports',
    priceYes: 0.64,
    volumeUsdc: 480_000,
    liquidityUsdc: 120_000,
    closeTime: future(160),
    sourceUrl: 'https://sx.bet',
  },
  {
    systemKey: 'sxbet',
    chainKey: 'base',
    question: 'Will any NFL team finish the regular season undefeated?',
    category: 'sports',
    priceYes: 0.08,
    volumeUsdc: 67_000,
    liquidityUsdc: 19_000,
    closeTime: future(110),
    sourceUrl: 'https://sx.bet',
  },
  {
    systemKey: 'sxbet',
    chainKey: 'ethereum',
    question: 'Will the host nation reach the semifinals of the next World Cup?',
    category: 'world',
    priceYes: 0.27,
    volumeUsdc: 156_000,
    liquidityUsdc: 41_000,
    closeTime: future(240),
    sourceUrl: 'https://sx.bet',
  },
  {
    systemKey: 'sxbet',
    chainKey: 'bsc',
    question: 'Will a new cricket T20 scoring record be set this tournament?',
    category: 'sports',
    priceYes: 0.35,
    volumeUsdc: 88_000,
    liquidityUsdc: 22_000,
    closeTime: future(50),
    sourceUrl: 'https://sx.bet',
  },

  // ── Extra coverage so ethereum/bsc/sui all reach >= 3 comfortably ─────────
  {
    systemKey: 'justify',
    chainKey: 'ethereum',
    question: 'Will a Justify market be embedded in a mainstream news broadcast in 2026?',
    category: 'tech',
    priceYes: 0.19,
    volumeUsdc: 44_000,
    liquidityUsdc: 12_500,
    closeTime: future(220),
    sourceUrl: '#',
  },
  {
    systemKey: 'justify',
    chainKey: 'bsc',
    question: 'Will daily active Justify traders on BNB Chain exceed 10k in 2026?',
    category: 'tech',
    priceYes: 0.31,
    volumeUsdc: 73_500,
    liquidityUsdc: 20_800,
    closeTime: future(130),
    sourceUrl: '#',
  },
  {
    systemKey: 'justify',
    chainKey: 'sui',
    question: 'Will Sui-native traders make up over 5% of Justify volume by year end?',
    category: 'crypto',
    priceYes: 0.24,
    volumeUsdc: 61_200,
    liquidityUsdc: 17_900,
    closeTime: future(190),
    sourceUrl: '#',
  },
  {
    systemKey: 'justify',
    chainKey: 'base',
    question: 'Will Justify surpass 100k registered users in 2026?',
    category: 'tech',
    priceYes: 0.55,
    volumeUsdc: 132_000,
    liquidityUsdc: 39_000,
    closeTime: future(250),
    sourceUrl: '#',
  },
];

async function main(): Promise<void> {
  console.log('\u{1F309}  Seeding bridge dashboard (chains, systems, external markets)…');

  // ── Chains ────────────────────────────────────────────────────────────────
  for (const c of CHAINS) {
    await db.bridgeChain.upsert({
      where: { key: c.key },
      update: {
        name: c.name,
        chainId: c.chainId,
        family: c.family,
        transport: c.transport,
        transportLabel: c.transportLabel,
        collateral: c.collateral,
        accent: c.accent,
        explorerUrl: c.explorerUrl,
        blurb: c.blurb,
        sortOrder: c.sortOrder,
      },
      create: c,
    });
  }
  console.log(`✅  Chains upserted: ${CHAINS.length}`);

  // ── Systems ─────────────────────────────────────────────────────────────
  for (const s of SYSTEMS) {
    await db.bridgeSystem.upsert({
      where: { key: s.key },
      update: {
        name: s.name,
        kind: s.kind,
        logoUrl: s.logoUrl,
        blurb: s.blurb,
        websiteUrl: s.websiteUrl,
        sortOrder: s.sortOrder,
      },
      create: s,
    });
  }
  console.log(`✅  Systems upserted: ${SYSTEMS.length}`);

  // ── External markets (idempotent via findFirst on systemKey+question) ─────
  let created = 0;
  let skipped = 0;
  for (const m of MARKETS) {
    const existing = await db.externalMarket.findFirst({
      where: { systemKey: m.systemKey, question: m.question },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await db.externalMarket.create({
      data: {
        systemKey: m.systemKey,
        chainKey: m.chainKey,
        question: m.question,
        category: m.category,
        priceYes: m.priceYes,
        volumeUsdc: m.volumeUsdc,
        liquidityUsdc: m.liquidityUsdc,
        closeTime: m.closeTime,
        status: m.status ?? 'LIVE',
        sourceUrl: m.sourceUrl ?? '#',
      },
    });
    created += 1;
  }
  console.log(`✅  External markets: ${created} created, ${skipped} already present`);

  // ── Report counts per chain and per system ────────────────────────────────
  const byChain = await db.externalMarket.groupBy({
    by: ['chainKey'],
    _count: { _all: true },
    orderBy: { chainKey: 'asc' },
  });
  const bySystem = await db.externalMarket.groupBy({
    by: ['systemKey'],
    _count: { _all: true },
    orderBy: { systemKey: 'asc' },
  });
  const total = await db.externalMarket.count();

  console.log('\n── Counts per chain ──');
  for (const row of byChain) {
    console.log(`  ${row.chainKey.padEnd(10)} ${row._count._all}`);
  }
  console.log('\n── Counts per system ──');
  for (const row of bySystem) {
    console.log(`  ${row.systemKey.padEnd(12)} ${row._count._all}`);
  }
  console.log(`\nTotal external markets: ${total}`);
}

main()
  .catch((e) => {
    console.error('❌  Bridge seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
