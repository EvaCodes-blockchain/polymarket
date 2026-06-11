'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import MarketInfoCard from '@/components/MarketInfoCard';
import BuyPanel from '@/components/BuyPanel';
import PositionCard from '@/components/PositionCard';
import type { MarketDTO } from '@/lib/client/api';
import { fetchMarket } from '@/lib/client/api';

interface TradePageProps {
  params: { id: string };
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; market: MarketDTO };

/**
 * /trade/[id] — CEO-4 trading page, parametric over any market.
 *
 * `id` is the Market cuid or the numeric on-chain marketId — the server
 * resolves either via GET /api/markets/[id].
 *
 * Layout: back button + MarketInfoCard on top, BuyPanel + PositionCard below.
 */
export default function TradePage({ params }: TradePageProps) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [buyRefreshKey, setBuyRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchMarket(params.id)
      .then((market) => {
        if (!cancelled) setState({ status: 'ready', market });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load market',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const handleBuySuccess = () => {
    // Bump key to trigger PositionCard refetch
    setBuyRefreshKey((k) => k + 1);
  };

  return (
    <AppShell>
      <div className="px-4 py-4">
        {/* Back header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => router.back()}
            className="material-icons text-white hover:text-indigo-400 transition-colors"
            aria-label="Back"
          >
            arrow_back
          </button>
          <h1 className="text-white font-bold text-base">Trade</h1>
        </div>

        {state.status === 'loading' && (
          <div
            className="bg-glass rounded-2xl p-10 flex flex-col items-center gap-3"
            data-testid="trade-loading"
          >
            <span className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Loading market…</p>
          </div>
        )}

        {state.status === 'error' && (
          <div
            className="bg-glass rounded-2xl p-10 text-center"
            data-testid="trade-not-found"
          >
            <span className="material-icons text-gray-500 text-4xl mb-3 block">
              search_off
            </span>
            <p className="text-white font-semibold text-sm mb-1">Market not found</p>
            <p className="text-gray-400 text-xs mb-4">{state.message}</p>
            <Link
              href="/markets"
              className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-full transition-colors no-underline"
            >
              Browse markets
            </Link>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            {/* Market info + probability bars */}
            <MarketInfoCard market={state.market} />

            {/* Buy panel */}
            <div className="mb-4">
              <BuyPanel market={state.market} onBuySuccess={handleBuySuccess} />
            </div>

            {/* Current position */}
            <PositionCard market={state.market} refreshKey={buyRefreshKey} />
          </>
        )}
      </div>
    </AppShell>
  );
}
