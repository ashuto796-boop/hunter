import React from "react";
import { useAppStore } from "../store/appStore";

export const Sidebar: React.FC = () => {
  const { activePage, setActivePage } = useAppStore();

  return (
    <div className="w-96 bg-gradient-to-b from-dark-800 to-dark-900 border-r-4 border-neon-purple p-8 overflow-y-auto flex flex-col">
      <div className="text-4xl font-bold mb-12 text-white tracking-wider">
        <span className="text-neon-purple text-5xl">§</span> HUNTER
      </div>

      <nav className="flex flex-col gap-3 mb-16">
        {[
          { key: "market", label: "◆ MARKET" },
          { key: "portfolio", label: "▪ PORTFOLIO" },
          { key: "alerts", label: "◄ ALERTS" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActivePage(key as any)}
            className={`px-6 py-4 text-left text-sm font-bold uppercase tracking-wider rounded transition-all border-l-4 ${
              activePage === key
                ? "bg-neon-purple/25 text-neon-purple/100 border-neon-purple text-base"
                : "text-gray-400 border-transparent hover:bg-dark-700 text-sm"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="space-y-8 flex-1">
        <div>
          <h3 className="text-sm font-bold text-neon-purple uppercase mb-4 tracking-wider">▔ NETWORKS</h3>
          {["Solana", "Ethereum", "Binance"].map((net) => (
            <label key={net} className="flex items-center gap-3 text-sm text-gray-400 py-3 cursor-pointer hover:text-white transition">
              <input type="checkbox" defaultChecked className="cursor-pointer w-5 h-5" />
              <span className="text-base">◆ {net}</span>
            </label>
          ))}
        </div>

        <div>
          <h3 className="text-sm font-bold text-neon-purple uppercase mb-4 tracking-wider">▔ ALGORITHMS</h3>
          {["Volume Score", "Liquidity Index", "Sentiment AI", "Whale Track"].map((algo) => (
            <label key={algo} className="flex items-center gap-3 text-sm text-gray-400 py-3 cursor-pointer hover:text-white transition">
              <input type="checkbox" defaultChecked className="cursor-pointer w-5 h-5" />
              <span className="text-base">{algo}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="pt-8 border-t-2 border-dark-700 text-sm text-gray-500 space-y-3">
        <div className="text-base font-bold">◄ 247 COINS</div>
        <div className="text-base font-bold">▲ 14 ALERTS</div>
        <div className="text-neon-green mt-4 text-base font-bold">◄ MONITORING LIVE</div>
      </div>
    </div>
  );
};
