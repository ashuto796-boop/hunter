import React from "react";
import { Signal } from "../types/index";
import { useAppStore } from "../store/appStore";

interface SignalPanelProps {
  signals: Signal[];
}

export const SignalPanel: React.FC<SignalPanelProps> = ({ signals }) => {
  const { openSignalModal } = useAppStore();

  return (
    <div className="space-y-3">
      {signals.map((signal) => (
        <div
          key={signal.id}
          onClick={() => openSignalModal(signal)}
          className={`p-4 rounded border-l-4 cursor-pointer transition-all hover:shadow-glow text-sm ${
            signal.type === "BUY"
              ? "bg-neon-green/15 border-neon-green"
              : signal.type === "SELL"
              ? "bg-neon-red/15 border-neon-red"
              : "bg-neon-yellow/15 border-neon-yellow"
          }`}
        >
          <div className="font-bold text-white text-base">
            ▲ {signal.title} (Score: {signal.score})
          </div>
          <div className="text-gray-400 mt-2 text-sm">{signal.message}</div>
        </div>
      ))}
    </div>
  );
};
