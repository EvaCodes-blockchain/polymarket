'use client';

/**
 * useGlobalAddresses — runtime resolution of the two global contract addresses
 * (MockUSDC, OutcomeToken), closing BUG-002.
 *
 * Fetches GET /api/config (the live deployment artifact) once and caches it for
 * the session. Until it resolves — and if the request fails — it falls back to
 * the static CONTRACT_ADDRESSES baked at build time, so the UI never blocks.
 * Per-market addresses are NOT here; they already come from the Markets API DTO.
 */

import { useEffect, useState } from 'react';
import { fetchChainConfig } from '@/lib/client/api';
import { CONTRACT_ADDRESSES } from '@/lib/client/contracts';

export interface GlobalAddresses {
  MockUSDC: `0x${string}`;
  OutcomeToken: `0x${string}`;
}

const FALLBACK: GlobalAddresses = {
  MockUSDC: CONTRACT_ADDRESSES.MockUSDC,
  OutcomeToken: CONTRACT_ADDRESSES.OutcomeToken,
};

// Module-level cache: resolve /api/config at most once per page load.
let cached: GlobalAddresses | null = null;

export function useGlobalAddresses(): GlobalAddresses {
  const [addresses, setAddresses] = useState<GlobalAddresses>(cached ?? FALLBACK);

  useEffect(() => {
    if (cached) return;
    let active = true;
    fetchChainConfig()
      .then((cfg) => {
        cached = cfg.addresses;
        if (active) setAddresses(cfg.addresses);
      })
      .catch(() => {
        // keep fallback — /api/config unavailable
      });
    return () => {
      active = false;
    };
  }, []);

  return addresses;
}
