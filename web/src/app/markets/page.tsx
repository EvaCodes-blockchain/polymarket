'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import CategoryFilter from '@/components/markets/CategoryFilter';
import MarketTile from '@/components/markets/MarketTile';
import { fetchMarkets } from '@/lib/client/api';
import type { MarketDTO } from '@/lib/client/api';

const PAGE_SIZE = 50;

/**
 * Markets catalog page (FR-MKT-1..3, FR-NAV-4) — CEO-demo page.
 * Mirrors the prototype market.html Explore grid with the glass theme:
 * header, category filter chips, responsive tile grid, Load more.
 */
export default function MarketsPage() {
  const [markets, setMarkets] = useState<MarketDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMarkets({ limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        setMarkets(res.markets);
        setNextCursor(res.nextCursor);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load markets');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    fetchMarkets({ limit: PAGE_SIZE, cursor: nextCursor })
      .then((res) => {
        setMarkets((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...res.markets.filter((m) => !seen.has(m.id))];
        });
        setNextCursor(res.nextCursor);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load more markets');
      })
      .finally(() => setLoadingMore(false));
  }, [nextCursor, loadingMore]);

  const categories = useMemo(() => {
    const distinct = new Set<string>();
    for (const m of markets) distinct.add(m.category);
    return Array.from(distinct).sort();
  }, [markets]);

  const visibleMarkets = useMemo(
    () =>
      category === 'all'
        ? markets
        : markets.filter((m) => m.category === category),
    [markets, category]
  );

  return (
    <AppShell>
      <div className="p-4 lg:p-6" data-testid="markets-page">
        {/* Header */}
        <div className="mb-4">
          <h1
            className="text-2xl font-bold text-white mb-1"
            style={{ fontFamily: "'ClashDisplay', sans-serif" }}
          >
            Markets
          </h1>
          <p className="text-gray-400 text-sm mb-0">
            Explore live prediction markets and trade what you believe.
          </p>
        </div>

        {/* Category filter chips */}
        <div className="mb-4">
          <CategoryFilter
            categories={categories}
            selected={category}
            onSelect={setCategory}
          />
        </div>

        {/* Loading state */}
        {loading && (
          <div
            className="flex justify-center py-12"
            data-testid="markets-loading"
          >
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div
            className="bg-glass rounded-2xl p-6 text-center"
            data-testid="markets-error"
          >
            <p className="text-red-300 text-sm mb-1 font-semibold">
              Could not load markets
            </p>
            <p className="text-gray-400 text-xs mb-0">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && visibleMarkets.length === 0 && (
          <div
            className="bg-glass rounded-2xl p-6 text-center"
            data-testid="markets-empty"
          >
            <p className="text-gray-400 text-sm mb-0">
              No markets yet — the generator will populate this page.
            </p>
          </div>
        )}

        {/* Catalog grid */}
        {!loading && !error && visibleMarkets.length > 0 && (
          <div
            className="grid grid-cols-1 xl:grid-cols-2 gap-3"
            data-testid="markets-grid"
          >
            {visibleMarkets.map((market) => (
              <MarketTile key={market.id} market={market} />
            ))}
          </div>
        )}

        {/* Load more */}
        {!loading && !error && nextCursor !== null && (
          <div className="flex justify-center mt-4">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="btn-primary text-sm disabled:opacity-50"
              data-testid="markets-load-more"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
