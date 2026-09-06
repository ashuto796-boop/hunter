import React from "react";
import { useAppStore } from "../store/appStore";

export const Sidebar: React.FC = () => {
  const { activePage, setActivePage } = useAppStore();

  return (
    <div className="w-80 bg-gradient-to-b from-dark-800 to-dark-900 border-r-2 border-neon-purple p-6 overflow-y-auto flex flex-col">
      <div className="text-2xl font-bold mb-8 text-white tracking-wider">
        <span className="text-neon-purple">§</span> HUNTER
      </div>

      <nav className="flex flex-col gap-2 mb-12">
        {[
          { key: "market", label: "◆ MARKET" },
          { key: "portfolio", label: "▪ PORTFOLIO" },
          { key: "alerts", label: "◄ ALERTS" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActivePage(key as any)}
            className={`px-4 py-3 text-left text-xs font-bold uppercase tracking-wider rounded transition-all border-l-4 ${
              activePage === key
                ? "bg-neon-purple/20 text-neon-purple/100 border-neon-purple"
                : "text-gray-400 border-transparent hover:bg-dark-700"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="space-y-6 flex-1">
        <div>
          <h3 className="text-xs font-bold text-neon-purple uppercase mb-3 tracking-wider">▔ NETWORKS</h3>
          {["Solana", "Ethereum", "Binance"].map((net) => (
            <label key={net} className="flex items-center gap-2 text-xs text-gray-400 py-2 cursor-pointer hover:text-white">
              <input type="checkbox" defaultChecked className="cursor-pointer" />
              <span>◆ {net}</span>
            </label>
          ))}
        </div>

        <div>
          <h3 className="text-xs font-bold text-neon-purple uppercase mb-3 tracking-wider">▔ ALGORITHMS</h3>
          {["Volume Score", "Liquidity Index", "Sentiment AI", "Whale Track"].map((algo) => (
            <label key={algo} className="flex items-center gap-2 text-xs text-gray-400 py-2 cursor-pointer hover:text-white">
              <input type="checkbox" defaultChecked className="cursor-pointer" />
              <span>{algo}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="pt-6 border-t border-dark-700 text-xs text-gray-500 space-y-2">
        <div>◄ 247 COINS</div>
        <div>▲ 14 ALERTS</div>
        <div className="text-neon-green mt-3">◄ MONITORING LIVE</div>
      </div>
    </div>
  );
};
