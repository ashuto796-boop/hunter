export interface Coin {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change: number;
  volume: number;
  marketCap: number;
  network: "SOL" | "ETH" | "BNB";
  sentiment: number;
}

export interface Signal {
  id: string;
  type: "BUY" | "SELL" | "HOLD";
  title: string;
  message: string;
  score: number;
  timestamp: Date;
  coin: string;
}

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface Portfolio {
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  value: number;
  pnl: number;
  pnlPercent: number;
}

export interface Alert {
  id: string;
  type: "SIGNAL" | "PUMP" | "DUMP";
  coin: string;
  message: string;
  severity: "HIGH" | "MEDIUM";
  timestamp: string;
}

export interface ModalState {
  type: "coin" | "signal" | null;
  data: Coin | Signal | null;
}
