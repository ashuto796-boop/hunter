import React from "react";
import { useAppStore } from "../store/appStore";

export const Portfolio: React.FC = () => {
  const { coins } = useAppStore();

  const portfolio = coins.slice(0, 4).map((coin) => ({
    ...coin,
    quantity: Math.floor(Math.random() * 1000) + 100,
    entryPrice: coin.price / (1 + coin.change / 100),
  }));

  const totalBalance = portfolio.reduce((sum, p) => sum + p.price * p.quantity, 0);
  const totalPnL = portfolio.reduce((sum, p) => sum + (p.price - p.entryPrice) * p.quantity, 0);
  const totalPnLPercent = (totalPnL / totalBalance) * 100;

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-6">PORTFOLIO</h1>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-dark-800 border-2 border-neon-purple p-6 rounded">
            <p className="text-gray-400 text-base uppercase font-bold tracking-wider">TOTAL BALANCE</p>
            <p className="text-4xl font-bold text-neon-purple mt-3">${totalBalance.toFixed(2)}</p>
          </div>
          <div className="bg-dark-800 border-2 border-neon-green p-6 rounded">
            <p className="text-gray-400 text-base uppercase font-bold tracking-wider">P&L</p>
            <p className={`text-4xl font-bold mt-3 ${totalPnL >= 0 ? "text-neon-green" : "text-neon-red"}`}>
              ${totalPnL.toFixed(2)}
            </p>
          </div>
          <div className="bg-dark-800 border-2 border-neon-blue p-6 rounded">
            <p className="text-gray-400 text-base uppercase font-bold tracking-wider">P&L %</p>
            <p className={`text-4xl font-bold mt-3 ${totalPnLPercent >= 0 ? "text-neon-green" : "text-neon-red"}`}>
              {totalPnLPercent > 0 ? "+" : ""}{totalPnLPercent.toFixed(2)}%
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {portfolio.map((position) => {
          const pnl = (position.price - position.entryPrice) * position.quantity;
          const pnlPercent = ((position.price - position.entryPrice) / position.entryPrice) * 100;

          return (
            <div key={position.symbol} className="bg-dark-800 border-2 border-dark-700 rounded p-6 hover:border-neon-purple transition cursor-pointer">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-white">{position.symbol}</h3>
                  <p className="text-gray-400 text-base mt-2">Quantity: <span className="text-neon-purple font-bold">{position.quantity}</span></p>
                </div>

                <div className="text-right space-y-2">
                  <div>
                    <p className="text-gray-400 text-base">Current Price</p>
                    <p className="text-2xl font-bold text-neon-green">${position.price.toFixed(8)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-base">Entry Price</p>
                    <p className="text-xl font-bold text-gray-400">${position.entryPrice.toFixed(8)}</p>
                  </div>
                </div>

                <div className={`ml-8 p-4 rounded border-l-4 ${pnl >= 0 ? "bg-neon-green/10 border-neon-green" : "bg-neon-red/10 border-neon-red"}`}>
                  <p className="text-gray-400 text-sm uppercase font-bold">P&L</p>
                  <p className={`text-2xl font-bold mt-2 ${pnl >= 0 ? "text-neon-green" : "text-neon-red"}`}>
                    ${pnl.toFixed(2)}
                  </p>
                  <p className={`text-base font-bold mt-1 ${pnl >= 0 ? "text-neon-green" : "text-neon-red"}`}>
                    {pnlPercent > 0 ? "+" : ""}{pnlPercent.toFixed(2)}%
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
