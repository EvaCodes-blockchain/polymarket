// On-chain read helpers (viem) for the integration suite.
//
// Talks to the compose Ganache node (chain 1337, automining) using addresses/ABIs
// from the canonical deployments artifact `contracts/deployments/ganache.json`
// (loaded in env.ts; override path via DEPLOYMENTS_FILE).

import { createPublicClient, defineChain, http, type Abi, type Address } from 'viem';

import { DEPLOYMENTS, RPC_URL } from './env';

export const ganache = defineChain({
  id: DEPLOYMENTS.chainId, // 1337
  name: 'Ganache (local)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

/** Shared read-only client against the local Ganache node. */
export const publicClient = createPublicClient({
  chain: ganache,
  transport: http(RPC_URL),
});

/**
 * Resolve a platform contract (MarketFactory, MockUSDC, OutcomeToken,
 * OracleResolver, FeeTreasury, JustifyAccessControl) from the deployments
 * artifact by name. Throws if the name is unknown.
 */
export function getDeployedContract(name: string): { address: Address; abi: Abi } {
  const entry = DEPLOYMENTS.contracts[name];
  if (!entry) {
    const known = Object.keys(DEPLOYMENTS.contracts).join(', ');
    throw new Error(`getDeployedContract: "${name}" not in deployments artifact (have: ${known})`);
  }
  return { address: entry.address, abi: entry.abi as Abi };
}

/**
 * Raw result of MarketFactory.getMarket(marketId):
 * `[predictionMarketAddress, ammAddress]`.
 */
export async function getMarketOnChain(marketId: number): Promise<readonly [Address, Address]> {
  const factory = getDeployedContract('MarketFactory');
  const result = await publicClient.readContract({
    address: factory.address,
    abi: factory.abi,
    functionName: 'getMarket',
    args: [BigInt(marketId)],
  });
  return result as readonly [Address, Address];
}

/** MockUSDC balance of `address`, in raw token units (6 decimals). */
export async function erc20BalanceOf(address: Address): Promise<bigint> {
  const usdc = getDeployedContract('MockUSDC');
  const result = await publicClient.readContract({
    address: usdc.address,
    abi: usdc.abi,
    functionName: 'balanceOf',
    args: [address],
  });
  return result as bigint;
}

// Minimal MarketAMM fragment — each market deploys its own AMM instance, so the
// ABI is inlined here rather than read from DEPLOYMENTS.contracts.
const MARKET_AMM_PRICE_ABI = [
  {
    type: 'function',
    name: 'impliedProbabilityBps',
    stateMutability: 'view',
    inputs: [{ name: 'outcomeIndex', type: 'uint8' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Live AMM prices for a market, as 0..1 floats derived from
 * `impliedProbabilityBps` (bps / 10000). priceYes + priceNo ≈ 1 by CPMM
 * construction (outcome 0 = Yes, outcome 1 = No).
 */
export async function readAmmPrices(
  amm: Address,
): Promise<{ priceYes: number; priceNo: number }> {
  const [bpsYes, bpsNo] = await Promise.all([
    publicClient.readContract({
      address: amm,
      abi: MARKET_AMM_PRICE_ABI,
      functionName: 'impliedProbabilityBps',
      args: [0],
    }),
    publicClient.readContract({
      address: amm,
      abi: MARKET_AMM_PRICE_ABI,
      functionName: 'impliedProbabilityBps',
      args: [1],
    }),
  ]);
  return { priceYes: Number(bpsYes) / 10_000, priceNo: Number(bpsNo) / 10_000 };
}
