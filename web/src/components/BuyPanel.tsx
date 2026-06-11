'use client';

import { useState } from 'react';
import type { MarketDTO } from '@/lib/client/api';
import { parseUsdcAmount, useBuyMarket } from '@/lib/client/useBuyMarket';

interface BuyPanelProps {
  market: MarketDTO;
  /** Called after a successful buy so parent can refresh position */
  onBuySuccess?: (outcomeIndex: 0 | 1, txHash: `0x${string}`) => void;
}

/**
 * BuyPanel — CEO-4 trade entry UI, parametric over any market from the API.
 *
 * Flow (via useBuyMarket):
 *   1. User picks outcome (market.outcomeYes / market.outcomeNo)
 *   2. User enters USDC amount
 *   3. "Get Test USDC" → POST /api/faucet (server deployer mints — direct
 *      MockUSDC.mint is onlyOwner and reverts for users)
 *   4. "Buy" → approve market.addresses.amm, then AMM.buy(outcome, amount, 0)
 *   5. Show txHash
 */
export default function BuyPanel({ market, onBuySuccess }: BuyPanelProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<0 | 1>(0);
  const [amountStr, setAmountStr] = useState('10');

  const {
    step,
    error,
    txHash,
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
  } = useBuyMarket(market);

  const outcomeLabels: [string, string] = [market.outcomeYes, market.outcomeNo];
  const parsedAmount = parseUsdcAmount(amountStr);

  const handleBuy = async () => {
    const hash = await buy(selectedOutcome, amountStr);
    if (hash) onBuySuccess?.(selectedOutcome, hash);
  };

  if (!isConnected || !address) {
    return (
      <div className="bg-glass rounded-2xl p-6 text-center" data-testid="buy-panel-connect">
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

  if (!isOnGanache) {
    return (
      <div className="bg-glass rounded-2xl p-6 text-center" data-testid="buy-panel-wrong-chain">
        <span className="material-icons text-yellow-400 text-4xl mb-3 block">warning</span>
        <p className="text-gray-300 text-sm mb-3">Wrong network — switch to Ganache (1337)</p>
        <button
          onClick={switchToGanache}
          className="bg-yellow-500 hover:bg-yellow-600 text-black text-sm font-semibold px-4 py-2 rounded-full transition-colors"
        >
          Switch to Ganache
        </button>
      </div>
    );
  }

  return (
    <div className="bg-glass rounded-2xl p-5 shadow-sm" data-testid="buy-panel">
      <h3 className="text-white font-bold text-sm mb-4">Place a Bet</h3>

      {/* Outcome selector */}
      <div className="mb-4">
        <p className="text-gray-400 text-xs mb-2">Pick your outcome</p>
        <div className="grid grid-cols-2 gap-2">
          {outcomeLabels.map((label, i) => {
            const price = i === 0 ? priceYes : priceNo;
            const isSelected = selectedOutcome === i;
            return (
              <button
                key={`${label}-${i}`}
                onClick={() => setSelectedOutcome(i as 0 | 1)}
                disabled={isBusy}
                data-testid={`buy-panel-outcome-${i}`}
                className={`rounded-xl p-3 border text-left transition-colors
                  ${isSelected
                    ? 'border-indigo-500 bg-indigo-600/20'
                    : 'border-white/10 hover:border-white/30'
                  }
                  ${isBusy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <p className={`font-semibold text-sm ${isSelected ? 'text-indigo-300' : 'text-white'}`}>
                  {label}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {(price * 100).toFixed(1)}% chance
                </p>
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
            Balance: <span className="text-white">{usdcBalanceFormatted} USDC</span>
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
          <input
            type="number"
            min="1"
            step="1"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={isBusy}
            data-testid="buy-panel-amount"
            className="flex-1 bg-transparent text-white text-sm outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            placeholder="10"
          />
          <span className="text-gray-400 text-xs font-medium">USDC</span>
        </div>
      </div>

      {/* Get test USDC button — server faucet (deployer mints) */}
      <button
        onClick={() => void getTestUsdc(amountStr)}
        disabled={isBusy || !parsedAmount}
        data-testid="buy-panel-faucet"
        className="w-full mb-3 py-2 rounded-xl border border-indigo-500/50 text-indigo-400 text-sm font-medium
          hover:bg-indigo-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {step === 'faucet' && (
          <span className="w-3 h-3 border border-indigo-400 border-t-transparent rounded-full animate-spin" />
        )}
        Get Test USDC
      </button>

      {/* Buy button */}
      <button
        onClick={() => void handleBuy()}
        disabled={isBusy || !parsedAmount}
        data-testid="buy-panel-buy"
        className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold
          transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {(step === 'approving' || step === 'buying') && (
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        )}
        {step === 'approving' ? 'Approving…' : step === 'buying' ? 'Buying…' : `Buy ${outcomeLabels[selectedOutcome]}`}
      </button>

      {/* Status messages */}
      {step === 'success' && (
        <div className="mt-4 rounded-xl bg-green-500/10 border border-green-500/30 p-3" data-testid="buy-panel-success">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-icons text-green-400 text-base">check_circle</span>
            <p className="text-green-400 text-sm font-semibold">Buy confirmed!</p>
          </div>
          <p className="text-gray-400 text-xs">
            Outcome: <span className="text-white">{outcomeLabels[selectedOutcome]}</span>
          </p>
          {txHash && (
            <p className="text-gray-500 text-xs mt-1 truncate">
              tx: {txHash.slice(0, 20)}…
            </p>
          )}
          <button
            onClick={() => reset()}
            className="mt-2 text-indigo-400 text-xs hover:underline"
          >
            Place another bet
          </button>
        </div>
      )}

      {step === 'error' && error && (
        <div className="mt-4 rounded-xl bg-red-500/10 border border-red-500/30 p-3" data-testid="buy-panel-error">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-icons text-red-400 text-base">error</span>
            <p className="text-red-400 text-sm font-semibold">Transaction failed</p>
          </div>
          <p className="text-gray-400 text-xs">{error}</p>
          <button
            onClick={() => reset()}
            className="mt-2 text-indigo-400 text-xs hover:underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
