import React from "react";
import { Signal } from "../types/index";
import { useAppStore } from "../store/appStore";

export const SignalModal: React.FC = () => {
  const { modalState, closeModal } = useAppStore();

  if (modalState.type !== "signal" || !modalState.data) return null;

  const signal = modalState.data as Signal;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 border-2 border-neon-purple rounded-lg p-8 max-w-md w-full shadow-2xl">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-3xl font-bold text-white">{signal.title}</h2>
            <p className="text-lg text-gray-400 mt-2">{signal.coin}</p>
          </div>
          <button onClick={closeModal} className="text-2xl text-gray-500 hover:text-white">
            ✕
          </button>
        </div>

        <div className="space-y-5 mb-8">
          <div className={`p-4 rounded border-l-4 ${
            signal.type === "BUY"
              ? "bg-neon-green/10 border-neon-green"
              : signal.type === "SELL"
              ? "bg-neon-red/10 border-neon-red"
              : "bg-neon-yellow/10 border-neon-yellow"
          }`}>
            <p className="text-gray-400 text-base uppercase font-bold">Signal Type</p>
            <p className={`text-3xl font-bold mt-2 ${
              signal.type === "BUY"
                ? "text-neon-green"
                : signal.type === "SELL"
                ? "text-neon-red"
                : "text-neon-yellow"
            }`}>
              {signal.type}
            </p>
          </div>

          <div className="bg-dark-900 p-4 rounded border-l-4 border-neon-blue">
            <p className="text-gray-400 text-base uppercase font-bold">Confidence Score</p>
            <p className="text-3xl font-bold text-neon-blue mt-2">{signal.score}/100</p>
          </div>

          <div className="bg-dark-900 p-4 rounded border-l-4 border-neon-purple">
            <p className="text-gray-400 text-base uppercase font-bold">Analysis</p>
            <p className="text-gray-300 text-base mt-2">{signal.message}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button className="flex-1 px-6 py-3 bg-neon-purple text-dark-950 font-bold text-base rounded hover:bg-neon-purple/80 transition">
            ◄ EXECUTE TRADE
          </button>
          <button className="flex-1 px-6 py-3 bg-dark-700 text-neon-purple font-bold text-base rounded border-2 border-neon-purple hover:bg-dark-600 transition">
            ◄ WATCHLIST
          </button>
        </div>
      </div>
    </div>
  );
};
