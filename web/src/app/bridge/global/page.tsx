'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import TransportChainCard from '@/components/bridge/TransportChainCard';
import BridgeMarketsGrid from '@/components/bridge/BridgeMarketsGrid';
import { formatUsdcShort } from '@/lib/client/bridgeApi';
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
 * Global Event Markets Dashboard (feature/bridge-1).
 *
 * Aggregates every market across every system and chain, and EMPHASISES the
 * transport blockchains Justify rides (Chainlink CCIP for EVM↔EVM, Wormhole for
 * Sui↔EVM) in a hero section. Below, the full market grid is filterable
 * client-side by chain and system, with each tile badged by its transport.
 */
export default function GlobalEventMarketsPage() {
  const [chains, setChains] = useState<BridgeChainDTO[]>([]);
  const [systems, setSystems] = useState<BridgeSystemDTO[]>([]);
  const [markets, setMarkets] = useState<ExternalMarketDTO[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [chainFilter, setChainFilter] = useState<string | null>(null);
  const [systemFilter, setSystemFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchBridgeChains(), fetchBridgeSystems(), fetchBridgeMarkets()])
      .then(([chainsRes, systemsRes, marketsRes]) => {
        if (cancelled) return;
        setChains(chainsRes.chains);
        setSystems(systemsRes.systems);
        setMarkets(marketsRes.markets);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load global markets');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chainsByKey = useMemo(
    () => Object.fromEntries(chains.map((c) => [c.key, c])),
    [chains]
  );
  const systemsByKey = useMemo(
    () => Object.fromEntries(systems.map((s) => [s.key, s])),
    [systems]
  );

  // Total volume per chain, computed from the fetched markets.
  const volumeByChain = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const m of markets) {
      acc[m.chainKey] = (acc[m.chainKey] ?? 0) + m.volumeUsdc;
    }
    return acc;
  }, [markets]);

  const totalVolume = useMemo(
    () => markets.reduce((sum, m) => sum + m.volumeUsdc, 0),
    [markets]
  );

  const filteredMarkets = useMemo(
    () =>
      markets.filter(
        (m) =>
          (chainFilter === null || m.chainKey === chainFilter) &&
          (systemFilter === null || m.systemKey === systemFilter)
      ),
    [markets, chainFilter, systemFilter]
  );

  return (
    <AppShell>
      <div className="p-4 lg:p-6" data-testid="global-markets-page">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1
              className="text-2xl font-bold text-white mb-1"
              style={{ fontFamily: "'ClashDisplay', sans-serif" }}
            >
              Global Event Markets
            </h1>
            <p className="text-gray-400 text-sm mb-0 max-w-2xl">
              Every event market across every system and venue, unified over the blockchains
              Justify uses as transport. The bridge substrate — not any single venue — is the
              backbone.
            </p>
          </div>
          <Link
            href="/bridge"
            className="btn-primary text-sm whitespace-nowrap no-underline"
            data-testid="bridge-dashboard-link"
          >
            ← Bridging dashboard
          </Link>
        </div>

        {/* Summary stats */}
        {!loading && !error && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" data-testid="global-stats">
            <div className="bg-glass rounded-2xl p-3 text-center">
              <p className="text-xl font-bold text-white mb-0">{markets.length}</p>
              <p className="text-[11px] text-gray-400 mb-0">markets</p>
            </div>
            <div className="bg-glass rounded-2xl p-3 text-center">
              <p className="text-xl font-bold text-white mb-0">{formatUsdcShort(totalVolume)}</p>
              <p className="text-[11px] text-gray-400 mb-0">total volume</p>
            </div>
            <div className="bg-glass rounded-2xl p-3 text-center">
              <p className="text-xl font-bold text-white mb-0">{systems.length}</p>
              <p className="text-[11px] text-gray-400 mb-0">systems</p>
            </div>
            <div className="bg-glass rounded-2xl p-3 text-center">
              <p className="text-xl font-bold text-white mb-0">{chains.length}</p>
              <p className="text-[11px] text-gray-400 mb-0">transport chains</p>
            </div>
          </div>
        )}

        {/* Transport blockchains — the emphasis section, FIRST */}
        <section className="mb-6" data-testid="transport-chains">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-icons text-indigo-300" style={{ fontSize: 18 }}>
              hub
            </span>
            <h2
              className="text-lg font-bold text-white mb-0"
              style={{ fontFamily: "'ClashDisplay', sans-serif" }}
            >
              Transport blockchains
            </h2>
          </div>

          {loading && (
            <div className="flex justify-center py-8" data-testid="transport-chains-loading">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && error && (
            <div
              className="bg-glass rounded-2xl p-6 text-center"
              data-testid="transport-chains-error"
            >
              <p className="text-red-300 text-sm mb-1 font-semibold">
                Could not load transport blockchains
              </p>
              <p className="text-gray-400 text-xs mb-0">{error}</p>
            </div>
          )}

          {!loading && !error && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {chains.map((chain) => (
                <TransportChainCard
                  key={chain.key}
                  chain={chain}
                  volumeUsdc={volumeByChain[chain.key] ?? 0}
                />
              ))}
            </div>
          )}
        </section>

        {/* Client-side filter chips */}
        {!loading && !error && (
          <div className="space-y-3 mb-4" data-testid="global-filters">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mr-1">
                Chain
              </span>
              <button
                type="button"
                onClick={() => setChainFilter(null)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors ${
                  chainFilter === null
                    ? 'bg-white/10 border-white/30 text-white'
                    : 'bg-glass border-white/10 text-gray-300 hover:bg-white/5'
                }`}
                data-testid="global-chain-filter-all"
              >
                All
              </button>
              {chains.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setChainFilter(c.key)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors ${
                    chainFilter === c.key
                      ? 'bg-white/10 border-white/30 text-white'
                      : 'bg-glass border-white/10 text-gray-300 hover:bg-white/5'
                  }`}
                  data-testid={`global-chain-filter-${c.key}`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mr-1">
                System
              </span>
              <button
                type="button"
                onClick={() => setSystemFilter(null)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors ${
                  systemFilter === null
                    ? 'bg-white/10 border-white/30 text-white'
                    : 'bg-glass border-white/10 text-gray-300 hover:bg-white/5'
                }`}
                data-testid="global-system-filter-all"
              >
                All
              </button>
              {systems.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSystemFilter(s.key)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors ${
                    systemFilter === s.key
                      ? 'bg-white/10 border-white/30 text-white'
                      : 'bg-glass border-white/10 text-gray-300 hover:bg-white/5'
                  }`}
                  data-testid={`global-system-filter-${s.key}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Full market grid */}
        <BridgeMarketsGrid
          markets={filteredMarkets}
          chainsByKey={chainsByKey}
          systemsByKey={systemsByKey}
          loading={loading}
          error={error}
          emptyMessage="No markets match the current filters."
          testId="global-markets-grid"
        />
      </div>
    </AppShell>
  );
}
