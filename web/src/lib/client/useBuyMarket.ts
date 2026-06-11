'use client';

/**
 * useBuyMarket — parametric buy flow for any market from the Markets API (CEO-4).
 *
 * Encapsulates the full trade lifecycle against a market's own AMM:
 *   idle → faucet (server mints test USDC) → approving → buying → success | error
 *
 * Per-market addresses come from `MarketDTO.addresses` ({ market, amm });
 * only MockUSDC + OutcomeToken stay global (CONTRACT_ADDRESSES).
 *
 * Test USDC is minted via POST /api/faucet (`requestFaucet`) — the server's
 * deployer key mints. A direct client-side MockUSDC.mint is onlyOwner and
 * REVERTS for regular users, so never call it from the browser.
 */

import { useCallback, useState } from 'react';
import {
  useAccount,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import type { MarketDTO } from '@/lib/client/api';
import { requestFaucet } from '@/lib/client/api';
import {
  CONTRACT_ADDRESSES,
  MARKET_AMM_ABI,
  MOCK_USDC_ABI,
} from '@/lib/client/contracts';
import { ganache } from '@/lib/client/wagmi';

export const USDC_DECIMALS = 6;

export type BuyStep = 'idle' | 'faucet' | 'approving' | 'buying' | 'success' | 'error';

/** Parse a user-entered USDC amount into 6-decimals units; null when invalid. */
export function parseUsdcAmount(amount: string): bigint | null {
  const n = parseFloat(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return parseUnits(amount.trim(), USDC_DECIMALS);
  } catch {
    return null;
  }
}

export interface UseBuyMarketResult {
  /** Current lifecycle step of the buy state machine. */
  step: BuyStep;
  /** Human-readable error message (set when step === 'error'). */
  error: string;
  /** Hash of the last successful buy transaction. */
  txHash: string;
  /** Raw USDC balance of the connected wallet (6 decimals). */
  usdcBalance: bigint | undefined;
  /** Balance formatted for display, '—' when unknown. */
  usdcBalanceFormatted: string;
  /** Live price (0..1) from the market's AMM; falls back to the DTO snapshot. */
  priceYes: number;
  priceNo: number;
  isConnected: boolean;
  address: `0x${string}` | undefined;
  /** True when the wallet is on Ganache (chain 1337). */
  isOnGanache: boolean;
  /** True while a faucet/approve/buy transaction is in flight. */
  isBusy: boolean;
  /**
   * Approve the market's AMM on MockUSDC, then AMM.buy(outcomeIndex, amount, 0).
   * Ensures chain 1337 first (prompts a switch). Resolves with the buy tx hash,
   * or null when the flow did not complete (validation, rejection, revert).
   */
  buy: (outcomeIndex: 0 | 1, amountUsdc: string) => Promise<`0x${string}` | null>;
  /** Mint test USDC to the connected wallet via the server faucet (Ganache only). */
  getTestUsdc: (amountUsdc: string) => Promise<void>;
  /** Return to 'idle' and clear error/txHash. */
  reset: () => void;
  /** Prompt MetaMask to switch to Ganache (1337). */
  switchToGanache: () => void;
  refetchBalance: () => void;
  refetchPrices: () => void;
}

export function useBuyMarket(market: MarketDTO): UseBuyMarketResult {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<BuyStep>('idle');
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');

  const ammAddress = market.addresses.amm;

  // ── USDC balance (global MockUSDC) ──────────────────────────────────────────
  const { data: usdcBalance, refetch: refetchBalanceQuery } = useReadContract({
    address: CONTRACT_ADDRESSES.MockUSDC,
    abi: MOCK_USDC_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // ── Live prices from this market's AMM (fallback: DTO snapshot) ────────────
  const { data: probBps0, refetch: refetchProb0 } = useReadContract({
    address: ammAddress,
    abi: MARKET_AMM_ABI,
    functionName: 'impliedProbabilityBps',
    args: [0],
  });
  const { data: probBps1, refetch: refetchProb1 } = useReadContract({
    address: ammAddress,
    abi: MARKET_AMM_ABI,
    functionName: 'impliedProbabilityBps',
    args: [1],
  });

  const priceYes = probBps0 !== undefined ? Number(probBps0) / 10_000 : market.priceYes;
  const priceNo = probBps1 !== undefined ? Number(probBps1) / 10_000 : market.priceNo;

  const isOnGanache = chainId === ganache.id;
  const isBusy = step === 'faucet' || step === 'approving' || step === 'buying';

  const usdcBalanceFormatted =
    usdcBalance !== undefined
      ? parseFloat(formatUnits(usdcBalance, USDC_DECIMALS)).toFixed(2)
      : '—';

  const refetchBalance = useCallback(() => {
    void refetchBalanceQuery();
  }, [refetchBalanceQuery]);

  const refetchPrices = useCallback(() => {
    void refetchProb0();
    void refetchProb1();
  }, [refetchProb0, refetchProb1]);

  /** Make sure the wallet is on Ganache 1337; prompt a switch when it isn't. */
  const ensureChain = useCallback(async (): Promise<boolean> => {
    if (chainId === ganache.id) return true;
    try {
      await switchChainAsync({ chainId: ganache.id });
      return true;
    } catch {
      setError('Please switch MetaMask to Ganache (chain 1337)');
      setStep('error');
      return false;
    }
  }, [chainId, switchChainAsync]);

  const buy = useCallback(
    async (outcomeIndex: 0 | 1, amountUsdc: string): Promise<`0x${string}` | null> => {
      if (!address) {
        setError('Connect your wallet first');
        setStep('error');
        return null;
      }
      const parsedAmount = parseUsdcAmount(amountUsdc);
      if (!parsedAmount) {
        setError('Enter a valid USDC amount');
        setStep('error');
        return null;
      }
      if (!(await ensureChain())) return null;

      setError('');
      try {
        // 1. Approve this market's AMM to pull the collateral
        setStep('approving');
        await writeContractAsync({
          address: CONTRACT_ADDRESSES.MockUSDC,
          abi: MOCK_USDC_ABI,
          functionName: 'approve',
          args: [ammAddress, parsedAmount],
        });

        // 2. Buy outcome shares on the AMM (minSharesOut = 0 for the MVP)
        setStep('buying');
        const hash = await writeContractAsync({
          address: ammAddress,
          abi: MARKET_AMM_ABI,
          functionName: 'buy',
          args: [outcomeIndex, parsedAmount, BigInt(0)],
        });

        setTxHash(hash);
        setStep('success');
        refetchBalance();
        refetchPrices();
        return hash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // User rejection is not an error worth showing red
        if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('denied')) {
          setStep('idle');
        } else {
          setError(msg.slice(0, 160));
          setStep('error');
        }
        return null;
      }
    },
    [address, ammAddress, ensureChain, refetchBalance, refetchPrices, writeContractAsync],
  );

  const getTestUsdc = useCallback(
    async (amountUsdc: string): Promise<void> => {
      if (!address) {
        setError('Connect your wallet first');
        setStep('error');
        return;
      }
      const n = parseFloat(amountUsdc);
      // Faucet caps at 1000; default to 100 on nonsense input
      const amount = Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 100;

      setError('');
      setStep('faucet');
      try {
        await requestFaucet(address, amount);
        refetchBalance();
        setStep('idle');
      } catch (err) {
        setError(err instanceof Error ? err.message.slice(0, 160) : 'Faucet failed');
        setStep('error');
      }
    },
    [address, refetchBalance],
  );

  const reset = useCallback(() => {
    setStep('idle');
    setError('');
    setTxHash('');
  }, []);

  const switchToGanache = useCallback(() => {
    switchChain({ chainId: ganache.id });
  }, [switchChain]);

  return {
    step,
    error,
    txHash,
    usdcBalance,
    usdcBalanceFormatted,
    priceYes,
    priceNo,
    isConnected,
    address,
    isOnGanache,
    isBusy,
    buy,
    getTestUsdc,
    reset,
    switchToGanache,
    refetchBalance,
    refetchPrices,
  };
}
