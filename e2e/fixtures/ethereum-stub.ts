/**
 * ethereum-stub.ts
 *
 * Injects a fake `window.ethereum` that satisfies wagmi's
 * `injected({ target: 'metaMask' })` connector.
 *
 * Strategy: proxy JSON-RPC calls to the Ganache node running at
 * GANACHE_RPC_URL (default: http://localhost:8545). Ganache keeps all
 * mnemonic-derived accounts unlocked, so `eth_requestAccounts` and
 * `eth_sendTransaction` work without managing private keys in test code.
 *
 * personal_sign: Ganache v7 does NOT expose `personal_sign`.
 * Implementation: encode the message string to UTF-8 hex, then call Ganache's
 * `eth_sign(address, hex)`. Ganache then computes keccak256(EIP-191 prefix + hex)
 * which matches what `viem.verifyMessage` expects — verified in test.
 *
 * isMetaMask = true so wagmi finds the connector by id 'metaMask'.
 */

import type { Page } from '@playwright/test';

/** Ganache account index 2 = first pre-funded trader */
export const TRADER_INDEX = 2;

/**
 * Inject the ethereum stub into the page before any navigation.
 * Must be called via page.addInitScript so it runs before the app code.
 *
 * @param traderIndex  Ganache account index (0-9). Defaults to TRADER_INDEX (2).
 *   Use different indices per test so each test binds a fresh wallet address,
 *   avoiding 409 conflicts on /api/wallet across test runs.
 */
export function injectEthereumStub(
  page: Page,
  ganacheRpcUrl: string,
  traderIndex: number = TRADER_INDEX,
): Promise<void> {
  return page.addInitScript(
    ({ rpcUrl, traderIndex }: { rpcUrl: string; traderIndex: number }) => {
      // ── Helpers ───────────────────────────────────────────────────────────────
      function toUtf8Hex(str: string): string {
        const bytes = new TextEncoder().encode(str);
        return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      }

      async function rpcCall(method: string, params: unknown[] = []): Promise<unknown> {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
        });
        const json = await res.json() as { result?: unknown; error?: { message: string } };
        if (json.error) throw new Error(`RPC ${method} failed: ${json.error.message}`);
        return json.result;
      }

      // ── Minimal EIP-1193 provider ──────────────────────────────────────────
      let accounts: string[] = [];

      const ethereum = {
        isMetaMask: true,
        chainId: '0x539', // 1337

        async request({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> {
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts': {
              if (accounts.length === 0) {
                const all = await rpcCall('eth_accounts') as string[];
                accounts = [all[traderIndex]];
              }
              return accounts;
            }
            case 'eth_chainId':
              return '0x539';

            case 'wallet_switchEthereumChain': {
              const p = (params as Array<{ chainId: string }>)[0];
              if (p?.chainId !== '0x539') {
                throw { code: 4902, message: 'Unrecognized chain ID' };
              }
              return null;
            }

            case 'personal_sign': {
              // personal_sign(message_string, address)
              // Ganache v7 lacks personal_sign but eth_sign(addr, utf8Hex(msg))
              // produces a signature compatible with viem.verifyMessage.
              const [msg, from] = params as [string, string];
              // If the message is already hex (0x-prefixed), pass it as-is.
              // If it's a plain string, encode to UTF-8 hex.
              const hexMsg = msg.startsWith('0x') ? msg : toUtf8Hex(msg);
              return rpcCall('eth_sign', [from, hexMsg]);
            }

            case 'eth_estimateGas': {
              // Apply a generous safety buffer: MarketAMM.buy() involves
              // CPMM arithmetic + ERC-1155 minting and needs ~100k gas.
              // Ganache's estimate can be low; 3× ensures we don't run out.
              const estimated = await rpcCall('eth_estimateGas', params) as string;
              const raw = parseInt(estimated, 16);
              const buffered = Math.max(Math.ceil(raw * 3), 500_000);
              return '0x' + buffered.toString(16);
            }

            case 'eth_sendTransaction': {
              // Override the gas limit: set a generous minimum to prevent
              // out-of-gas reverts on complex contract calls (MarketAMM.buy
              // needs ~100k gas; wagmi's estimate can come in under that).
              const txParams = (params as Array<Record<string, string>>)[0] ?? {};
              const gasLimit = txParams['gas'] ? parseInt(txParams['gas'], 16) : 0;
              if (gasLimit > 0 && gasLimit < 300_000) {
                txParams['gas'] = '0x' + (300_000).toString(16);
              } else if (!txParams['gas']) {
                txParams['gas'] = '0x' + (500_000).toString(16);
              }
              return rpcCall('eth_sendTransaction', [txParams, ...(params as unknown[]).slice(1)]);
            }

            case 'eth_getTransactionReceipt':
            case 'eth_getTransactionByHash':
            case 'eth_blockNumber':
            case 'eth_getBalance':
            case 'eth_call':
            case 'eth_estimateGas':
            case 'net_version':
              return rpcCall(method, params);

            default:
              return rpcCall(method, params);
          }
        },

        on(_event: string, _handler: unknown) { /* noop — no subscriptions needed */ },
        removeListener(_event: string, _handler: unknown) { /* noop */ },
      };

      // Make it look like MetaMask's multi-provider setup
      Object.defineProperty(window, 'ethereum', {
        value: ethereum,
        writable: true,
        configurable: true,
      });
    },
    { rpcUrl: ganacheRpcUrl, traderIndex },
  );
}
