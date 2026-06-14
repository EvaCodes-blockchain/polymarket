'use client';

import TransportBadge from './TransportBadge';
import type { BridgeChainDTO } from '@/lib/client/bridgeApi';

interface ChainPickerProps {
  chains: BridgeChainDTO[];
  /** null === "All chains" */
  selected: string | null;
  onSelect: (chainKey: string | null) => void;
}

/**
 * Lets the user pick a transport blockchain to filter the bridge markets by.
 * Each card shows the chain name, its transport badge (CCIP/Wormhole),
 * collateral asset and how many markets are mocked on it. "All chains" clears
 * the filter.
 */
export default function ChainPicker({ chains, selected, onSelect }: ChainPickerProps) {
  return (
    <div data-testid="chain-picker">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
        Transport blockchain
      </p>
      <div className="flex flex-wrap gap-2">
        {/* All chains */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`rounded-2xl px-4 py-3 text-left transition-colors border ${
            selected === null
              ? 'bg-white/10 border-white/30 text-white'
              : 'bg-glass border-white/10 text-gray-300 hover:bg-white/5'
          }`}
          data-testid="chain-option-all"
          aria-pressed={selected === null}
        >
          <span className="block text-sm font-semibold">All chains</span>
          <span className="block text-[11px] text-gray-400">Every transport</span>
        </button>

        {chains.map((chain) => {
          const active = selected === chain.key;
          return (
            <button
              key={chain.key}
              type="button"
              onClick={() => onSelect(chain.key)}
              className={`rounded-2xl px-4 py-3 text-left transition-colors border min-w-[180px] ${
                active
                  ? 'bg-white/10 border-white/30 text-white'
                  : 'bg-glass border-white/10 text-gray-300 hover:bg-white/5'
              }`}
              data-testid={`chain-option-${chain.key}`}
              aria-pressed={active}
            >
              <span className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: chain.accent }}
                />
                <span className="text-sm font-semibold text-white truncate">{chain.name}</span>
              </span>
              <span className="block mb-1.5">
                <TransportBadge transport={chain.transport} label={chain.transportLabel} />
              </span>
              <span className="flex items-center gap-2 text-[11px] text-gray-400">
                <span>{chain.collateral}</span>
                <span className="text-gray-600">•</span>
                <span>{chain.marketCount} markets</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
