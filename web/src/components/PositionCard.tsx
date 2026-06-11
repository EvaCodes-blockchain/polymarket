'use client';

import { useEffect } from 'react';
import { useAccount, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import type { MarketDTO } from '@/lib/client/api';
import { CONTRACT_ADDRESSES, OUTCOME_TOKEN_ABI } from '@/lib/client/contracts';

const USDC_DECIMALS = 6;

interface PositionCardProps {
  market: MarketDTO;
  /** Bumped by the parent after each successful buy to trigger a refetch. */
  refreshKey?: number;
}

/**
 * PositionCard — shows the user's outcome token holdings for one market.
 * Uses OutcomeToken.balanceOf(account, encodeId(marketId, outcomeIndex)).
 *
 * OutcomeToken is a single global ERC-1155 (CONTRACT_ADDRESSES.OutcomeToken);
 * token IDs are pre-computed client-side with the known Solidity encoding:
 *   tokenId = (marketId << 8) | outcomeIndex
 */
export default function PositionCard({ market, refreshKey }: PositionCardProps) {
  const { address, isConnected } = useAccount();

  // Encode token IDs: tokenId = (marketId << 8) | outcomeIndex
  const marketId = BigInt(market.marketId);
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

  // Refetch when parent signals a new buy (refreshKey bumps on each success)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      void refetch();
    }
  }, [refreshKey, refetch]);

  if (!isConnected || !address) return null;

  const yesBalance = balances?.[0]?.result ?? BigInt(0);
  const noBalance = balances?.[1]?.result ?? BigInt(0);

  const hasPosition = yesBalance > BigInt(0) || noBalance > BigInt(0);

  if (!hasPosition) {
    return (
      <div className="bg-glass rounded-2xl p-4 text-center" data-testid="position-card-empty">
        <p className="text-gray-500 text-xs">No positions yet — place a bet above</p>
      </div>
    );
  }

  const outcomes: Array<{ label: string; balance: bigint }> = [
    { label: market.outcomeYes, balance: yesBalance },
    { label: market.outcomeNo, balance: noBalance },
  ];

  return (
    <div className="bg-glass rounded-2xl p-4" data-testid="position-card">
      <h4 className="text-white font-semibold text-sm mb-3">Your Position</h4>
      <div className="space-y-2">
        {outcomes.map(({ label, balance }, i) => {
          if (balance === BigInt(0)) return null;
          return (
            <div key={`${label}-${i}`} className="flex items-center justify-between">
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
