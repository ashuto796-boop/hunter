import { create } from "zustand";
import { Coin, Signal, ModalState, Alert } from "../types/index";
import { mockCoins, mockSignals, mockAlerts } from "../data/mockData";

interface AppState {
  coins: Coin[];
  signals: Signal[];
  alerts: Alert[];
  selectedCoin: Coin | null;
  modalState: ModalState;
  activePage: "market" | "portfolio" | "alerts";
  setCoins: (coins: Coin[]) => void;
  setSelectedCoin: (coin: Coin | null) => void;
  openCoinModal: (coin: Coin) => void;
  openSignalModal: (signal: Signal) => void;
  closeModal: () => void;
  setActivePage: (page: "market" | "portfolio" | "alerts") => void;
}

export const useAppStore = create<AppState>((set) => ({
  coins: mockCoins,
  signals: mockSignals,
  alerts: mockAlerts,
  selectedCoin: mockCoins[0],
  modalState: { type: null, data: null },
  activePage: "market",
  setCoins: (coins) => set({ coins }),
  setSelectedCoin: (coin) => set({ selectedCoin: coin }),
  openCoinModal: (coin) => set({ modalState: { type: "coin", data: coin } }),
  openSignalModal: (signal) => set({ modalState: { type: "signal", data: signal } }),
  closeModal: () => set({ modalState: { type: null, data: null } }),
  setActivePage: (page) => set({ activePage: page }),
}));
