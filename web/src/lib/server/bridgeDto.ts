// Bridge dashboard DTO serializers — feature/bridge-1 (NEW, additive).
// Maps Prisma rows (BridgeChain, BridgeSystem, ExternalMarket) to the FROZEN
// DTO shapes from web/src/lib/client/bridgeApi.ts. Mocked-data only — no
// on-chain calls. Derived fields (priceNo, chancePct, marketCount, chainKeys)
// are computed here at request time, never stored in the DB.

import type { BridgeChain, BridgeSystem, ExternalMarket } from '@prisma/client';

import type {
  BridgeChainDTO,
  BridgeSystemDTO,
  ExternalMarketDTO,
} from '@/lib/client/bridgeApi';

const FAMILIES: ReadonlyArray<BridgeChainDTO['family']> = ['evm', 'move'];
const TRANSPORTS: ReadonlyArray<BridgeChainDTO['transport']> = [
  'chainlink-ccip',
  'wormhole',
  'native',
];
const KINDS: ReadonlyArray<BridgeSystemDTO['kind']> = ['first-party', 'third-party'];
const STATUSES: ReadonlyArray<ExternalMarketDTO['status']> = ['LIVE', 'CLOSED', 'RESOLVED'];

function asFamily(value: string): BridgeChainDTO['family'] {
  return (FAMILIES as readonly string[]).includes(value)
    ? (value as BridgeChainDTO['family'])
    : 'evm';
}

function asTransport(value: string): BridgeChainDTO['transport'] {
  return (TRANSPORTS as readonly string[]).includes(value)
    ? (value as BridgeChainDTO['transport'])
    : 'native';
}

function asKind(value: string): BridgeSystemDTO['kind'] {
  return (KINDS as readonly string[]).includes(value)
    ? (value as BridgeSystemDTO['kind'])
    : 'third-party';
}

function asStatus(value: string): ExternalMarketDTO['status'] {
  return (STATUSES as readonly string[]).includes(value)
    ? (value as ExternalMarketDTO['status'])
    : 'LIVE';
}

/**
 * Serialize a BridgeChain row.
 * @param chain      the Prisma row
 * @param marketCount count of external markets on this chain (derived upstream
 *                    via a grouped count, passed in to avoid N+1 queries)
 */
export function toBridgeChainDTO(chain: BridgeChain, marketCount: number): BridgeChainDTO {
  return {
    key: chain.key,
    name: chain.name,
    chainId: chain.chainId,
    family: asFamily(chain.family),
    transport: asTransport(chain.transport),
    transportLabel: chain.transportLabel,
    collateral: chain.collateral,
    accent: chain.accent,
    explorerUrl: chain.explorerUrl,
    blurb: chain.blurb,
    marketCount,
  };
}

/**
 * Serialize a BridgeSystem row.
 * @param system    the Prisma row
 * @param chainKeys distinct chain slugs this system has markets on, already
 *                  ordered by the chain's sortOrder (derived upstream)
 */
export function toBridgeSystemDTO(system: BridgeSystem, chainKeys: string[]): BridgeSystemDTO {
  return {
    key: system.key,
    name: system.name,
    kind: asKind(system.kind),
    logoUrl: system.logoUrl,
    chainKeys,
    blurb: system.blurb,
    websiteUrl: system.websiteUrl,
  };
}

/**
 * Serialize an ExternalMarket row. priceNo and chancePct are derived from the
 * stored priceYes (priceNo = 1 - priceYes; chancePct = round(priceYes * 100)).
 */
export function toExternalMarketDTO(market: ExternalMarket): ExternalMarketDTO {
  const priceYes = market.priceYes;
  return {
    id: market.id,
    systemKey: market.systemKey,
    chainKey: market.chainKey,
    question: market.question,
    category: market.category,
    imageUrl: market.imageUrl,
    priceYes,
    priceNo: 1 - priceYes,
    chancePct: Math.round(priceYes * 100),
    volumeUsdc: market.volumeUsdc,
    liquidityUsdc: market.liquidityUsdc,
    outcomeYes: market.outcomeYes,
    outcomeNo: market.outcomeNo,
    closeTime: market.closeTime.toISOString(),
    status: asStatus(market.status),
    sourceUrl: market.sourceUrl,
  };
}

export function toExternalMarketDTOs(markets: ExternalMarket[]): ExternalMarketDTO[] {
  return markets.map((m) => toExternalMarketDTO(m));
}
