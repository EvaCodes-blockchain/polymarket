'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import ChainPicker from '@/components/bridge/ChainPicker';
import SystemPicker from '@/components/bridge/SystemPicker';
import BridgeMarketsGrid from '@/components/bridge/BridgeMarketsGrid';
import {
  fetchBridgeChains,
  fetchBridgeSystems,
  fetchBridgeMarkets,
} from '@/lib/client/bridgeApi';
import type {
  BridgeChainDTO,
  BridgeSystemDTO,
  ExternalMarketDTO,
} from '@/lib/client/bridgeApi';

/**
 * Bridging Dashboard (feature/bridge-1).
 *
 * The user first chooses a transport blockchain and a prediction-market system
 * (Justify or a third-party venue such as the original Polymarket), then sees
 * the markets surfaced there. Everything is mocked/read-only — interaction is a
 * styled preview, not a live trade.
 */
export default function BridgeDashboardPage() {
  const [chains, setChains] = useState<BridgeChainDTO[]>([]);
  const [systems, setSystems] = useState<BridgeSystemDTO[]>([]);
  const [chainsError, setChainsError] = useState<string | null>(null);

  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);

  const [markets, setMarkets] = useState<ExternalMarketDTO[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState<string | null>(null);

  // Load choosers once.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBridgeChains(), fetchBridgeSystems()])
      .then(([chainsRes, systemsRes]) => {
        if (cancelled) return;
        setChains(chainsRes.chains);
        setSystems(systemsRes.systems);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setChainsError(err instanceof Error ? err.message : 'Failed to load bridge options');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reload markets whenever the selection changes.
  useEffect(() => {
    let cancelled = false;
    setMarketsLoading(true);
    setMarketsError(null);
    fetchBridgeMarkets({
      ...(selectedChain ? { chainKey: selectedChain } : {}),
      ...(selectedSystem ? { systemKey: selectedSystem } : {}),
    })
      .then((res) => {
        if (cancelled) return;
        setMarkets(res.markets);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMarketsError(err instanceof Error ? err.message : 'Failed to load bridge markets');
      })
      .finally(() => {
        if (!cancelled) setMarketsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChain, selectedSystem]);

  const chainsByKey = useMemo(
    () => Object.fromEntries(chains.map((c) => [c.key, c])),
    [chains]
  );
  const systemsByKey = useMemo(
    () => Object.fromEntries(systems.map((s) => [s.key, s])),
    [systems]
  );

  const selectedChainLabel = selectedChain
    ? chainsByKey[selectedChain]?.name ?? selectedChain
    : 'All chains';
  const selectedSystemLabel = selectedSystem
    ? systemsByKey[selectedSystem]?.name ?? selectedSystem
    : 'All systems';

  return (
    <AppShell>
      <div className="p-4 lg:p-6" data-testid="bridge-dashboard">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1
              className="text-2xl font-bold text-white mb-1"
              style={{ fontFamily: "'ClashDisplay', sans-serif" }}
            >
              Bridging Dashboard
            </h1>
            <p className="text-gray-400 text-sm mb-0 max-w-2xl">
              Choose a transport blockchain and a prediction-market system — including
              third-party systems such as the original Polymarket — and explore the markets
              they surface across the bridge.
            </p>
          </div>
          <Link
            href="/bridge/global"
            className="btn-primary text-sm whitespace-nowrap no-underline"
            data-testid="bridge-global-link"
          >
            Global view →
          </Link>
        </div>

        {chainsError && (
          <div
            className="bg-glass rounded-2xl p-4 mb-4 text-center"
            data-testid="bridge-options-error"
          >
            <p className="text-red-300 text-sm mb-1 font-semibold">
              Could not load bridge options
            </p>
            <p className="text-gray-400 text-xs mb-0">{chainsError}</p>
          </div>
        )}

        {/* Choosers */}
        <div className="space-y-4 mb-5">
          <ChainPicker chains={chains} selected={selectedChain} onSelect={setSelectedChain} />
          <SystemPicker
            systems={systems}
            selected={selectedSystem}
            onSelect={setSelectedSystem}
          />
        </div>

        {/* Active selection summary */}
        <div
          className="flex items-center gap-2 text-xs text-gray-400 mb-3"
          data-testid="bridge-selection"
        >
          <span className="material-icons" style={{ fontSize: 14 }}>
            filter_alt
          </span>
          <span>
            Showing <span className="text-white font-semibold">{selectedSystemLabel}</span> on{' '}
            <span className="text-white font-semibold">{selectedChainLabel}</span>
          </span>
        </div>

        {/* Markets */}
        <BridgeMarketsGrid
          markets={markets}
          chainsByKey={chainsByKey}
          systemsByKey={systemsByKey}
          loading={marketsLoading}
          error={marketsError}
          emptyMessage="No markets for this chain + system combination yet."
        />
      </div>
    </AppShell>
  );
}
