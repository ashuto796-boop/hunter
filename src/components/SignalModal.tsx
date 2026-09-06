import React from "react";
import { Signal } from "../types/index";
import { useAppStore } from "../store/appStore";

interface SignalModalProps {
  signal: Signal | null;
  isOpen: boolean;
}

export const SignalModal: React.FC<SignalModalProps> = ({ signal, isOpen }) => {
  const { closeModal } = useAppStore();

  if (!isOpen || !signal) return null;

  const bgColor = signal.type === "BUY" ? "bg-neon-green/10" : signal.type === "SELL" ? "bg-neon-red/10" : "bg-neon-yellow/10";
  const borderColor = signal.type === "BUY" ? "border-neon-green" : signal.type === "SELL" ? "border-neon-red" : "border-neon-yellow";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={closeModal}>
      <div className={`${bgColor} border-l-4 ${borderColor} rounded-lg p-8 max-w-2xl w-full mx-4`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white">{signal.title}</h2>
            <p className="text-gray-400 text-sm mt-2">{signal.message}</p>
          </div>
          <button onClick={closeModal} className="text-2xl text-gray-400 hover:text-white transition">✕</button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-dark-800/50 p-4 rounded">
            <p className="text-gray-500 text-xs">SIGNAL TYPE</p>
            <p className="text-lg font-bold text-white">{signal.type}</p>
          </div>
          <div className="bg-dark-800/50 p-4 rounded">
            <p className="text-gray-500 text-xs">SCORE</p>
            <p className="text-lg font-bold text-neon-green">{signal.score}/100</p>
          </div>
          <div className="bg-dark-800/50 p-4 rounded">
            <p className="text-gray-500 text-xs">COIN</p>
            <p className="text-lg font-bold text-neon-purple">{signal.coinSymbol}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button className="flex-1 py-3 bg-neon-green text-dark-900 font-bold rounded hover:bg-neon-green/90 transition">
            EXECUTE TRADE
          </button>
          <button className="flex-1 py-3 border border-neon-purple text-neon-purple font-bold rounded hover:bg-neon-purple/10 transition">
            ADD TO WATCHLIST
          </button>
        </div>
      </div>
    </div>
  );
};
