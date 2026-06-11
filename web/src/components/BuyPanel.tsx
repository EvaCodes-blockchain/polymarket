'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import {
  CONTRACT_ADDRESSES,
  MOCK_USDC_ABI,
  MARKET_AMM_ABI,
  SEEDED_MARKET,
} from '@/lib/client/contracts';
import { ganache } from '@/lib/client/wagmi';

interface BuyPanelProps {
  /** Called after a successful buy so parent can refresh position */
  onBuySuccess?: (sharesOut: bigint, outcomeIndex: number) => void;
}

type Step = 'idle' | 'minting' | 'approving' | 'buying' | 'success' | 'error';

const USDC_DECIMALS = 6;

/**
 * BuyPanel — CEO-4 trade entry UI.
 *
 * Flow:
 *   1. User picks outcome (Barcelona / Real Madrid)
 *   2. User enters USDC amount
 *   3. Click "Get Test USDC" → MockUSDC.mint(user, amount)  [Ganache only]
 *   4. Click "Approve" → MockUSDC.approve(ammAddress, amount)
 *   5. Click "Buy" → MarketAMM.buy(outcomeIndex, amount, minSharesOut=0)
 *   6. Show txHash + shares received
 */
export default function BuyPanel({ onBuySuccess }: BuyPanelProps) {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [selectedOutcome, setSelectedOutcome] = useState<0 | 1>(0);
  const [amountStr, setAmountStr] = useState('10');
  const [step, setStep] = useState<Step>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [successTxHash, setSuccessTxHash] = useState('');
  const [sharesReceived, setSharesReceived] = useState<bigint | null>(null);

  // ── Read USDC balance ──────────────────────────────────────────────────────
  const { data: usdcBalance, refetch: refetchBalance } = useReadContract({
    address: CONTRACT_ADDRESSES.MockUSDC,
    abi: MOCK_USDC_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // ── Read implied probability for selected outcome ──────────────────────────
  const { data: probBps0 } = useReadContract({
    address: CONTRACT_ADDRESSES.MarketAMM,
    abi: MARKET_AMM_ABI,
    functionName: 'impliedProbabilityBps',
    args: [0],
  });
  const { data: probBps1 } = useReadContract({
    address: CONTRACT_ADDRESSES.MarketAMM,
    abi: MARKET_AMM_ABI,
    functionName: 'impliedProbabilityBps',
    args: [1],
  });

  // ── Wait for last tx (buy) ─────────────────────────────────────────────────
  const { data: txReceipt } = useWaitForTransactionReceipt({
    hash: successTxHash ? (successTxHash as `0x${string}`) : undefined,
    query: { enabled: !!successTxHash },
  });

  useEffect(() => {
    if (txReceipt) {
      void refetchBalance();
    }
  }, [txReceipt, refetchBalance]);

  const parsedAmount = (() => {
    try {
      const n = parseFloat(amountStr);
      if (isNaN(n) || n <= 0) return null;
      return parseUnits(amountStr, USDC_DECIMALS);
    } catch {
      return null;
    }
  })();

  const balanceFormatted = usdcBalance !== undefined
    ? parseFloat(formatUnits(usdcBalance, USDC_DECIMALS)).toFixed(2)
    : '—';

  const prob0 = probBps0 !== undefined ? Number(probBps0) / 100 : null;
  const prob1 = probBps1 !== undefined ? Number(probBps1) / 100 : null;

  const handleWrongChain = useCallback(async (): Promise<boolean> => {
    if (chainId !== ganache.id) {
      try {
        switchChain({ chainId: ganache.id });
        return false; // user needs to confirm switch first
      } catch {
        setErrorMsg('Please switch MetaMask to Ganache (chain 1337)');
        setStep('error');
        return false;
      }
    }
    return true;
  }, [chainId, switchChain]);

  // ── Step 1: Mint test USDC ─────────────────────────────────────────────────
  const handleMint = async () => {
    if (!address || !parsedAmount) return;
    if (!(await handleWrongChain())) return;
    setStep('minting');
    setErrorMsg('');
    try {
      await writeContractAsync({
        address: CONTRACT_ADDRESSES.MockUSDC,
        abi: MOCK_USDC_ABI,
        functionName: 'mint',
        args: [address, parsedAmount],
      });
      await refetchBalance();
      setStep('idle');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Mint failed');
      setStep('error');
    }
  };

  // ── Step 2: Approve + Buy ──────────────────────────────────────────────────
  const handleBuy = async () => {
    if (!address || !parsedAmount) return;
    if (!(await handleWrongChain())) return;

    setErrorMsg('');
    try {
      // Approve
      setStep('approving');
      await writeContractAsync({
        address: CONTRACT_ADDRESSES.MockUSDC,
        abi: MOCK_USDC_ABI,
        functionName: 'approve',
        args: [CONTRACT_ADDRESSES.MarketAMM, parsedAmount],
      });

      // Buy
      setStep('buying');
      const txHash = await writeContractAsync({
        address: CONTRACT_ADDRESSES.MarketAMM,
        abi: MARKET_AMM_ABI,
        functionName: 'buy',
        args: [selectedOutcome, parsedAmount, BigInt(0)],
      });

      setSuccessTxHash(txHash);
      // sharesOut comes from the tx receipt log — for demo we estimate
      // The Buy event has sharesOut; we show a success state and let parent refresh
      setSharesReceived(parsedAmount); // placeholder until event parsing
      setStep('success');
      onBuySuccess?.(parsedAmount, selectedOutcome);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // User rejection is not an error worth showing red
      if (msg.includes('User rejected') || msg.includes('user rejected')) {
        setStep('idle');
      } else {
        setErrorMsg(msg.slice(0, 120));
        setStep('error');
      }
    }
  };

  const isLoading = step === 'minting' || step === 'approving' || step === 'buying';

  if (!isConnected || !address) {
    return (
      <div className="bg-glass rounded-2xl p-6 text-center">
        <span className="material-icons text-indigo-400 text-4xl mb-3 block">account_balance_wallet</span>
        <p className="text-gray-300 text-sm mb-3">Connect MetaMask to place a bet</p>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('justify:connectWallet'))}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-full transition-colors"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  if (chainId !== ganache.id) {
    return (
      <div className="bg-glass rounded-2xl p-6 text-center">
        <span className="material-icons text-yellow-400 text-4xl mb-3 block">warning</span>
        <p className="text-gray-300 text-sm mb-3">Wrong network — switch to Ganache (1337)</p>
        <button
          onClick={() => switchChain({ chainId: ganache.id })}
          className="bg-yellow-500 hover:bg-yellow-600 text-black text-sm font-semibold px-4 py-2 rounded-full transition-colors"
        >
          Switch to Ganache
        </button>
      </div>
    );
  }

  return (
    <div className="bg-glass rounded-2xl p-5 shadow-sm">
      <h3 className="text-white font-bold text-sm mb-4">Place a Bet</h3>

      {/* Outcome selector */}
      <div className="mb-4">
        <p className="text-gray-400 text-xs mb-2">Pick your outcome</p>
        <div className="grid grid-cols-2 gap-2">
          {SEEDED_MARKET.outcomeLabels.map((label, i) => {
            const prob = i === 0 ? prob0 : prob1;
            const isSelected = selectedOutcome === i;
            return (
              <button
                key={label}
                onClick={() => setSelectedOutcome(i as 0 | 1)}
                disabled={isLoading}
                className={`rounded-xl p-3 border text-left transition-colors
                  ${isSelected
                    ? 'border-indigo-500 bg-indigo-600/20'
                    : 'border-white/10 hover:border-white/30'
                  }
                  ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <p className={`font-semibold text-sm ${isSelected ? 'text-indigo-300' : 'text-white'}`}>
                  {label}
                </p>
                {prob !== null && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {prob.toFixed(1)}% chance
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-gray-400 text-xs">Amount (USDC)</p>
          <p className="text-gray-400 text-xs">
            Balance: <span className="text-white">{balanceFormatted} USDC</span>
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
          <input
            type="number"
            min="1"
            step="1"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={isLoading}
            className="flex-1 bg-transparent text-white text-sm outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            placeholder="10"
          />
          <span className="text-gray-400 text-xs font-medium">USDC</span>
        </div>
      </div>

      {/* Get test USDC button */}
      <button
        onClick={handleMint}
        disabled={isLoading || !parsedAmount}
        className="w-full mb-3 py-2 rounded-xl border border-indigo-500/50 text-indigo-400 text-sm font-medium
          hover:bg-indigo-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {step === 'minting' && (
          <span className="w-3 h-3 border border-indigo-400 border-t-transparent rounded-full animate-spin" />
        )}
        Get Test USDC
      </button>

      {/* Buy button */}
      <button
        onClick={handleBuy}
        disabled={isLoading || !parsedAmount}
        className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold
          transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {(step === 'approving' || step === 'buying') && (
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        )}
        {step === 'approving' ? 'Approving…' : step === 'buying' ? 'Buying…' : `Buy ${SEEDED_MARKET.outcomeLabels[selectedOutcome]}`}
      </button>

      {/* Status messages */}
      {step === 'success' && (
        <div className="mt-4 rounded-xl bg-green-500/10 border border-green-500/30 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-icons text-green-400 text-base">check_circle</span>
            <p className="text-green-400 text-sm font-semibold">Buy confirmed!</p>
          </div>
          <p className="text-gray-400 text-xs">
            Outcome: <span className="text-white">{SEEDED_MARKET.outcomeLabels[selectedOutcome]}</span>
          </p>
          {successTxHash && (
            <p className="text-gray-500 text-xs mt-1 truncate">
              tx: {successTxHash.slice(0, 20)}…
            </p>
          )}
          <button
            onClick={() => { setStep('idle'); setSuccessTxHash(''); setSharesReceived(null); }}
            className="mt-2 text-indigo-400 text-xs hover:underline"
          >
            Place another bet
          </button>
        </div>
      )}

      {step === 'error' && errorMsg && (
        <div className="mt-4 rounded-xl bg-red-500/10 border border-red-500/30 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-icons text-red-400 text-base">error</span>
            <p className="text-red-400 text-sm font-semibold">Transaction failed</p>
          </div>
          <p className="text-gray-400 text-xs">{errorMsg}</p>
          <button
            onClick={() => setStep('idle')}
            className="mt-2 text-indigo-400 text-xs hover:underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
