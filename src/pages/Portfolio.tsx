import React from "react";
import { mockPortfolio } from "../data/mockData";

export const Portfolio: React.FC = () => {
  const totalBalance = mockPortfolio.reduce((sum, p) => sum + p.value, 0) + 53.95;
  const totalPnL = mockPortfolio.reduce((sum, p) => sum + p.pnl, 0);

  return (
    <div className="h-full p-4 overflow-hidden">
      <div className="bg-dark-800 border border-dark-700 rounded overflow-hidden flex flex-col h-full hover:border-neon-purple transition">
        <div className="px-6 py-4 border-b border-dark-700 bg-dark-950/50">
          <h3 className="text-sm font-bold text-neon-purple uppercase">💼 PORTFOLIO</h3>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {mockPortfolio.map((pos) => (
            <div key={pos.symbol} className="border-l-4 border-neon-green bg-neon-green/10 p-4 rounded cursor-pointer hover:shadow-glow transition">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="text-lg font-bold text-white">{pos.symbol}</h4>
                  <p className="text-xs text-gray-400">Entry: ${pos.entryPrice.toFixed(8)}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-neon-green">+${pos.pnl.toFixed(2)}</p>
                  <p className="text-xs text-neon-green">+{pos.pnlPercent}%</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-xs text-gray-400">
                <div>
                  <p>Current</p>
                  <p className="font-bold text-white">${pos.currentPrice.toFixed(8)}</p>
                </div>
                <div>
                  <p>Quantity</p>
                  <p className="font-bold text-white">{pos.quantity.toLocaleString()}</p>
                </div>
                <div>
                  <p>Value</p>
                  <p className="font-bold text-white">${pos.value.toFixed(2)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-dark-700 bg-dark-950/50">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-gray-500 text-xs">TOTAL BALANCE</p>
              <p className="text-2xl font-bold text-white">${totalBalance.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-gray-500 text-xs">PROFIT</p>
              <p className="text-2xl font-bold text-neon-green">+${totalPnL.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
