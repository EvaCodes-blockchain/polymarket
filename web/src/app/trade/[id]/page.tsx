'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import MarketInfoCard from '@/components/MarketInfoCard';
import BuyPanel from '@/components/BuyPanel';
import PositionCard from '@/components/PositionCard';

interface TradePageProps {
  params: { id: string };
}

/**
 * /trade/[id] — CEO-4 trading page.
 *
 * For the MVP, id=0 maps to the seeded El Clásico market.
 * Other IDs show the same market (single-market MVP).
 *
 * Layout: back button + MarketInfoCard on top, BuyPanel + PositionCard below.
 */
export default function TradePage({ params: _params }: TradePageProps) {
  const router = useRouter();
  const [buyRefreshKey, setBuyRefreshKey] = useState(0);

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

        {/* Market info + probability bars */}
        <MarketInfoCard />

        {/* Buy panel */}
        <div className="mb-4">
          <BuyPanel onBuySuccess={handleBuySuccess} />
        </div>

        {/* Current position */}
        <PositionCard refreshKey={buyRefreshKey} />
      </div>
    </AppShell>
  );
}
