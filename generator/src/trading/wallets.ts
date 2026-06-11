/**
 * Bot trader wallets (testing-market-generator.md Section 5.2 + sprint
 * contracts Section 1 account mapping):
 *   index 0   — deployer/admin (MockUSDC owner; mints USDC to bots),
 *   indices 7-9 — generator trading bots (never the integration suite's
 *                 test-trader accounts 2-5).
 * All derived from the compose Ganache mnemonic via viem's mnemonicToAccount.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Transport,
} from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";

export const BOT_ADDRESS_INDICES = [7, 8, 9] as const;
export const DEPLOYER_ADDRESS_INDEX = 0;

export const ganacheChain: Chain = defineChain({
  id: 1337,
  name: "Ganache (Justify local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://localhost:8545"] } },
});

export type BotWalletClient = WalletClient<Transport, Chain, HDAccount>;

export interface BotWallet {
  /** e.g. "bot-7" — matches the Ganache address index. */
  readonly label: string;
  readonly addressIndex: number;
  readonly account: HDAccount;
  readonly client: BotWalletClient;
}

export interface TradingWallets {
  readonly publicClient: PublicClient;
  readonly deployer: BotWallet;
  readonly bots: readonly BotWallet[];
}

export function deriveAccount(mnemonic: string, addressIndex: number): HDAccount {
  return mnemonicToAccount(mnemonic, { addressIndex });
}

function makeWallet(mnemonic: string, addressIndex: number, rpcUrl: string): BotWallet {
  const account = deriveAccount(mnemonic, addressIndex);
  const client: BotWalletClient = createWalletClient({
    account,
    chain: ganacheChain,
    transport: http(rpcUrl),
  });
  return { label: `bot-${addressIndex}`, addressIndex, account, client };
}

export function createTradingWallets(mnemonic: string, rpcUrl: string): TradingWallets {
  const publicClient: PublicClient = createPublicClient({
    chain: ganacheChain,
    transport: http(rpcUrl),
  });
  const deployer = {
    ...makeWallet(mnemonic, DEPLOYER_ADDRESS_INDEX, rpcUrl),
    label: "deployer",
  };
  const bots = BOT_ADDRESS_INDICES.map((index) => makeWallet(mnemonic, index, rpcUrl));
  return { publicClient, deployer, bots };
}
