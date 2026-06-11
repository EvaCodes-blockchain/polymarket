/**
 * Environment lock (testing-market-generator.md Section 6, "Environment lock"):
 * the trading module refuses to run unless
 *   1. the API base URL hostname is allowlisted
 *      (localhost / 127.0.0.1 / *.test / *.staging, plus EXTRA_ALLOWED_HOSTS), and
 *   2. the node behind RPC_URL reports chain ID 1337 (eth_chainId === 0x539).
 * Production can never be targeted by misconfiguration.
 */

export class EnvLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvLockError";
  }
}

export const REQUIRED_CHAIN_ID = 1337;

const ALLOWED_HOSTNAMES: readonly string[] = ["localhost", "127.0.0.1"];
const ALLOWED_SUFFIXES: readonly string[] = [".test", ".staging"];

/** Minimal fetch signature so tests can inject a mock without touching globals. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function isAllowedApiBaseUrl(
  apiBaseUrl: string,
  extraAllowedHosts: readonly string[] = [],
): boolean {
  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (ALLOWED_HOSTNAMES.includes(host)) return true;
  if (ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return extraAllowedHosts.some((extra) => extra.toLowerCase() === host);
}

interface JsonRpcChainIdResponse {
  result?: unknown;
  error?: unknown;
}

/** Asks the node for eth_chainId; throws EnvLockError if unreachable/malformed. */
export async function fetchChainId(rpcUrl: string, fetchImpl: FetchLike = fetch): Promise<number> {
  let response: Response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
  } catch (cause) {
    throw new EnvLockError(`environment lock: RPC node unreachable at ${rpcUrl} (${String(cause)})`);
  }
  if (!response.ok) {
    throw new EnvLockError(`environment lock: RPC node at ${rpcUrl} returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as JsonRpcChainIdResponse;
  if (typeof payload.result !== "string" || !/^0x[0-9a-fA-F]+$/.test(payload.result)) {
    throw new EnvLockError(
      `environment lock: RPC node at ${rpcUrl} returned an invalid eth_chainId response`,
    );
  }
  return Number.parseInt(payload.result, 16);
}

export interface EnvLockTarget {
  readonly apiBaseUrl: string;
  readonly rpcUrl: string;
  readonly extraAllowedHosts: readonly string[];
}

/**
 * Verifies both rails; throws EnvLockError (caller must exit non-zero) otherwise.
 */
export async function assertEnvironmentLock(
  target: EnvLockTarget,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!isAllowedApiBaseUrl(target.apiBaseUrl, target.extraAllowedHosts)) {
    throw new EnvLockError(
      `environment lock: API_BASE_URL "${target.apiBaseUrl}" is not allowlisted ` +
        `(allowed: localhost, 127.0.0.1, *.test, *.staging` +
        (target.extraAllowedHosts.length > 0
          ? `, extra: ${target.extraAllowedHosts.join(", ")}`
          : "") +
        `). Refusing to trade.`,
    );
  }
  const chainId = await fetchChainId(target.rpcUrl, fetchImpl);
  if (chainId !== REQUIRED_CHAIN_ID) {
    throw new EnvLockError(
      `environment lock: node at ${target.rpcUrl} reports chain ID ${chainId}, ` +
        `expected ${REQUIRED_CHAIN_ID} (Ganache). Refusing to trade.`,
    );
  }
}
