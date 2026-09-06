import React from "react";
import { useAppStore } from "../store/appStore";

export const Alerts: React.FC = () => {
  const { alerts } = useAppStore();

  return (
    <div className="p-6 h-full overflow-y-auto">
      <h1 className="text-4xl font-bold text-white mb-8">ALERTS & SIGNALS</h1>

      <div className="space-y-4">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`border-l-4 p-6 rounded cursor-pointer transition-all hover:shadow-glow ${
              alert.type === "SIGNAL"
                ? "bg-neon-green/10 border-neon-green"
                : alert.type === "PUMP"
                ? "bg-neon-yellow/10 border-neon-yellow"
                : "bg-neon-red/10 border-neon-red"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-white">{alert.coin}</h3>
                <p className="text-gray-400 text-base mt-2">{alert.message}</p>
              </div>

              <div className="flex items-center gap-8">
                <div>
                  <p className="text-gray-400 text-sm uppercase font-bold">Severity</p>
                  <div className="mt-2">
                    <span className={`px-4 py-2 rounded font-bold text-base ${
                      alert.severity === "HIGH"
                        ? "bg-neon-red text-dark-950"
                        : "bg-neon-yellow text-dark-950"
                    }`}>
                      {alert.severity}
                    </span>
                  </div>
                </div>

                <div>
                  <p className="text-gray-400 text-sm uppercase font-bold">Type</p>
                  <p className="text-xl font-bold text-neon-purple mt-2 uppercase">{alert.type}</p>
                </div>

                <div>
                  <p className="text-gray-400 text-sm uppercase font-bold">Time</p>
                  <p className="text-lg font-bold text-gray-400 mt-2">{alert.timestamp}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
