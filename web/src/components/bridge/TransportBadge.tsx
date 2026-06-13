'use client';

import { transportBadgeClass } from '@/lib/client/bridgeApi';
import type { BridgeChainDTO } from '@/lib/client/bridgeApi';

interface TransportBadgeProps {
  transport: BridgeChainDTO['transport'];
  /** human label, e.g. "Chainlink CCIP" — comes from BridgeChainDTO.transportLabel */
  label: string;
  /** larger pill for the global "transport blockchains" emphasis section */
  size?: 'sm' | 'lg';
}

/**
 * Pill that surfaces the cross-chain transport (Chainlink CCIP vs Wormhole vs
 * native) riding a given chain. Colour comes from the frozen
 * `transportBadgeClass` helper so the dashboard and global page stay consistent.
 */
export default function TransportBadge({ transport, label, size = 'sm' }: TransportBadgeProps) {
  const sizing = size === 'lg' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold tracking-wide ${sizing} ${transportBadgeClass(
        transport
      )}`}
      data-testid="transport-badge"
    >
      <span className="material-icons" style={{ fontSize: size === 'lg' ? 14 : 11 }}>
        hub
      </span>
      {label}
    </span>
  );
}
