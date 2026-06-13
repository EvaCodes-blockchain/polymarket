'use client';

import TransportBadge from './TransportBadge';
import { formatUsdcShort } from '@/lib/client/bridgeApi';
import type { BridgeChainDTO } from '@/lib/client/bridgeApi';

interface TransportChainCardProps {
  chain: BridgeChainDTO;
  /** total volume of markets riding this chain (computed client-side) */
  volumeUsdc?: number | undefined;
}

/**
 * Prominent card emphasising a transport blockchain on the Global Event Markets
 * dashboard. Leads with a large transport badge (Chainlink CCIP / Wormhole) to
 * make the bridge substrate the hero of the page.
 */
export default function TransportChainCard({ chain, volumeUsdc }: TransportChainCardProps) {
  return (
    <div
      className="bg-glass rounded-2xl p-4 border-l-4"
      style={{ borderLeftColor: chain.accent }}
      data-testid={`transport-chain-${chain.key}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-base font-bold text-white truncate">{chain.name}</h3>
        <span className="text-[10px] uppercase tracking-wide text-gray-500">{chain.family}</span>
      </div>

      <div className="mb-3">
        <TransportBadge transport={chain.transport} label={chain.transportLabel} size="lg" />
      </div>

      <p className="text-xs text-gray-400 leading-snug mb-3 line-clamp-3">{chain.blurb}</p>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-white/5 rounded-xl py-2">
          <p className="text-sm font-bold text-white mb-0">{chain.marketCount}</p>
          <p className="text-[10px] text-gray-500 mb-0">markets</p>
        </div>
        <div className="bg-white/5 rounded-xl py-2">
          <p className="text-sm font-bold text-white mb-0">{chain.collateral}</p>
          <p className="text-[10px] text-gray-500 mb-0">collateral</p>
        </div>
        <div className="bg-white/5 rounded-xl py-2">
          <p className="text-sm font-bold text-white mb-0">
            {volumeUsdc === undefined ? '—' : formatUsdcShort(volumeUsdc)}
          </p>
          <p className="text-[10px] text-gray-500 mb-0">volume</p>
        </div>
      </div>
    </div>
  );
}
