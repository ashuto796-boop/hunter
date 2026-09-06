import { Coin, Signal, CandleData, Portfolio, Alert } from "../types/index";

export const mockCoins: Coin[] = [
  { id: "moon", symbol: "MOON", name: "Mooncoin", price: 0.00089, change: 245, volume: 2400000, marketCap: 15000000, network: "SOL", sentiment: 92 },
  { id: "doge", symbol: "DOGE", name: "Dogecoin", price: 0.0015, change: 178, volume: 1800000, marketCap: 42000000, network: "SOL", sentiment: 78 },
  { id: "pepe", symbol: "PEPE", name: "Pepe", price: 0.0000045, change: 95, volume: 3200000, marketCap: 125000000, network: "ETH", sentiment: 65 },
  { id: "cat", symbol: "CAT", name: "Catcoin", price: 0.00025, change: 132, volume: 650000, marketCap: 5200000, network: "SOL", sentiment: 85 },
  { id: "wif", symbol: "WIF", name: "dogwifhat", price: 0.0245, change: 156, volume: 1200000, marketCap: 18000000, network: "SOL", sentiment: 88 },
  { id: "bonk", symbol: "BONK", name: "Bonk", price: 0.000125, change: 89, volume: 420000, marketCap: 2100000, network: "SOL", sentiment: 72 },
];

export const mockSignals: Signal[] = [
  { id: "1", type: "BUY", title: "MOON BREAKOUT", message: "Price broke $0.00085 resistance. Strong uptrend.", score: 92, timestamp: new Date(Date.now() - 5 * 60000), coin: "MOON" },
  { id: "2", type: "BUY", title: "DOGE MOMENTUM", message: "+178% in 24h. Volume spike detected.", score: 85, timestamp: new Date(Date.now() - 15 * 60000), coin: "DOGE" },
  { id: "3", type: "SELL", title: "PEPE WHALE DUMP", message: "2.5M tokens moved to exchange.", score: 78, timestamp: new Date(Date.now() - 25 * 60000), coin: "PEPE" },
];

export const mockCandleData: CandleData[] = [
  { time: 1000, open: 0.0008, high: 0.00085, low: 0.0007, close: 0.00082 },
  { time: 2000, open: 0.00082, high: 0.00088, low: 0.00081, close: 0.00087 },
  { time: 3000, open: 0.00087, high: 0.0009, low: 0.00086, close: 0.00089 },
  { time: 4000, open: 0.00089, high: 0.00095, low: 0.00088, close: 0.00093 },
  { time: 5000, open: 0.00093, high: 0.00098, low: 0.0009, close: 0.00095 },
];

export const mockPortfolio: Portfolio[] = [
  { symbol: "MOON", entryPrice: 0.00035, currentPrice: 0.00089, quantity: 50000, value: 44.5, pnl: 27, pnlPercent: 245 },
  { symbol: "DOGE", entryPrice: 0.00085, currentPrice: 0.0015, quantity: 25000, value: 37.5, pnl: 17.5, pnlPercent: 178 },
];

export const mockAlerts: Alert[] = [
  { id: "1", type: "SIGNAL", coin: "MOON", message: "BUY SIGNAL - Score 92/100 - Breakout above resistance", severity: "HIGH", timestamp: new Date().toLocaleTimeString() },
  { id: "2", type: "PUMP", coin: "DOGE", message: "Momentum detected - RSI 78 (Overbought)", severity: "MEDIUM", timestamp: new Date(Date.now() - 10 * 60000).toLocaleTimeString() },
  { id: "3", type: "DUMP", coin: "PEPE", message: "Whale dump - 2.5M tokens moved to exchange", severity: "HIGH", timestamp: new Date(Date.now() - 20 * 60000).toLocaleTimeString() },
];
