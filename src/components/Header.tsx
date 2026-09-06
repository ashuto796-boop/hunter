import React from "react";

interface HeaderProps {
  onSync: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onSync }) => {
  return (
    <div className="bg-dark-950/80 border-b-2 border-neon-purple px-6 py-4 flex justify-between items-center">
      <h1 className="text-sm font-bold text-neon-purple uppercase tracking-wider">◆ MARKET TERMINAL</h1>
      <div className="flex gap-8 text-xs">
        <div className="flex flex-col gap-1">
          <span className="text-gray-500">24H VOL</span>
          <span className="font-bold text-white">$847M</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-gray-500">TOP GAINER</span>
          <span className="font-bold text-neon-green">+245%</span>
        </div>
      </div>
      <button onClick={onSync} className="px-3 py-2 border border-neon-purple bg-transparent text-neon-purple text-xs font-bold uppercase rounded hover:bg-neon-purple/10 transition-all">
        ◄► SYNC
      </button>
    </div>
  );
};
