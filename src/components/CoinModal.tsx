import React from "react";
import { Coin } from "../types/index";
import { useAppStore } from "../store/appStore";

interface CoinModalProps {
  coin: Coin | null;
  isOpen: boolean;
}

export const CoinModal: React.FC<CoinModalProps> = ({ coin, isOpen }) => {
  const { closeModal } = useAppStore();

  if (!isOpen || !coin) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={closeModal}>
      <div className="bg-dark-800 border border-neon-purple rounded-lg p-8 max-w-2xl w-full mx-4 max-h-96 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white">{coin.symbol}</h2>
            <p className="text-gray-400 text-sm">{coin.name}</p>
          </div>
          <button onClick={closeModal} className="text-2xl text-gray-400 hover:text-white transition">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <p className="text-gray-500 text-xs">PRICE</p>
            <p className="text-2xl font-bold text-white">${coin.price.toFixed(8)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">24H CHANGE</p>
            <p className={`text-2xl font-bold ${coin.change24h > 0 ? "text-neon-green" : "text-neon-red"}`}>
              {coin.change24h > 0 ? "+" : ""}{coin.change24h}%
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">VOLUME</p>
            <p className="text-lg font-bold text-white">${coin.volume24h}M</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">SENTIMENT</p>
            <p className="text-lg font-bold text-neon-green">{coin.sentiment}%</p>
          </div>
        </div>

        <div className="space-y-3">
          <button className="w-full py-3 bg-neon-green text-dark-900 font-bold rounded hover:bg-neon-green/90 transition">
            BUY {coin.symbol}
          </button>
          <button className="w-full py-3 border border-neon-purple text-neon-purple font-bold rounded hover:bg-neon-purple/10 transition">
            VIEW ON DEXSCREENER
          </button>
        </div>
      </div>
    </div>
  );
};
