import React from "react";
import { Signal } from "../types/index";
import { useAppStore } from "../store/appStore";

interface SignalPanelProps {
  signals: Signal[];
}

export const SignalPanel: React.FC<SignalPanelProps> = ({ signals }) => {
  const { openSignalModal } = useAppStore();

  return (
    <div className="space-y-2">
      {signals.map((signal) => (
        <div
          key={signal.id}
          onClick={() => openSignalModal(signal)}
          className={`p-3 rounded border-l-4 cursor-pointer transition-all hover:shadow-glow ${
            signal.type === "BUY"
              ? "bg-neon-green/10 border-neon-green"
              : signal.type === "SELL"
              ? "bg-neon-red/10 border-neon-red"
              : "bg-neon-yellow/10 border-neon-yellow"
          }`}
        >
          <div className="font-bold text-sm text-white">▲ {signal.title} (Score: {signal.score})</div>
          <div className="text-xs text-gray-400 mt-1">{signal.message}</div>
        </div>
      ))}
    </div>
  );
};
