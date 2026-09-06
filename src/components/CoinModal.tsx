import React from "react";
import { Coin } from "../types/index";
import { useAppStore } from "../store/appStore";

export const CoinModal: React.FC = () => {
  const { modalState, closeModal } = useAppStore();

  if (modalState.type !== "coin" || !modalState.data) return null;

  const coin = modalState.data as Coin;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 border-2 border-neon-purple rounded-lg p-8 max-w-md w-full shadow-2xl">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-3xl font-bold text-white">{coin.symbol}</h2>
            <p className="text-gray-400 text-lg">{coin.name}</p>
          </div>
          <button onClick={closeModal} className="text-2xl text-gray-500 hover:text-white">
            ✕
          </button>
        </div>

        <div className="space-y-5 mb-8">
          <div className="bg-dark-900 p-4 rounded border-l-4 border-neon-purple">
            <p className="text-gray-400 text-base uppercase font-bold">Price</p>
            <p className="text-3xl font-bold text-neon-purple mt-2">${coin.price.toFixed(8)}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-dark-900 p-4 rounded border-l-4 border-neon-green">
              <p className="text-gray-400 text-sm uppercase font-bold">24h Change</p>
              <p className={`text-2xl font-bold mt-2 ${coin.change >= 0 ? "text-neon-green" : "text-neon-red"}`}>
                {coin.change > 0 ? "+" : ""}{coin.change.toFixed(2)}%
              </p>
            </div>
            <div className="bg-dark-900 p-4 rounded border-l-4 border-neon-blue">
              <p className="text-gray-400 text-sm uppercase font-bold">Volume</p>
              <p className="text-2xl font-bold text-neon-blue mt-2">${(coin.volume / 1e6).toFixed(1)}M</p>
            </div>
          </div>

          <div className="bg-dark-900 p-4 rounded border-l-4 border-neon-yellow">
            <p className="text-gray-400 text-base uppercase font-bold">Sentiment Score</p>
            <p className="text-3xl font-bold text-neon-yellow mt-2">{coin.sentiment}/100</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button className="flex-1 px-6 py-3 bg-neon-green text-dark-950 font-bold text-base rounded hover:bg-neon-green/80 transition">
            ◄ BUY
          </button>
          <a
            href={`https://dexscreener.com/solana/${coin.symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 px-6 py-3 bg-neon-purple text-dark-950 font-bold text-base rounded hover:bg-neon-purple/80 transition text-center"
          >
            → DEXSCREENER
          </a>
        </div>
      </div>
    </div>
  );
};
