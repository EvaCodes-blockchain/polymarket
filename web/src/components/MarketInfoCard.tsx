'use client';

import { useReadContract } from 'wagmi';
import type { MarketDTO } from '@/lib/client/api';
import { MARKET_AMM_ABI } from '@/lib/client/contracts';

interface MarketInfoCardProps {
  market: MarketDTO;
}

/** Material icon per market category (fallback: generic chart). */
const CATEGORY_ICONS: Record<string, string> = {
  sports: 'sports_soccer',
  crypto: 'currency_bitcoin',
  business: 'trending_up',
  technology: 'memory',
  science: 'science',
  entertainment: 'movie',
  health: 'health_and_safety',
  politics: 'gavel',
  world: 'public',
};

/**
 * MarketInfoCard — shows live implied probabilities from the market's own AMM,
 * falling back to the DTO snapshot prices when the chain read hasn't resolved.
 */
export default function MarketInfoCard({ market }: MarketInfoCardProps) {
  const ammAddress = market.addresses.amm;

  const { data: prob0 } = useReadContract({
    address: ammAddress,
    abi: MARKET_AMM_ABI,
    functionName: 'impliedProbabilityBps',
    args: [0],
  });
  const { data: prob1 } = useReadContract({
    address: ammAddress,
    abi: MARKET_AMM_ABI,
    functionName: 'impliedProbabilityBps',
    args: [1],
  });

  const pct0 = prob0 !== undefined ? Number(prob0) / 100 : market.priceYes * 100;
  const pct1 = prob1 !== undefined ? Number(prob1) / 100 : market.priceNo * 100;

  const outcomes: Array<{ label: string; pct: number }> = [
    { label: market.outcomeYes, pct: pct0 },
    { label: market.outcomeNo, pct: pct1 },
  ];

  const icon = CATEGORY_ICONS[market.category] ?? 'insights';

  return (
    <div className="bg-glass rounded-2xl p-5 shadow-sm mb-4" data-testid="market-info-card">
      {/* Market question */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-indigo-600/30 flex items-center justify-center flex-shrink-0">
          <span className="material-icons text-indigo-400 text-xl">{icon}</span>
        </div>
        <div className="flex-1">
          <p className="text-gray-400 text-xs mb-0.5">Prediction Market #{market.marketId}</p>
          <h2 className="text-white font-bold text-base leading-snug">
            {market.question}
          </h2>
        </div>
      </div>

      {/* Outcome probability bars */}
      <div className="space-y-2">
        {outcomes.map(({ label, pct }, i) => (
          <div key={`${label}-${i}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-300 text-sm">{label}</span>
              <span className="text-white text-sm font-semibold">{pct.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${i === 0 ? 'bg-green-500' : 'bg-red-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-white/10">
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <span className="material-icons" style={{ fontSize: 14 }}>link</span>
          <span>Ganache chain 1337</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-green-400">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span>{market.status === 'LIVE' ? 'Live' : market.status}</span>
        </div>
      </div>
    </div>
  );
}
