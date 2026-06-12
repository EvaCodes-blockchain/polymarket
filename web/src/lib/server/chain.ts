// Server-side chain access (Ganache, chain id 1337) — agentic sprint.
//
// Frozen integration contract (docs/delivery/agentic-sprint-contracts.md §3):
//   createMarketOnChain  — creator signer (account 6) calls MarketFactory.createMarket,
//                          deployer (account 0) mints+approves+seeds the AMM.
//   readMarketPrices     — impliedProbabilityBps/10000 + pooled reserves as volume.
//   mintUsdcTo           — deployer mints MockUSDC (Ganache faucet).
//
// Addresses + ABIs come from contracts/deployments/ganache.json (canonical artifact),
// resolved relative to process.cwd() (web/ when Next runs) or via DEPLOYMENTS_FILE.

import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  type Abi,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type Account,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface OnChainMarket {
  marketId: number;
  marketAddress: `0x${string}`;
  ammAddress: `0x${string}`;
  txHash: `0x${string}`;
}

interface ContractArtifact {
  address: `0x${string}`;
  abi: Abi;
}

interface DeploymentsArtifact {
  chainId: number;
  contracts: {
    MarketFactory: ContractArtifact;
    MockUSDC: ContractArtifact;
    OutcomeToken: ContractArtifact;
    [name: string]: ContractArtifact;
  };
}

interface MarketAmmArtifact {
  abi: Abi;
}

// ── Artifact loading (lazy, cached) ──────────────────────────────────────────

let cachedDeployments: DeploymentsArtifact | null = null;
let cachedAmmAbi: Abi | null = null;

function deploymentsPath(): string {
  return (
    process.env.DEPLOYMENTS_FILE ??
    path.join(process.cwd(), '..', 'contracts', 'deployments', 'ganache.json')
  );
}

function loadDeployments(): DeploymentsArtifact {
  if (!cachedDeployments) {
    const raw = fs.readFileSync(deploymentsPath(), 'utf-8');
    cachedDeployments = JSON.parse(raw) as DeploymentsArtifact;
  }
  return cachedDeployments;
}

/** MarketAMM ABI lives under seededMarket.contracts in the artifact. */
function loadAmmAbi(): Abi {
  if (!cachedAmmAbi) {
    const raw = fs.readFileSync(deploymentsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as {
      seededMarket: { contracts: { MarketAMM: MarketAmmArtifact } };
    };
    cachedAmmAbi = parsed.seededMarket.contracts.MarketAMM.abi;
  }
  return cachedAmmAbi;
}

// ── Clients / signers ────────────────────────────────────────────────────────

// Env-driven so the same code targets Ganache (1337) or Arc testnet (5042002).
// Arc's native gas token is USDC (18 decimals); Ganache uses ETH. This native
// currency is the GAS token, distinct from the collateral USDC the markets use.
const appChain = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.CHAIN_ID ?? '1337'),
  name: process.env.NEXT_PUBLIC_CHAIN_NAME ?? 'Ganache',
  nativeCurrency: {
    name: process.env.NEXT_PUBLIC_NATIVE_SYMBOL ?? 'ETH',
    symbol: process.env.NEXT_PUBLIC_NATIVE_SYMBOL ?? 'ETH',
    decimals: 18,
  },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? 'http://localhost:8545'] } },
});

function rpcTransport(): Transport {
  return http(process.env.RPC_URL ?? 'http://localhost:8545');
}

function mnemonic(): string {
  const m = process.env.GANACHE_MNEMONIC;
  if (!m) throw new Error('GANACHE_MNEMONIC is not set');
  return m;
}

/** Account 0 — deployer/admin (MockUSDC owner, seeds AMMs). */
function deployerAccount(): Account {
  return mnemonicToAccount(mnemonic(), { addressIndex: 0 });
}

/** Account 6 — market creator (holds FACTORY_ROLE). */
function creatorAccount(): Account {
  return mnemonicToAccount(mnemonic(), { addressIndex: 6 });
}

function publicClient(): PublicClient {
  return createPublicClient({ chain: appChain, transport: rpcTransport() });
}

