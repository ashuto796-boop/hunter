export interface Coin {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  network: "SOL" | "ETH" | "BNB";
  sentiment?: number;
  whaleActivity?: number;
}

export interface Signal {
  id: string;
  type: "BUY" | "SELL" | "HOLD";
  title: string;
  message: string;
  score: number;
  timestamp: Date;
  coinSymbol: string;
}

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
  type: "BUY" | "SELL" | "HOLD" | "WHALE";
  title: string;
  description: string;
  coinSymbol: string;
  severity: "high" | "medium" | "low";
  timestamp: Date;
}

export interface ModalState {
  type: "coin" | "signal" | "alert" | null;
  data: Coin | Signal | Alert | null;
  isOpen: boolean;
}
