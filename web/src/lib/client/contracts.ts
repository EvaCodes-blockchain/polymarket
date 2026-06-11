/**
 * Typed contract references derived from the frozen ganache.json artifact.
 * Import these instead of hard-coding addresses — they're the integration contract.
 *
 * NOTE: The artifact lives at contracts/deployments/ganache.json relative to the
 * monorepo root. We copy only the addresses/ABIs we need here as typed constants
 * so the frontend doesn't have to dynamically import a 60 kB JSON.
 */

// ── Addresses ────────────────────────────────────────────────────────────────
// Canonical addresses from compose-Ganache deployment (contracts/deployments/ganache.json)
export const CONTRACT_ADDRESSES = {
  MockUSDC: '0xAF7244998ee2969df3D436935E455934121da5C0',
  OutcomeToken: '0xF6208811B8f309C8184f7391c61748e094bEc10A',
  MarketFactory: '0x6440c872934c4A33459e85ce7592230826ae7770',
  // Seeded market #0
  PredictionMarket: '0x791408F6b8F6dF60887bFa3301A82144017f0CaF',
  MarketAMM: '0xd470E6668777090b791d4De49B71Ea7fe5DE7ca8',
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
