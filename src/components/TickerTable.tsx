import React from "react";
import { Coin } from "../types/index";
import { useAppStore } from "../store/appStore";

interface TickerTableProps {
  coins: Coin[];
}

export const TickerTable: React.FC<TickerTableProps> = ({ coins }) => {
  const { openCoinModal, selectedCoin } = useAppStore();

  return (
    <div className="space-y-2">
      {coins.map((coin) => (
        <div
          key={coin.id}
          onClick={() => {
            useAppStore.setState({ selectedCoin: coin });
            openCoinModal(coin);
          }}
          className={`grid grid-cols-4 gap-4 p-4 border-b-2 border-dark-700 cursor-pointer transition-all hover:bg-neon-purple/15 hover:border-neon-purple ${
            selectedCoin?.id === coin.id ? "bg-neon-purple/15 border-l-4 border-l-neon-purple" : ""
          }`}
        >
          <div className="font-bold text-neon-purple text-lg">{coin.symbol}</div>
          <div className="text-white text-lg font-bold">${coin.price.toFixed(6)}</div>
          <div className={`text-lg font-bold ${coin.change24h > 0 ? "text-neon-green" : "text-neon-red"}`}>
            {coin.change24h > 0 ? "▲" : "▼"} {Math.abs(coin.change24h)}%
          </div>
          <div className="text-gray-400 text-lg">${coin.volume24h.toFixed(1)}M</div>
        </div>
      ))}
    </div>
  );
};
