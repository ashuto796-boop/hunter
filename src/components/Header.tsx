import React from "react";
import { useAppStore } from "../store/appStore";

export const Header: React.FC = () => {
  const { coins } = useAppStore();

  const totalVolume = coins.reduce((sum, c) => sum + c.volume, 0);
  const portfolioValue = coins.reduce((sum, c) => sum + c.price * 100, 0);

  return (
    <div className="bg-gradient-to-r from-dark-800 to-dark-900 border-b-4 border-neon-purple px-8 py-5 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="text-4xl font-bold text-neon-purple">◈</div>
        <div>
          <h1 className="text-3xl font-bold text-white">MEMECOIN HUNTER</h1>
          <p className="text-gray-500 text-lg mt-1">Real-Time Solana/Ethereum Sentiment Analysis</p>
        </div>
      </div>

      <div className="flex gap-8">
        <div className="text-center">
          <p className="text-gray-400 text-base font-bold uppercase tracking-wider">24H VOLUME</p>
          <p className="text-2xl font-bold text-neon-green">${(totalVolume / 1e6).toFixed(1)}M</p>
        </div>
        <div className="text-center">
          <p className="text-gray-400 text-base font-bold uppercase tracking-wider">PORTFOLIO</p>
          <p className="text-2xl font-bold text-neon-purple">${portfolioValue.toFixed(2)}</p>
        </div>
        <button className="px-6 py-3 bg-neon-purple text-dark-950 font-bold text-base rounded hover:bg-neon-purple/80 transition">
          ◄ SYNC
        </button>
      </div>
    </div>
  );
};
