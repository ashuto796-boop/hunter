import React from "react";
import { mockAlerts } from "../data/mockData";
import { useAppStore } from "../store/appStore";

export const Alerts: React.FC = () => {
  const { openSignalModal } = useAppStore();

  return (
    <div className="h-full p-4 overflow-hidden">
      <div className="bg-dark-800 border border-dark-700 rounded overflow-hidden flex flex-col h-full hover:border-neon-purple transition">
        <div className="px-6 py-4 border-b border-dark-700 bg-dark-950/50">
          <h3 className="text-sm font-bold text-neon-purple uppercase">⚠ TRADE ALERTS</h3>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          {mockAlerts.map((alert) => {
            const bgColor = alert.type === "BUY" ? "bg-neon-green/10 border-l-neon-green" : alert.type === "SELL" ? "bg-neon-red/10 border-l-neon-red" : "bg-neon-yellow/10 border-l-neon-yellow";

            return (
              <div
                key={alert.id}
                onClick={() =>
                  openSignalModal({
                    id: alert.id,
                    type: alert.type as any,
                    title: alert.title,
                    message: alert.description,
                    score: 85,
                    timestamp: alert.timestamp,
                    coinSymbol: alert.coinSymbol,
                  })
                }
                className={`${bgColor} border-l-4 p-4 rounded cursor-pointer hover:shadow-glow transition`}
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-bold text-white">{alert.title}</h4>
                  <span className={`text-xs font-bold px-2 py-1 rounded ${alert.severity === "high" ? "bg-neon-red text-white" : "bg-neon-yellow text-dark-900"}`}>
                    {alert.severity.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-gray-400">{alert.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
