'use client';

import { useAccount, useDisconnect } from 'wagmi';
import { useEffect, useState } from 'react';

interface WalletState {
  /** Connected address (checksummed) or null */
  address: string | null;
  /** Whether MetaMask is connected */
  isConnected: boolean;
  /** Chain ID of the connected wallet */
  chainId: number | undefined;
  /** Whether the wallet is on the app's configured chain (Ganache or Arc) */
  isCorrectChain: boolean;
  disconnect: () => void;
}

const APP_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '1337');

/**
 * Convenience hook: reads wagmi account state + checks chain.
 * Use this in components that need to show the connected wallet address.
 */
export function useWallet(): WalletState {
  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();

  return {
    address: address ?? null,
    isConnected,
    chainId: chain?.id,
    isCorrectChain: chain?.id === APP_CHAIN_ID,
    disconnect,
  };
}
