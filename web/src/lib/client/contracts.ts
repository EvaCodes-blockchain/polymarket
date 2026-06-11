/**
 * Typed contract references derived from the frozen ganache.json artifact.
 * Import these instead of hard-coding addresses — they're the integration contract.
 *
 * NOTE: The artifact lives at contracts/deployments/ganache.json relative to the
 * monorepo root. We copy only the addresses/ABIs we need here as typed constants
 * so the frontend doesn't have to dynamically import a 60 kB JSON.
 */

// ── Addresses ────────────────────────────────────────────────────────────────
export const CONTRACT_ADDRESSES = {
  MockUSDC: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  OutcomeToken: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  MarketFactory: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  // Seeded market #0
  PredictionMarket: '0x3B02fF1e626Ed7a8fd6eC5299e2C54e1421B626B',
  MarketAMM: '0xBA12646CC07ADBe43F8bD25D83FB628D29C8A762',
} as const;

// ── Seeded market metadata ────────────────────────────────────────────────────
export const SEEDED_MARKET = {
  marketId: 0,
  question: 'Will Barcelona win El Clásico?',
  outcomeLabels: ['Barcelona', 'Real Madrid'] as [string, string],
} as const;

// ── Minimal ABIs (only the functions the frontend calls) ──────────────────────

export const MOCK_USDC_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

export const MARKET_AMM_ABI = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'outcomeIndex', type: 'uint8' },
      { name: 'collateralIn', type: 'uint256' },
      { name: 'minSharesOut', type: 'uint256' },
    ],
    outputs: [{ name: 'sharesOut', type: 'uint256' }],
  },
  {
    name: 'impliedProbabilityBps',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'outcomeIndex', type: 'uint8' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'reserves',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'FEE_BPS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const OUTCOME_TOKEN_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'encodeId',
    type: 'function',
    stateMutability: 'pure',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
