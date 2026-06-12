/**
 * wagmi configuration for Justify MVP.
 *
 * The target chain is env-driven so the same build runs on Ganache (local dev,
 * chain 1337) or Circle Arc testnet (chain 5042002) by changing env only:
 *   NEXT_PUBLIC_CHAIN_ID, NEXT_PUBLIC_RPC_URL, NEXT_PUBLIC_CHAIN_NAME,
 *   NEXT_PUBLIC_NATIVE_SYMBOL  (Arc's gas token is USDC, not ETH).
 * MetaMask is the only active connector — all others are listed in the UI as
 * disabled per spec.
 */

import { createConfig, http } from 'wagmi';
import { defineChain } from 'viem';
import { injected } from 'wagmi/connectors';

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '1337');
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'http://localhost:8545';
const CHAIN_NAME = process.env.NEXT_PUBLIC_CHAIN_NAME ?? 'Ganache';
// Arc pays gas in USDC; Ganache/most EVM chains use ETH. Default ETH.
const NATIVE_SYMBOL = process.env.NEXT_PUBLIC_NATIVE_SYMBOL ?? 'ETH';

/**
 * The active app chain, defined from env. On Ganache this is chain 1337 / ETH;
 * on Arc testnet it is 5042002 / USDC. `defineChain` + viem expects an
 * 18-decimal native currency, which holds for both ETH and Arc's native USDC.
 */
export const appChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: NATIVE_SYMBOL, symbol: NATIVE_SYMBOL, decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  testnet: true,
});

/** @deprecated kept as an alias during the Arc migration; use `appChain`. */
export const ganache = appChain;

/**
 * Wagmi config — MetaMask (injected) only.
 * Other wallets (Trust, Coinbase, WalletConnect) are rendered disabled in the UI.
 */
export const wagmiConfig = createConfig({
  chains: [appChain],
  connectors: [injected({ target: 'metaMask' })],
  transports: {
    [appChain.id]: http(RPC_URL),
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
