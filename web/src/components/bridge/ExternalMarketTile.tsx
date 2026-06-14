'use client';

import Image from 'next/image';
import TransportBadge from './TransportBadge';
import { formatUsdcShort } from '@/lib/client/bridgeApi';
import type { BridgeChainDTO, BridgeSystemDTO, ExternalMarketDTO } from '@/lib/client/bridgeApi';

interface ExternalMarketTileProps {
  market: ExternalMarketDTO;
  /** the chain this market rides — used for the transport badge */
  chain?: BridgeChainDTO | undefined;
  /** the system that surfaced this market — used for the venue label */
  system?: BridgeSystemDTO | undefined;
}

const FALLBACK_IMAGE = '/img/trend1.jpg';

function ChanceArc({ pct }: { pct: number }) {
  // SVG circle circumference for r=15.9155 is 100 (mirrors markets/MarketTile)
  const dashArray = `${pct}, 100`;
  return (
    <div className="flex flex-col items-center flex-shrink-0">
      <svg width="48" height="48" viewBox="0 0 36 36" className="chance-svg rotate-[-90deg]">
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
 * A single external (bridged / aggregated) market, restyled with the glass
 * theme to echo the markets-catalog tile. Surfaces the transport blockchain it
 * rides, the system that listed it, prices, volume and liquidity.
 *
 * Trading is MOCKED for this feature — the "Trade via bridge" action is a
 * styled-but-disabled preview, with an optional link out to the source venue.
 */
export default function ExternalMarketTile({ market, chain, system }: ExternalMarketTileProps) {
  const systemName = system?.name ?? market.systemKey;
  const chainName = chain?.name ?? market.chainKey;
  const hasSource = !!market.sourceUrl && market.sourceUrl !== '#';

  return (
    <div
      className="relative bg-glass rounded-2xl p-3 shadow-sm transition-colors hover:bg-white/5"
      data-testid="external-market-tile"
    >
      <div className="flex gap-3 mb-3">
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
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1 flex-wrap">
            <span
              className="px-1.5 py-px rounded bg-white/10 text-gray-300 text-[10px] font-bold tracking-wide"
              data-testid="external-market-system"
            >
              {systemName}
            </span>
            <span className="text-gray-600">•</span>
            <span className="truncate max-w-[120px]">{market.category}</span>
          </div>
          <p className="font-semibold text-white text-sm leading-snug line-clamp-2 mb-1">
            {market.question}
          </p>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {chain && (
              <TransportBadge transport={chain.transport} label={chain.transportLabel} />
            )}
            <span className="text-[10px] text-gray-500">on {chainName}</span>
          </div>
          <div className="flex gap-3 text-xs text-gray-500">
            <span className="text-indigo-300">{formatUsdcShort(market.volumeUsdc)} vol</span>
            <span>{formatUsdcShort(market.liquidityUsdc)} liq</span>
          </div>
        </div>

        {/* Chance arc */}
        <ChanceArc pct={market.chancePct} />
      </div>

      {/* Yes / No price chips */}
      <div className="flex gap-2 mb-2">
        <span
          className="flex-1 py-2 rounded-xl text-xs font-bold text-center text-emerald-300
                     bg-emerald-500/15 border border-emerald-500/30"
          data-testid="external-market-yes"
        >
          {market.outcomeYes} {Math.round(market.priceYes * 100)}¢
        </span>
        <span
          className="flex-1 py-2 rounded-xl text-xs font-bold text-center text-red-300
                     bg-red-500/15 border border-red-500/30"
          data-testid="external-market-no"
        >
          {market.outcomeNo} {Math.round(market.priceNo * 100)}¢
        </span>
      </div>

      {/* Interact affordance — mocked preview */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled
          className="flex-1 py-2 rounded-xl text-xs font-bold text-center text-gray-300
                     bg-white/5 border border-white/15 cursor-not-allowed opacity-70"
          title="Bridged trading is a preview — not wired to a live contract"
          data-testid="external-market-trade"
        >
          Trade via bridge
        </button>
        {hasSource && (
          <a
            href={market.sourceUrl ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="py-2 px-3 rounded-xl text-xs font-bold text-center text-indigo-300
                       bg-indigo-500/15 border border-indigo-500/30 hover:bg-indigo-500/30
                       transition-colors no-underline"
            data-testid="external-market-source"
          >
            Source ↗
          </a>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-gray-500 text-center">
        Preview only — bridged trade is mocked for this build.
      </p>
    </div>
  );
}
