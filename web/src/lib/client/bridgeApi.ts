/**
 * Bridge dashboard client API — FROZEN integration contract for feature/bridge-1
 * (the bridging dashboard + Global Event Markets Dashboard).
 *
 * This is a NEW, additive surface. It does NOT replace or modify the existing
 * markets API (web/src/lib/client/api.ts) — it sits alongside it and is served
 * entirely from mocked Postgres data (no on-chain calls, no real smart
 * contracts). Consumers import these types and fetchers — never redefine them.
 *
 * Conceptual model (see documentation_bridge/ and documentation_sui/):
 *   - A "transport blockchain" is a chain Justify bridges markets across
 *     (Arc, Base, Ethereum, Polygon, BSC, Sui). Each carries a transport
 *     (Chainlink CCIP for EVM↔EVM, Wormhole for Sui↔EVM).
 *   - A "system" is a prediction-market venue the dashboard aggregates —
 *     Justify itself plus third-party systems (e.g. the original Polymarket).
 *   - An "external market" is one market as surfaced by a system on a chain.
 */

// ── DTO types ────────────────────────────────────────────────────────────────

/** A blockchain Justify uses as a bridge transport substrate. */
export interface BridgeChainDTO {
  /** stable slug, e.g. "arc", "base", "ethereum", "polygon", "bsc", "sui" */
  key: string;
  /** display name, e.g. "Arc (Circle)" */
  name: string;
  /** native chain id (EVM numeric, or a string id for non-EVM like Sui) */
  chainId: string;
  /** EVM family or not — drives which transport is used */
  family: 'evm' | 'move';
  /** the cross-chain transport used to/from this chain */
  transport: 'chainlink-ccip' | 'wormhole' | 'native';
  /** human label for the transport, e.g. "Chainlink CCIP", "Wormhole" */
  transportLabel: string;
  /** collateral asset symbol, e.g. "USDC" */
  collateral: string;
  /** short hex/role accent for UI chips, e.g. "#6366f1" */
  accent: string;
  /** explorer base URL (display only) */
  explorerUrl: string | null;
  /** marketing one-liner on the chain's strategic role */
  blurb: string;
  /** count of external markets mocked on this chain (denormalized for cards) */
  marketCount: number;
}

/** A prediction-market venue aggregated by the dashboard. */
export interface BridgeSystemDTO {
  /** slug, e.g. "justify", "polymarket", "azuro" */
  key: string;
  /** display name, e.g. "Justify", "Polymarket (original)" */
  name: string;
  /** is this our own system vs a third-party venue */
  kind: 'first-party' | 'third-party';
  /** logo path under /public (display only) */
  logoUrl: string | null;
  /** chains (keys) this system has markets on in the mocked data */
  chainKeys: string[];
  /** short description shown in the chooser */
  blurb: string;
  /** external site (display only) */
  websiteUrl: string | null;
}

/** One market surfaced by a system on a chain (mocked, read-only). */
export interface ExternalMarketDTO {
  /** stable id (cuid) */
  id: string;
  /** system slug this market belongs to */
  systemKey: string;
  /** chain slug this market lives on */
  chainKey: string;
  question: string;
  category: string;
  imageUrl: string | null;
  /** YES probability 0..1 */
  priceYes: number;
  priceNo: number;
  /** Math.round(priceYes * 100) */
  chancePct: number;
  /** notional volume in USDC */
  volumeUsdc: number;
  /** total open interest / liquidity in USDC */
  liquidityUsdc: number;
  outcomeYes: string;
  outcomeNo: string;
  closeTime: string; // ISO
  status: 'LIVE' | 'CLOSED' | 'RESOLVED';
  /** deep link to the source venue (display only; "#" for mocked) */
  sourceUrl: string | null;
}

// ── Response envelopes ───────────────────────────────────────────────────────

export interface BridgeChainsResponse {
  chains: BridgeChainDTO[];
}

export interface BridgeSystemsResponse {
  systems: BridgeSystemDTO[];
}

export interface BridgeMarketsResponse {
  markets: ExternalMarketDTO[];
  /** echoed filters so the UI can confirm what it asked for */
  filter: { chainKey: string | null; systemKey: string | null };
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status} ${url}`);
  }
  return (await res.json()) as T;
}

/** All transport blockchains, newest-first-irrelevant (returns a fixed set). */
export async function fetchBridgeChains(): Promise<BridgeChainsResponse> {
  return getJson<BridgeChainsResponse>('/api/bridge/chains');
}

/** All aggregated systems (Justify + third-party venues). */
export async function fetchBridgeSystems(): Promise<BridgeSystemsResponse> {
  return getJson<BridgeSystemsResponse>('/api/bridge/systems');
}

/** Markets, optionally filtered by chain and/or system. */
export async function fetchBridgeMarkets(params?: {
  chainKey?: string;
  systemKey?: string;
}): Promise<BridgeMarketsResponse> {
  const q = new URLSearchParams();
  if (params?.chainKey) q.set('chain', params.chainKey);
  if (params?.systemKey) q.set('system', params.systemKey);
  const qs = q.toString();
  return getJson<BridgeMarketsResponse>(`/api/bridge/markets${qs ? `?${qs}` : ''}`);
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function formatUsdcShort(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}

/** Tailwind-ish accent classes per transport, for chips/badges. */
export function transportBadgeClass(transport: BridgeChainDTO['transport']): string {
  switch (transport) {
    case 'chainlink-ccip':
      return 'bg-blue-500/15 text-blue-300 border border-blue-500/30';
    case 'wormhole':
      return 'bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30';
    default:
      return 'bg-white/10 text-gray-300 border border-white/20';
  }
}
