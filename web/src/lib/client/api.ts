/**
 * Client API library — FROZEN integration contract for the agentic sprint.
 * DTO shapes mirror the server serializers (web/src/lib/server/marketDto.ts and
 * the /api/markets, /api/posts, /api/users route handlers).
 *
 * Consumers import these types and fetchers — never redefine them.
 * Breaking changes go through the orchestrator (docs/delivery/agentic-sprint-contracts.md).
 */

// ── DTO types ────────────────────────────────────────────────────────────────

export interface CreatorRefDTO {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
  isBot: boolean;
}

export interface MarketDTO {
  id: string; // Market.id (cuid)
  marketId: number; // on-chain id
  question: string;
  description: string;
  category: string;
  imageUrl: string | null;
  oracleProofUrl: string;
  marketType: 'FUN' | 'CLASSIC' | 'CHALLENGE';
  outcomeYes: string;
  outcomeNo: string;
  priceYes: number; // 0..1, live from AMM (0.5 fallback when chain unreachable)
  priceNo: number;
  chancePct: number; // Math.round(priceYes * 100)
  volumeUsdc: number;
  closeTime: string; // ISO
  createdAt: string; // ISO
  status: 'LIVE' | 'CLOSED' | 'RESOLVED';
  addresses: {
    market: `0x${string}`;
    amm: `0x${string}`;
  };
  creator: CreatorRefDTO;
}

export interface PostDTO {
  id: string;
  text: string;
  imageUrl: string | null;
  createdAt: string; // ISO
  likeCount: number;
  repostCount: number;
  commentCount: number;
  author: CreatorRefDTO;
  market: MarketDTO | null;
}

export interface UserSummaryDTO {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
  bio: string | null;
  isBot: boolean;
  followerCount: number;
  followingCount: number;
  viewerFollows: boolean;
}

// ── Response envelopes ───────────────────────────────────────────────────────

export interface MarketsResponse {
  markets: MarketDTO[];
  nextCursor: string | null;
}

export interface PostsResponse {
  posts: PostDTO[];
  nextCursor: string | null;
}

export interface UsersResponse {
  users: UserSummaryDTO[];
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

export async function fetchMarkets(params?: {
  category?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}): Promise<MarketsResponse> {
  const q = new URLSearchParams();
  if (params?.category) q.set('category', params.category);
  if (params?.status) q.set('status', params.status);
  if (params?.cursor) q.set('cursor', params.cursor);
  if (params?.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return getJson<MarketsResponse>(`/api/markets${qs ? `?${qs}` : ''}`);
}

export async function fetchMarket(id: string): Promise<MarketDTO> {
  const data = await getJson<{ market: MarketDTO }>(`/api/markets/${encodeURIComponent(id)}`);
  return data.market;
}

export async function fetchPosts(params?: {
  cursor?: string;
  limit?: number;
}): Promise<PostsResponse> {
  const q = new URLSearchParams();
  if (params?.cursor) q.set('cursor', params.cursor);
  if (params?.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return getJson<PostsResponse>(`/api/posts${qs ? `?${qs}` : ''}`);
}

export async function fetchUsers(params?: {
  limit?: number;
  bots?: 'include' | 'exclude';
  order?: 'followers' | 'recent';
}): Promise<UsersResponse> {
  const q = new URLSearchParams();
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.bots) q.set('bots', params.bots);
  if (params?.order) q.set('order', params.order);
  const qs = q.toString();
  return getJson<UsersResponse>(`/api/users${qs ? `?${qs}` : ''}`);
}

/** Mint test USDC to an address via the server faucet (Ganache only). */
export async function requestFaucet(address: `0x${string}`, amountUsdc?: number): Promise<string> {
  const res = await fetch('/api/faucet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, ...(amountUsdc ? { amountUsdc } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Faucet failed: ${res.status}`);
  }
  const data = (await res.json()) as { txHash: string };
  return data.txHash;
}

// ── Display helpers (shared) ─────────────────────────────────────────────────

export function formatVolume(volumeUsdc: number): string {
  if (volumeUsdc >= 1_000_000) return `$${(volumeUsdc / 1_000_000).toFixed(1)}M Vol.`;
  if (volumeUsdc >= 1_000) return `$${(volumeUsdc / 1_000).toFixed(1)}k Vol.`;
  return `$${Math.round(volumeUsdc)} Vol.`;
}

export function formatCloseTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()} ${hh}.${min}`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
