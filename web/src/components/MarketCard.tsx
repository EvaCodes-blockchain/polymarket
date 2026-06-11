"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";

export interface MarketCardData {
  id: string;
  title: string;
  description: string;
  volume: string;
  closeTime: string;
  chancePct: number;
  thumbSrc: string;
  outcomeYes: string;
  outcomeNo: string;
  priceYes: number; // e.g. 0.38
  priceNo: number;  // e.g. 0.62
  tradeHref?: string;
}

interface MarketCardProps {
  market: MarketCardData;
}

type Side = "yes" | "no" | null;

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

export default function MarketCard({ market }: MarketCardProps) {
  const [side, setSide] = useState<Side>(null);
  const [amount, setAmount] = useState(10);

  const price = side === "yes" ? market.priceYes : market.priceNo;
  const payout = price > 0 ? amount / price : 0;
  const outcomeName = side === "yes" ? market.outcomeYes : market.outcomeNo;

  const flip = useCallback((s: Side) => {
    setSide(s);
    setAmount(10);
  }, []);

  const handleAmountChange = (val: number) => {
    setAmount(Math.max(1, Math.min(100, val)));
  };

  return (
    <div className="market-card-wrapper w-full">
      <div
        className={`market-card-inner relative transition-transform duration-500 ${
          side !== null ? "flipped" : ""
        }`}
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* FRONT */}
        <div
          className="market-card-front bg-glass rounded-2xl p-3 shadow-sm"
          style={{ backfaceVisibility: "hidden" }}
        >
          <div className="flex gap-3 mb-3">
            {/* Thumb */}
            <div className="flex-shrink-0">
              <Image
                src={market.thumbSrc}
                alt={market.title}
                width={64}
                height={64}
                className="rounded-xl object-cover"
              />
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <Link
                href={market.tradeHref ?? `/trade/${market.id}`}
                className="font-semibold text-white text-xs no-underline hover:underline line-clamp-2"
              >
                {market.title}
              </Link>
              <p className="text-gray-400 text-xs mt-1 line-clamp-1">
                {market.description}
              </p>
              <div className="flex gap-3 text-xs text-gray-500 mt-1">
                <span className="text-indigo-300">{market.volume}</span>
                <span>{market.closeTime}</span>
              </div>
            </div>
            {/* Chance arc */}
            <ChanceArc pct={market.chancePct} />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => flip("yes")}
              className="flex-1 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: "#355E3B" }}
            >
              Buy {market.outcomeYes}
            </button>
            <button
              onClick={() => flip("no")}
              className="flex-1 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: "#B1332F" }}
            >
              Buy {market.outcomeNo}
            </button>
          </div>
        </div>

        {/* BACK */}
        {side !== null && (
          <div
            className="market-card-back bg-glass rounded-2xl p-4 shadow-sm"
            style={{
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
              position: "absolute",
              inset: 0,
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-white">
                Buy <span className="text-indigo-300">{outcomeName}</span>
              </div>
              <button
                onClick={() => setSide(null)}
                className="text-gray-400 hover:text-white material-icons md-20 transition-colors"
                aria-label="Close"
              >
                close
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
                  className="w-20 bg-white/10 border border-white/10 rounded-lg px-2 py-1.5
                             text-white text-sm text-center outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => handleAmountChange(amount + 1)}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs rounded-lg transition-colors"
                >
                  +1
                </button>
                <button
                  onClick={() => handleAmountChange(amount + 10)}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs rounded-lg transition-colors"
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
              className="w-full mb-4 accent-indigo-500"
            />

            {/* Confirm button */}
            <button
              className="w-full py-3 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: side === "yes" ? "#355E3B" : "#B1332F" }}
              onClick={() => {
                /* CEO-4: trade submission wired in task #14 */
                alert(`Demo: Buy $${amount} on ${outcomeName} — to win $${payout.toFixed(2)}`);
                setSide(null);
              }}
            >
              <div>Buy {outcomeName}</div>
              <div className="text-xs font-normal opacity-80 mt-0.5">
                To win: ${payout.toFixed(2)}
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
