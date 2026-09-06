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
  const { activePage, modalState } = useAppStore();

  return (
    <div className="flex h-screen bg-dark-950 text-white overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />

        <div className="flex-1 overflow-hidden">
          {activePage === "market" && <Market />}
          {activePage === "portfolio" && <Portfolio />}
          {activePage === "alerts" && <Alerts />}
        </div>
      </div>

      <CoinModal />
      <SignalModal />
    </div>
  );
}

export default App;
