/**
 * wagmi configuration for Justify MVP.
 *
 * Target chain: Ganache (chain ID 1337) at http://localhost:8545.
 * MetaMask is the only active connector — all others are listed
 * in the UI as disabled per spec.
 *
 * NOTE: This is intentionally NOT Base (8453) — Base is a later phase.
 */

import { createConfig, http } from 'wagmi';
import { defineChain } from 'viem';
import { injected } from 'wagmi/connectors';

/** Ganache local chain — chain ID 1337, RPC :8545 */
export const ganache = defineChain({
  id: 1337,
  name: 'Ganache',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
  },
  testnet: true,
});

/**
 * Wagmi config — MetaMask (injected) only.
 * Other wallets (Trust, Coinbase, WalletConnect) are rendered disabled in the UI.
 */
export const wagmiConfig = createConfig({
  chains: [ganache],
  connectors: [injected({ target: 'metaMask' })],
  transports: {
    [ganache.id]: http('http://localhost:8545'),
  },
  ssr: true,
});

/**
 * Build the exact sign message required by POST /api/wallet.
 * Must match the server-side `buildExpectedMessage` in api/wallet/route.ts.
 */
export function buildWalletSignMessage(userId: string): string {
  return `Sign in to Justify\nThis request will not trigger a blockchain transaction or cost any gas fees.\nNonce: ${userId}`;
}