function walletClient(account: Account): WalletClient<Transport, Chain, Account> {
  return createWalletClient({ account, chain: appChain, transport: rpcTransport() });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const USDC_DECIMALS = 1_000_000; // 6 decimals

function usdcToUnits(amountUsdc: number): bigint {
  return BigInt(Math.round(amountUsdc * USDC_DECIMALS));
}

// ── Exports ──────────────────────────────────────────────────────────────────

/**
 * Create a market on-chain and seed its AMM.
 * Creator (account 6) calls MarketFactory.createMarket; deployer (account 0)
 * mints seed collateral, approves the AMM and calls amm.seed.
 * Sequential txs — each receipt awaited (Ganache automines).
 */
export async function createMarketOnChain(p: {
  question: string;
  outcomeYes: string;
  outcomeNo: string;
  closeTime: Date;
  oracleProofUrl: string;
  seedYesUsdc: number;
  seedNoUsdc: number;
}): Promise<OnChainMarket> {
  const deployments = loadDeployments();
  const factory = deployments.contracts.MarketFactory;
  const usdc = deployments.contracts.MockUSDC;

  const pub = publicClient();
  const creator = walletClient(creatorAccount());
  const deployer = walletClient(deployerAccount());

  // 1. createMarket as creator
  const closeTimeUnix = BigInt(Math.floor(p.closeTime.getTime() / 1000));
  const createHash = await creator.writeContract({
    address: factory.address,
    abi: factory.abi,
    functionName: 'createMarket',
    args: [p.question, [p.outcomeYes, p.outcomeNo], closeTimeUnix, p.oracleProofUrl],
  });
  const createReceipt = await pub.waitForTransactionReceipt({ hash: createHash });
  if (createReceipt.status !== 'success') {
    throw new Error(`createMarket reverted (tx ${createHash})`);
  }

  // 2. parse MarketCreated(marketId, market, amm, question)
  const events = parseEventLogs({
    abi: factory.abi,
    eventName: 'MarketCreated',
    logs: createReceipt.logs,
  });
  const created = events[0];
  if (!created) {
    throw new Error(`MarketCreated event not found in receipt (tx ${createHash})`);
  }
  const args = created.args as {
    marketId: bigint;
    market: `0x${string}`;
    amm: `0x${string}`;
  };

  // 3. deployer mints seed collateral to itself
  const yesUnits = usdcToUnits(p.seedYesUsdc);
  const noUnits = usdcToUnits(p.seedNoUsdc);
  const totalUnits = yesUnits + noUnits;
  const deployerAddress = deployer.account.address;

  const mintHash = await deployer.writeContract({
    address: usdc.address,
    abi: usdc.abi,
    functionName: 'mint',
    args: [deployerAddress, totalUnits],
  });
  await pub.waitForTransactionReceipt({ hash: mintHash });

  // 4. approve the AMM to pull the seed collateral
  const approveHash = await deployer.writeContract({
    address: usdc.address,
    abi: usdc.abi,
    functionName: 'approve',
    args: [args.amm, totalUnits],
  });
  await pub.waitForTransactionReceipt({ hash: approveHash });

  // 5. seed the AMM
  const seedHash = await deployer.writeContract({
    address: args.amm,
    abi: loadAmmAbi(),
    functionName: 'seed',
    args: [yesUnits, noUnits],
  });
  const seedReceipt = await pub.waitForTransactionReceipt({ hash: seedHash });
  if (seedReceipt.status !== 'success') {
    throw new Error(`amm.seed reverted (tx ${seedHash})`);
  }

  return {
    marketId: Number(args.marketId),
    marketAddress: args.market,
    ammAddress: args.amm,
    txHash: createHash,
  };
}

/**
 * Read live prices from a MarketAMM.
 * priceYes/priceNo = impliedProbabilityBps / 10000; volume = pooled reserves in USDC.
 */
export async function readMarketPrices(amm: `0x${string}`): Promise<{
  priceYes: number;
  priceNo: number;
  volumeUsdc: number;
}> {
  const pub = publicClient();
  const abi = loadAmmAbi();

  const [bpsYes, bpsNo, reservesYes, reservesNo] = (await Promise.all([
    pub.readContract({ address: amm, abi, functionName: 'impliedProbabilityBps', args: [0] }),
    pub.readContract({ address: amm, abi, functionName: 'impliedProbabilityBps', args: [1] }),
    pub.readContract({ address: amm, abi, functionName: 'reserves', args: [0n] }),
    pub.readContract({ address: amm, abi, functionName: 'reserves', args: [1n] }),
  ])) as [bigint, bigint, bigint, bigint];

  return {
    priceYes: Number(bpsYes) / 10_000,
    priceNo: Number(bpsNo) / 10_000,
    volumeUsdc: Number(reservesYes + reservesNo) / USDC_DECIMALS,
  };
}

/**
 * Thrown when the in-app mint faucet can't run because the collateral token is
 * an external ERC-20 we don't own (e.g. Circle USDC on Arc). Callers surface a
 * link to the public faucet instead. Distinct from an on-chain mint failure.
 */
export class FaucetUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaucetUnavailableError';
  }
}

/**
 * True when the collateral is our own mintable MockUSDC (Ganache / fallback),
 * i.e. no external collateral address is configured. When false the deployer
 * does not own the token and cannot mint — use the public faucet.
 */
export function isMintableCollateral(): boolean {
  return !process.env.COLLATERAL_USDC_ADDRESS?.trim();
}

/**
 * Public, browser-safe chain config — addresses + chain id resolved from the
 * live deployment artifact at runtime, so the browser bundle never bakes in
 * stale addresses after a redeploy (closes BUG-002). Returns only the two
 * global addresses the client needs; per-market addresses come from the
 * Markets API DTO.
 */
export function getPublicChainConfig(): {
  chainId: number;
  rpcUrl: string;
  addresses: { MockUSDC: `0x${string}`; OutcomeToken: `0x${string}` };
} {
  const d = loadDeployments();
  return {
    chainId: d.chainId,
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? process.env.RPC_URL ?? 'http://localhost:8545',
    addresses: {
      MockUSDC: d.contracts.MockUSDC.address,
      OutcomeToken: d.contracts.OutcomeToken.address,
    },
  };
}

/**
 * Deployer mints collateral USDC to `to` (only when it's our mintable MockUSDC).
 * Throws FaucetUnavailableError when collateral is an external token. Returns
 * the tx hash on success.
 */
export async function mintUsdcTo(
  to: `0x${string}`,
  amountUsdc: number
): Promise<`0x${string}`> {
  if (!isMintableCollateral()) {
    throw new FaucetUnavailableError(
      'Collateral is an external USDC token — in-app minting is disabled. Use the public faucet.'
    );
  }
  const deployments = loadDeployments();
  const usdc = deployments.contracts.MockUSDC;

  const pub = publicClient();
  const deployer = walletClient(deployerAccount());

  const hash = await deployer.writeContract({
    address: usdc.address,
    abi: usdc.abi,
    functionName: 'mint',
    args: [to, usdcToUnits(amountUsdc)],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`mint reverted (tx ${hash})`);
  }
  return hash;
}
