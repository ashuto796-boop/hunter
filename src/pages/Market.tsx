import React from "react";
import { TickerTable } from "../components/TickerTable";
import { CandlestickChart } from "../components/CandlestickChart";
import { SignalPanel } from "../components/SignalPanel";
import { useAppStore } from "../store/appStore";
import { mockCandleData } from "../data/mockData";

export const Market: React.FC = () => {
  const { coins, signals, selectedCoin } = useAppStore();

  return (
    <div className="grid grid-cols-4 gap-4 h-full p-4 overflow-hidden">
      <div className="col-span-2 bg-dark-800 border border-dark-700 rounded overflow-hidden flex flex-col hover:border-neon-purple transition">
        <div className="px-4 py-3 border-b border-dark-700 bg-dark-950/50">
          <h3 className="text-xs font-bold text-neon-purple uppercase">◆ LIVE TICKER</h3>
        </div>
        <div className="overflow-y-auto flex-1">
          <TickerTable coins={coins} />
        </div>
      </div>

      <div className="col-span-2 bg-dark-800 border border-dark-700 rounded overflow-hidden flex flex-col hover:border-neon-purple transition">
        <div className="px-4 py-3 border-b border-dark-700 bg-dark-950/50">
          <h3 className="text-xs font-bold text-neon-purple uppercase">◄ SIGNALS</h3>
        </div>
        <div className="overflow-y-auto flex-1 p-3">
          <SignalPanel signals={signals} />
        </div>
      </div>

      <div className="col-span-2 bg-dark-800 border border-dark-700 rounded overflow-hidden flex flex-col hover:border-neon-purple transition">
        <div className="px-4 py-3 border-b border-dark-700 bg-dark-950/50">
          <h3 className="text-xs font-bold text-neon-purple uppercase">◈ {selectedCoin?.symbol || "MOON"}/USD - 5M</h3>
        </div>
        <div className="overflow-hidden flex-1">
          <CandlestickChart data={mockCandleData} />
        </div>
      </div>

      <div className="col-span-2 bg-dark-800 border border-dark-700 rounded overflow-hidden hover:border-neon-purple transition">
        <div className="px-4 py-3 border-b border-dark-700 bg-dark-950/50">
          <h3 className="text-xs font-bold text-neon-purple uppercase">◈ TECHNICAL</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          {[
            { label: "RSI", value: "78" },
            { label: "MACD", value: "+" },
            { label: "BB", value: "24%" },
            { label: "ATR", value: "0.0005" },
          ].map((metric) => (
            <div key={metric.label} className="bg-dark-900 p-3 rounded border border-dark-700 cursor-pointer hover:border-neon-purple transition">
              <p className="text-xs text-gray-500">{metric.label}</p>
              <p className="text-lg font-bold text-white">{metric.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
