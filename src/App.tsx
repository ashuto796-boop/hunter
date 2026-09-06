import React from "react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { CoinModal } from "./components/CoinModal";
import { SignalModal } from "./components/SignalModal";
import { Market } from "./pages/Market";
import { Portfolio } from "./pages/Portfolio";
import { Alerts } from "./pages/Alerts";
import { useAppStore } from "./store/appStore";

function App() {
  const { activePage, modal } = useAppStore();

  const handleSync = () => {
    console.log("Data synced!");
  };

  return (
    <div className="flex h-screen bg-dark-950 text-white overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onSync={handleSync} />

        <div className="flex-1 overflow-hidden">
          {activePage === "market" && <Market />}
          {activePage === "portfolio" && <Portfolio />}
          {activePage === "alerts" && <Alerts />}
        </div>
      </div>

      {modal.type === "coin" && <CoinModal coin={modal.data as any} isOpen={modal.isOpen} />}
      {modal.type === "signal" && <SignalModal signal={modal.data as any} isOpen={modal.isOpen} />}
    </div>
  );
}

export default App;
