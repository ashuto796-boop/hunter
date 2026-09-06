import React from "react";
import { TickerTable } from "../components/TickerTable";
import { CandlestickChart } from "../components/CandlestickChart";
import { SignalPanel } from "../components/SignalPanel";
import { useAppStore } from "../store/appStore";
import { mockCandleData } from "../data/mockData";

export const Market: React.FC = () => {
  const { coins, signals, selectedCoin } = useAppStore();

  return (
    <div className="grid grid-cols-4 gap-3 h-full p-4 overflow-hidden">
      {/* TICKER */}
      <div className="col-span-2 bg-dark-800 border-2 border-dark-700 rounded overflow-hidden flex flex-col hover:border-neon-purple transition">
        <div className="px-4 py-3 border-b-2 border-dark-700 bg-dark-950/50">
          <h3 className="text-base font-bold text-neon-purple uppercase tracking-wider">◆ LIVE TICKER</h3>
        </div>
        <div className="overflow-y-auto flex-1">
          <TickerTable coins={coins} />
        </div>
      </div>

      {/* SIGNALS */}
      <div className="col-span-2 bg-dark-800 border-2 border-dark-700 rounded overflow-hidden flex flex-col hover:border-neon-purple transition">
        <div className="px-4 py-3 border-b-2 border-dark-700 bg-dark-950/50">
          <h3 className="text-base font-bold text-neon-purple uppercase tracking-wider">◄ SIGNALS</h3>
        </div>
        <div className="overflow-y-auto flex-1 p-3">
          <SignalPanel signals={signals} />
        </div>
      </div>

      {/* CANDLESTICK */}
      <div className="col-span-2 bg-dark-800 border-2 border-dark-700 rounded overflow-hidden flex flex-col hover:border-neon-purple transition">
        <div className="px-4 py-3 border-b-2 border-dark-700 bg-dark-950/50">
          <h3 className="text-base font-bold text-neon-purple uppercase tracking-wider">◈ {selectedCoin?.symbol || "MOON"}/USD - 5M</h3>
        </div>
        <div className="overflow-hidden flex-1">
          <CandlestickChart data={mockCandleData} />
        </div>
      </div>

      {/* TECHNICAL */}
      <div className="col-span-2 bg-dark-800 border-2 border-dark-700 rounded overflow-hidden hover:border-neon-purple transition">
        <div className="px-4 py-3 border-b-2 border-dark-700 bg-dark-950/50">
          <h3 className="text-base font-bold text-neon-purple uppercase tracking-wider">◈ TECHNICAL</h3>
        </div>
        <div className="p-3 grid grid-cols-2 gap-3">
          {[
            { label: "RSI", value: "78" },
            { label: "MACD", value: "+" },
            { label: "BB", value: "24%" },
            { label: "ATR", value: "0.0005" },
          ].map((metric) => (
            <div key={metric.label} className="bg-dark-900 p-3 rounded border-2 border-dark-700 cursor-pointer hover:border-neon-purple transition">
              <p className="text-sm text-gray-500 font-bold">{metric.label}</p>
              <p className="text-lg font-bold text-white mt-1">{metric.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* MOMENTUM */}
      <div className="col-span-2 bg-dark-800 border-2 border-dark-700 rounded overflow-hidden hover:border-neon-purple transition">
        <div className="px-4 py-3 border-b-2 border-dark-700 bg-dark-950/50">
          <h3 className="text-base font-bold text-neon-purple uppercase tracking-wider">🔥 MOMENTUM</h3>
        </div>
        <div className="p-3 space-y-3 overflow-y-auto flex-1">
          <div className="p-3 bg-neon-green/10 border-l-4 border-neon-green rounded">
            <p className="font-bold text-white text-base">▲ MOON +245%</p>
            <p className="text-gray-400 text-sm mt-1">Strong Buy</p>
          </div>
          <div className="p-3 bg-neon-green/10 border-l-4 border-neon-green rounded">
            <p className="font-bold text-white text-base">▲ WIF +156%</p>
            <p className="text-gray-400 text-sm mt-1">Accumulating</p>
          </div>
          <div className="p-3 bg-neon-yellow/10 border-l-4 border-neon-yellow rounded">
            <p className="font-bold text-white text-base">◄ PEPE +95%</p>
            <p className="text-gray-400 text-sm mt-1">Mixed</p>
          </div>
        </div>
      </div>

      {/* INTEGRATED PLATFORMS */}
      <div className="col-span-4 bg-dark-800 border-2 border-dark-700 rounded overflow-hidden hover:border-neon-purple transition">
        <div className="px-4 py-3 border-b-2 border-dark-700 bg-dark-950/50">
          <h3 className="text-base font-bold text-neon-purple uppercase tracking-wider">◄ INTEGRATED PLATFORMS</h3>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div><span className="text-neon-purple font-bold text-base">DEXSCREENER:</span> <span className="text-gray-300">MOON $847.2M Vol | Liquidity $12.4M</span></div>
          <div><span className="text-neon-purple font-bold text-base">TWITTER:</span> <span className="text-gray-300">2.4K mentions | 78% bullish sentiment</span></div>
          <div><span className="text-neon-purple font-bold text-base">AXIOM:</span> <span className="text-gray-300">Score 92/100 | High Signal Quality</span></div>
        </div>
      </div>

      {/* TWITTER SENTIMENT */}
      <div className="col-span-4 bg-dark-800 border-2 border-dark-700 rounded overflow-hidden hover:border-neon-purple transition">
        <div className="px-4 py-3 border-b-2 border-dark-700 bg-dark-950/50">
          <h3 className="text-base font-bold text-neon-purple uppercase tracking-wider">◈ TWITTER SENTIMENT ANALYSIS</h3>
        </div>
        <div className="p-4 space-y-2 overflow-y-auto flex-1 text-sm max-h-24">
          <div className="text-neon-green">◄ @cryptobull: MOON is the next 100x! Accumulating heavy</div>
          <div className="text-neon-green">◄ @web3analyst: Technical setup looks bullish, RSI at 78</div>
          <div className="text-neon-red">▼ @bearishTim: PEPE dump incoming, volume decreasing</div>
          <div className="text-neon-yellow">⚠ Sentiment: 78% Bullish | Engagement: Very High</div>
        </div>
      </div>
    </div>
  );
};
