'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { MarketDTO } from '@/lib/client/api';
import { formatCloseTime, formatVolume } from '@/lib/client/api';
import { useBuyMarket } from '@/lib/client/useBuyMarket';

interface MarketCardProps {
  market: MarketDTO;
}

type Side = 'yes' | 'no' | null;

const FALLBACK_IMAGE = '/img/trend1.jpg';

function ChanceArc({ pct }: { pct: number }) {
  // SVG circle circumference for r=15.9155 is 100
  const dashArray = `${pct}, 100`;
  return (
    <div className="flex flex-col items-center">
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
 * MarketCard — embedded feed card with flip-to-trade (FR-CARD-1..3, CEO-4).
 *
 * Front: prototype card (thumb, question, volume, close time, chance arc,
 * Buy Yes/No buttons with live cent prices). Flipping reveals the trade form
 * which places a REAL on-chain bet via useBuyMarket (approve + AMM.buy).
 */
export default function MarketCard({ market }: MarketCardProps) {
  const [side, setSide] = useState<Side>(null);
  const [amount, setAmount] = useState(10);

  const {
    step,
    error,
    txHash,
    usdcBalanceFormatted,
    priceYes,
    priceNo,
    isConnected,
    isBusy,
    buy,
    getTestUsdc,
    reset,
  } = useBuyMarket(market);

  const tradeHref = `/trade/${market.id}`;
  const price = side === 'yes' ? priceYes : priceNo;
  const payout = price > 0 ? amount / price : 0;
  const outcomeName = side === 'yes' ? market.outcomeYes : market.outcomeNo;
  const outcomeIndex: 0 | 1 = side === 'yes' ? 0 : 1;

  const flip = useCallback(
    (s: Side) => {
      setSide(s);
      setAmount(10);
      reset();
    },
    [reset],
  );

  const closeBack = useCallback(() => {
    setSide(null);
    reset();
  }, [reset]);

  const handleAmountChange = (val: number) => {
    setAmount(Math.max(1, Math.min(100, val)));
  };

  const handleBuy = async () => {
    if (side === null || isBusy) return;
    await buy(outcomeIndex, String(amount));
  };

  const flipped = side !== null;

  return (
    <div className="market-card-wrapper w-full" data-testid="market-card">
      <div
        className={`market-card-inner relative transition-transform duration-500 ${
          flipped ? 'flipped' : ''
        }`}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* FRONT */}
        <div
          className="market-card-front bg-glass rounded-2xl p-3 shadow-sm"
          style={
            flipped
              ? { backfaceVisibility: 'hidden', position: 'absolute', inset: 0 }
              : { backfaceVisibility: 'hidden' }
          }
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
              <Link
                href={tradeHref}
                className="font-semibold text-white text-xs no-underline hover:underline line-clamp-2"
                data-testid="market-card-title"
              >
                {market.question}
              </Link>
              <p className="text-gray-400 text-xs mt-1 line-clamp-1">
                {market.description}
              </p>
              <div className="flex gap-3 text-xs text-gray-500 mt-1">
                <span className="text-indigo-300">{formatVolume(market.volumeUsdc)}</span>
                <span>{formatCloseTime(market.closeTime)}</span>
              </div>
            </div>
            {/* Chance arc */}
            <ChanceArc pct={market.chancePct} />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => flip('yes')}
              className="flex-1 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: '#355E3B' }}
              data-testid="market-card-buy-yes"
            >
              Buy {market.outcomeYes} {Math.round(priceYes * 100)}¢
            </button>
            <button
              onClick={() => flip('no')}
              className="flex-1 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: '#B1332F' }}
              data-testid="market-card-buy-no"
            >
              Buy {market.outcomeNo} {Math.round(priceNo * 100)}¢
            </button>
          </div>
        </div>

        {/* BACK */}
        {flipped && (
          <div
            className="market-card-back bg-glass rounded-2xl p-4 shadow-sm"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              // In flow while flipped so the card grows with the trade form
              position: 'relative',
              inset: 'auto',
            }}
            data-testid="market-card-back"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-white">
                Buy <span className="text-indigo-300">{outcomeName}</span>{' '}
                <span className="text-gray-400 font-normal text-xs">
                  @ {Math.round(price * 100)}¢
                </span>
              </div>
              <button
                onClick={closeBack}
                className="text-gray-400 hover:text-white material-icons md-20 transition-colors"
                aria-label="Close"
                data-testid="market-card-close"
              >
                close
              </button>
            </div>

            {!isConnected ? (
              /* Connect-wallet prompt */
              <div className="text-center py-3" data-testid="market-card-connect">
                <span className="material-icons text-indigo-400 text-3xl mb-2 block">
                  account_balance_wallet
                </span>
                <p className="text-gray-300 text-xs mb-3">
                  Connect MetaMask to place a bet
                </p>
                <button
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent('justify:connectWallet'))
                  }
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2 rounded-full transition-colors"
                >
                  Connect Wallet
                </button>
              </div>
            ) : step === 'success' ? (
              /* Success state */
              <div
                className="rounded-xl bg-green-500/10 border border-green-500/30 p-3"
                data-testid="market-card-success"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-icons text-green-400 text-base">
                    check_circle
                  </span>
                  <p className="text-green-400 text-sm font-semibold">Buy confirmed!</p>
                </div>
                <p className="text-gray-400 text-xs">
                  Outcome: <span className="text-white">{outcomeName}</span>
                </p>
                {txHash && (
                  <p className="text-gray-500 text-xs mt-1 truncate">
                    tx: {txHash.slice(0, 20)}…
                  </p>
                )}
                <div className="flex gap-3 mt-2">
                  <button
                    onClick={() => reset()}
                    className="text-indigo-400 text-xs hover:underline"
                  >
                    Place another bet
                  </button>
                  <button
                    onClick={closeBack}
                    className="text-gray-400 text-xs hover:underline"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Balance + faucet row */}
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-400">
                    Balance: <span className="text-white">{usdcBalanceFormatted} USDC</span>
                  </p>
                  <button
                    onClick={() => void getTestUsdc(String(amount))}
                    disabled={isBusy}
                    className="text-indigo-400 text-xs font-medium hover:underline disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                    data-testid="market-card-faucet"
                  >
                    {step === 'faucet' && (
                      <span className="w-3 h-3 border border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    )}
                    Get Test USDC
                  </button>
                </div>

                {/* Amount input row */}
                <div className="mb-3">
                  <label className="text-xs text-gray-400 mb-1 block">Amount</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={amount}
                      onChange={(e) =>
                        handleAmountChange(parseInt(e.target.value, 10) || 1)
                      }
                      disabled={isBusy}
                      className="w-20 bg-white/10 border border-white/10 rounded-lg px-2 py-1.5
                                 text-white text-sm text-center outline-none focus:border-indigo-500"
                      data-testid="market-card-amount"
                    />
                    <button
                      onClick={() => handleAmountChange(amount + 1)}
                      disabled={isBusy}
                      className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                    >
                      +1
                    </button>
                    <button
                      onClick={() => handleAmountChange(amount + 10)}
                      disabled={isBusy}
                      className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                    >
                      +10
                    </button>
                  </div>
                </div>

                {/* Slider */}
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={amount}
                  onChange={(e) => handleAmountChange(parseInt(e.target.value, 10))}
                  disabled={isBusy}
                  className="w-full mb-4 accent-indigo-500"
                  data-testid="market-card-slider"
                />

                {/* Confirm button — real approve + buy on this market's AMM */}
                <button
                  className="w-full py-3 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: side === 'yes' ? '#355E3B' : '#B1332F' }}
                  onClick={() => void handleBuy()}
                  disabled={isBusy}
                  data-testid="market-card-confirm"
                >
                  <div className="flex items-center justify-center gap-2">
                    {(step === 'approving' || step === 'buying') && (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    {step === 'approving'
                      ? 'Approving…'
                      : step === 'buying'
                        ? 'Buying…'
                        : `Buy ${outcomeName}`}
                  </div>
                  <div className="text-xs font-normal opacity-80 mt-0.5">
                    To win: ${payout.toFixed(2)}
                  </div>
                </button>

                {/* Error */}
                {step === 'error' && error && (
                  <div
                    className="mt-3 rounded-xl bg-red-500/10 border border-red-500/30 p-2"
                    data-testid="market-card-error"
                  >
                    <p className="text-red-400 text-xs">{error}</p>
                    <button
                      onClick={() => reset()}
                      className="mt-1 text-indigo-400 text-xs hover:underline"
                    >
                      Try again
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
