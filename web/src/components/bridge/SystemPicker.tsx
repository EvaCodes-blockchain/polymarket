'use client';

import type { BridgeSystemDTO } from '@/lib/client/bridgeApi';

interface SystemPickerProps {
  systems: BridgeSystemDTO[];
  /** null === "All systems" */
  selected: string | null;
  onSelect: (systemKey: string | null) => void;
}

function KindBadge({ kind }: { kind: BridgeSystemDTO['kind'] }) {
  const isFirst = kind === 'first-party';
  return (
    <span
      className={`px-1.5 py-px rounded text-[10px] font-bold tracking-wide ${
        isFirst
          ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
          : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
      }`}
      data-testid="system-kind-badge"
    >
      {isFirst ? 'first-party' : 'third-party'}
    </span>
  );
}

/**
 * Lets the user pick which prediction-market system (venue) to view — Justify
 * itself (first-party) or an aggregated third-party venue such as the original
 * Polymarket. "All systems" clears the filter.
 */
export default function SystemPicker({ systems, selected, onSelect }: SystemPickerProps) {
  return (
    <div data-testid="system-picker">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
        Prediction-market system
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors border ${
            selected === null
              ? 'bg-white/10 border-white/30 text-white'
              : 'bg-glass border-white/10 text-gray-300 hover:bg-white/5'
          }`}
          data-testid="system-option-all"
          aria-pressed={selected === null}
        >
          All systems
        </button>

        {systems.map((system) => {
          const active = selected === system.key;
          return (
            <button
              key={system.key}
              type="button"
              onClick={() => onSelect(system.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors border ${
                active
                  ? 'bg-white/10 border-white/30 text-white'
                  : 'bg-glass border-white/10 text-gray-300 hover:bg-white/5'
              }`}
              data-testid={`system-option-${system.key}`}
              aria-pressed={active}
              title={system.blurb}
            >
              <span className="truncate max-w-[160px]">{system.name}</span>
              <KindBadge kind={system.kind} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
