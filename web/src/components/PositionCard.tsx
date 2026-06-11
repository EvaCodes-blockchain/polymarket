'use client';

import { useAccount, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import {
  CONTRACT_ADDRESSES,
  OUTCOME_TOKEN_ABI,
  SEEDED_MARKET,
} from '@/lib/client/contracts';

const USDC_DECIMALS = 6;

/**
 * PositionCard — shows the user's current outcome token holdings for the seeded market.
 * Uses OutcomeToken.balanceOf(account, encodeId(marketId, outcomeIndex)).
 *
 * For simplicity with the static ABI (no encodeId call needed client-side),
 * we pre-compute the token IDs using the known encoding:
 *   tokenId = (marketId << 8) | outcomeIndex
 * This matches the Solidity `encodeId` implementation.
 */
export default function PositionCard({ refreshKey }: { refreshKey?: number }) {
  const { address, isConnected } = useAccount();

  // Encode token IDs: tokenId = (marketId << 8) | outcomeIndex
  const marketId = BigInt(SEEDED_MARKET.marketId);
  const yesTokenId = (marketId << BigInt(8)) | BigInt(0);
  const noTokenId = (marketId << BigInt(8)) | BigInt(1);

  const { data: balances, refetch } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESSES.OutcomeToken,
        abi: OUTCOME_TOKEN_ABI,
        functionName: 'balanceOf',
        args: address ? [address, yesTokenId] : undefined,
      },
      {
        address: CONTRACT_ADDRESSES.OutcomeToken,
        abi: OUTCOME_TOKEN_ABI,
        functionName: 'balanceOf',
        args: address ? [address, noTokenId] : undefined,
      },
    ],
    query: { enabled: !!address },
  });

  // Refetch when parent signals a new buy
  // (refreshKey changes on each successful buy)
  if (refreshKey !== undefined) {
    void refetch();
  }

  if (!isConnected || !address) return null;

  const yesBalance = balances?.[0]?.result ?? BigInt(0);
  const noBalance = balances?.[1]?.result ?? BigInt(0);

  const hasPosition = yesBalance > BigInt(0) || noBalance > BigInt(0);

  if (!hasPosition) {
    return (
      <div className="bg-glass rounded-2xl p-4 text-center">
        <p className="text-gray-500 text-xs">No positions yet — place a bet above</p>
      </div>
    );
  }

  return (
    <div className="bg-glass rounded-2xl p-4">
      <h4 className="text-white font-semibold text-sm mb-3">Your Position</h4>
      <div className="space-y-2">
        {SEEDED_MARKET.outcomeLabels.map((label, i) => {
          const balance = i === 0 ? yesBalance : noBalance;
          if (balance === BigInt(0)) return null;
          return (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-green-400' : 'bg-red-400'}`} />
                <span className="text-gray-300 text-sm">{label}</span>
              </div>
              <span className="text-white text-sm font-semibold">
                {formatUnits(balance, USDC_DECIMALS)} shares
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
