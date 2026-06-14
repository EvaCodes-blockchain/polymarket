'use client';

import ExternalMarketTile from './ExternalMarketTile';
import type { BridgeChainDTO, BridgeSystemDTO, ExternalMarketDTO } from '@/lib/client/bridgeApi';

interface BridgeMarketsGridProps {
  markets: ExternalMarketDTO[];
  /** lookup by chainKey for transport badges */
  chainsByKey: Record<string, BridgeChainDTO>;
  /** lookup by systemKey for venue labels */
  systemsByKey: Record<string, BridgeSystemDTO>;
  loading: boolean;
  error: string | null;
  /** message for the empty state (varies by page/filters) */
  emptyMessage: string;
  testId?: string;
}

/**
 * Shared loading / error / empty / grid renderer for bridge markets, mirroring
 * the markets/page.tsx state machine. Reused by both /bridge and /bridge/global.
 */
export default function BridgeMarketsGrid({
  markets,
  chainsByKey,
  systemsByKey,
  loading,
  error,
  emptyMessage,
  testId = 'bridge-markets-grid',
}: BridgeMarketsGridProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-12" data-testid="bridge-markets-loading">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-glass rounded-2xl p-6 text-center" data-testid="bridge-markets-error">
        <p className="text-red-300 text-sm mb-1 font-semibold">Could not load bridge markets</p>
        <p className="text-gray-400 text-xs mb-0">{error}</p>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="bg-glass rounded-2xl p-6 text-center" data-testid="bridge-markets-empty">
        <p className="text-gray-400 text-sm mb-0">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3" data-testid={testId}>
      {markets.map((market) => (
        <ExternalMarketTile
          key={market.id}
          market={market}
          chain={chainsByKey[market.chainKey]}
          system={systemsByKey[market.systemKey]}
        />
      ))}
    </div>
  );
}
