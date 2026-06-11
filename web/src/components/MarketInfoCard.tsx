'use client';

import { useReadContract } from 'wagmi';
import {
  CONTRACT_ADDRESSES,
  MARKET_AMM_ABI,
  SEEDED_MARKET,
} from '@/lib/client/contracts';

/**
 * MarketInfoCard — shows live implied probabilities from the AMM for the seeded market.
 */
export default function MarketInfoCard() {
  const { data: prob0 } = useReadContract({
    address: CONTRACT_ADDRESSES.MarketAMM,
    abi: MARKET_AMM_ABI,
    functionName: 'impliedProbabilityBps',
    args: [0],
  });
  const { data: prob1 } = useReadContract({
    address: CONTRACT_ADDRESSES.MarketAMM,
    abi: MARKET_AMM_ABI,
    functionName: 'impliedProbabilityBps',
    args: [1],
  });

  const pct0 = prob0 !== undefined ? (Number(prob0) / 100).toFixed(1) : '…';
  const pct1 = prob1 !== undefined ? (Number(prob1) / 100).toFixed(1) : '…';

  return (
    <div className="bg-glass rounded-2xl p-5 shadow-sm mb-4">
      {/* Market question */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-indigo-600/30 flex items-center justify-center flex-shrink-0">
          <span className="material-icons text-indigo-400 text-xl">sports_soccer</span>
        </div>
        <div className="flex-1">
          <p className="text-gray-400 text-xs mb-0.5">Prediction Market #0</p>
          <h2 className="text-white font-bold text-base leading-snug">
            {SEEDED_MARKET.question}
          </h2>
        </div>
      </div>

      {/* Outcome probability bars */}
      <div className="space-y-2">
        {SEEDED_MARKET.outcomeLabels.map((label, i) => {
          const pct = i === 0 ? pct0 : pct1;
          const pctNum = parseFloat(pct) || 50;
          return (
            <div key={label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-gray-300 text-sm">{label}</span>
                <span className="text-white text-sm font-semibold">{pct}%</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${i === 0 ? 'bg-green-500' : 'bg-red-500'}`}
                  style={{ width: `${pctNum}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-white/10">
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <span className="material-icons" style={{ fontSize: 14 }}>link</span>
          <span>Ganache chain 1337</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-green-400">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span>Live</span>
        </div>
      </div>
    </div>
  );
}
