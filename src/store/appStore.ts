import { create } from "zustand";
import { Coin, Signal, ModalState } from "../types/index";
import { mockCoins, mockSignals } from "../data/mockData";

interface AppState {
  coins: Coin[];
  signals: Signal[];
  selectedCoin: Coin | null;
  modal: ModalState;
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
  selectedCoin: mockCoins[0],
  modal: { type: null, data: null, isOpen: false },
  activePage: "market",
  setCoins: (coins) => set({ coins }),
  setSelectedCoin: (coin) => set({ selectedCoin: coin }),
  openCoinModal: (coin) => set({ modal: { type: "coin", data: coin, isOpen: true } }),
  openSignalModal: (signal) => set({ modal: { type: "signal", data: signal, isOpen: true } }),
  closeModal: () => set({ modal: { type: null, data: null, isOpen: false } }),
  setActivePage: (page) => set({ activePage: page }),
}));
