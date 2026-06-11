'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { MarketDTO } from '@/lib/client/api';
import { formatCloseTime, formatVolume } from '@/lib/client/api';

interface MarketTileProps {
  market: MarketDTO;
}

const FALLBACK_IMAGE = '/img/trend1.jpg';

function ChanceArc({ pct }: { pct: number }) {
  // SVG circle circumference for r=15.9155 is 100
  const dashArray = `${pct}, 100`;
  return (
    <div className="flex flex-col items-center flex-shrink-0">
      <svg
        width="48"
        height="48"
        viewBox="0 0 36 36"
        className="chance-svg rotate-[-90deg]"
      >
        <path
          className="arc-bg"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
        />
        <path
          className="arc-progress"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831"
          strokeDasharray={dashArray}
        />
      </svg>
      <span className="text-xs font-bold text-white -mt-9 pt-2">{pct}%</span>
      <span className="text-xs text-gray-400 -mt-1">chance</span>
    </div>
  );
}

/**
 * Markets-catalog tile (FR-MKT-1/3) — prototype `market.html` trending item
 * restyled with the glass theme. The whole tile body links to the trade page
 * (stretched-link pattern); the Yes/No price buttons sit above it.
 */
export default function MarketTile({ market }: MarketTileProps) {
  const tradeHref = `/trade/${market.id}`;
  const creatorName = market.creator.name ?? market.creator.handle ?? 'Unknown';

  return (
    <div
      className="relative bg-glass rounded-2xl p-3 shadow-sm transition-colors hover:bg-white/5"
      data-testid="market-tile"
    >
      {/* Stretched link: whole tile body navigates to the trade page */}
      <Link
        href={tradeHref}
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={market.question}
        data-testid="market-tile-link"
      />

      <div className="flex gap-3 mb-3 pointer-events-none">
        {/* Thumb */}
        <div className="flex-shrink-0">
          <Image
            src={market.imageUrl ?? FALLBACK_IMAGE}
            alt={market.question}
            width={64}
            height={64}
            className="rounded-xl object-cover w-16 h-16"
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5 flex-wrap">
            <span className="truncate max-w-[120px]">@{creatorName}</span>
            {market.creator.isBot && (
              <span
                className="px-1.5 py-px rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold tracking-wide"
                data-testid="market-tile-bot-badge"
              >
                BOT
              </span>
            )}
            <span className="text-gray-600">•</span>
            <span
              className="px-1.5 py-px rounded bg-white/10 text-gray-300 text-[10px] font-bold tracking-wide"
              data-testid="market-tile-type-chip"
            >
              {market.marketType}
            </span>
          </div>
          <p className="font-semibold text-white text-sm leading-snug line-clamp-2 mb-1">
            {market.question}
          </p>
          <div className="flex gap-3 text-xs text-gray-500">
            <span className="text-indigo-300">
              {formatVolume(market.volumeUsdc)}
            </span>
            <span>{formatCloseTime(market.closeTime)}</span>
          </div>
        </div>

        {/* Chance arc */}
        <ChanceArc pct={market.chancePct} />
      </div>

      {/* Yes / No price buttons — above the stretched link */}
      <div className="relative z-10 flex gap-2">
        <Link
          href={tradeHref}
          className="flex-1 py-2 rounded-xl text-xs font-bold text-center text-emerald-300
                     bg-emerald-500/15 border border-emerald-500/30
                     hover:bg-emerald-500/30 transition-colors no-underline"
          data-testid="market-tile-buy-yes"
        >
          {market.outcomeYes} {Math.round(market.priceYes * 100)}¢
        </Link>
        <Link
          href={tradeHref}
          className="flex-1 py-2 rounded-xl text-xs font-bold text-center text-red-300
                     bg-red-500/15 border border-red-500/30
                     hover:bg-red-500/30 transition-colors no-underline"
          data-testid="market-tile-buy-no"
        >
          {market.outcomeNo} {Math.round(market.priceNo * 100)}¢
        </Link>
      </div>
    </div>
  );
}
