/**
 * Safety rails — testing-market-generator.md Section 6.
 *
 * Environment lock: refuse to run unless the API base URL hostname is in an
 * explicit allowlist AND the chain ID reported by the RPC node is 1337 (0x539).
 * Extra hostnames can be permitted via EXTRA_ALLOWED_HOSTS (comma-separated) —
 * docker compose sets EXTRA_ALLOWED_HOSTS=web for the in-network API URL.
 *
 * Content filter: skip headlines matching a denylist (tragedies, violence) —
 * a betting card on a tragedy headline is unacceptable even as test data.
 */

import type { Headline } from './news.js';

export const ALLOWED_HOSTS = ['localhost', '127.0.0.1'] as const;
export const ALLOWED_HOST_SUFFIXES = ['.test', '.staging'] as const;

export const EXPECTED_CHAIN_ID_HEX = '0x539'; // 1337

export const DEFAULT_DENYLIST = [
  'dead',
  'dies',
  'killed',
  'death',
  'shooting',
  'war crime',
  'massacre',
  'terror',
  'hostage',
  'earthquake',
  'crash kills',
  'suicide',
] as const;

/** True iff the URL's hostname is allowed (never target production). */
export function isAllowedBaseUrl(
  apiBaseUrl: string,
  extraAllowedHosts: readonly string[] = [],
): boolean {
  let hostname: string;
  try {
    hostname = new URL(apiBaseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if ((ALLOWED_HOSTS as readonly string[]).includes(hostname)) return true;
  if (ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;
  if (extraAllowedHosts.includes(hostname)) return true;
  return false;
}

interface JsonRpcResponse {
  result?: string;
  error?: { message?: string };
}

/**
 * Query eth_chainId on the RPC node and verify it is 1337 (0x539).
 * Returns an error string on mismatch/failure, null when OK.
 */
export async function checkChainId(rpcUrl: string): Promise<string | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    if (!res.ok) return `RPC ${rpcUrl} responded ${res.status}`;
    const body = (await res.json()) as JsonRpcResponse;
    if (typeof body.result !== 'string') {
      return `RPC ${rpcUrl} returned no chainId (${body.error?.message ?? 'unknown error'})`;
    }
    const chainIdHex = body.result.toLowerCase();
    if (chainIdHex !== EXPECTED_CHAIN_ID_HEX) {
      return `Chain ID mismatch: expected ${EXPECTED_CHAIN_ID_HEX} (1337), got ${chainIdHex}`;
    }
    return null;
  } catch (err) {
    return `RPC ${rpcUrl} unreachable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Full environment lock. Returns a refusal reason string, or null when safe.
 */
export async function environmentLock(params: {
  apiBaseUrl: string;
  rpcUrl: string;
  extraAllowedHosts?: readonly string[];
}): Promise<string | null> {
  if (!isAllowedBaseUrl(params.apiBaseUrl, params.extraAllowedHosts ?? [])) {
    return (
      `API_BASE_URL "${params.apiBaseUrl}" is not in the allowlist ` +
      `(${[...ALLOWED_HOSTS].join(', ')}, *${ALLOWED_HOST_SUFFIXES.join(', *')}` +
      `${params.extraAllowedHosts?.length ? `, ${params.extraAllowedHosts.join(', ')}` : ''}) — refusing to run`
    );
  }
  return checkChainId(params.rpcUrl);
}

/** True iff the headline matches the denylist and must be skipped. */
export function isDenied(
  title: string,
  denylist: readonly string[] = DEFAULT_DENYLIST,
): boolean {
  const normalized = title.toLowerCase();
  return denylist.some((term) => normalized.includes(term.toLowerCase()));
}

/** Filter out denylisted headlines. */
export function filterDenied(
  headlines: readonly Headline[],
  denylist: readonly string[] = DEFAULT_DENYLIST,
): Headline[] {
  return headlines.filter((h) => !isDenied(h.title, denylist));
}
