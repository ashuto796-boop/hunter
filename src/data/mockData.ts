import { Coin, Signal, CandleData, Portfolio, Alert } from "../types/index";

export const mockCoins: Coin[] = [
  { id: "moon", symbol: "MOON", name: "Mooncoin", price: 0.00089, change24h: 245, volume24h: 2.4, marketCap: 15, network: "SOL", sentiment: 92, whaleActivity: 2.5 },
  { id: "doge", symbol: "DOGE", name: "Dogecoin", price: 0.0015, change24h: 178, volume24h: 1.8, marketCap: 42, network: "SOL", sentiment: 78, whaleActivity: 1.8 },
  { id: "pepe", symbol: "PEPE", name: "Pepe", price: 0.0000045, change24h: 95, volume24h: 3.2, marketCap: 125, network: "ETH", sentiment: 65, whaleActivity: -2.5 },
  { id: "cat", symbol: "CAT", name: "Catcoin", price: 0.00025, change24h: 132, volume24h: 0.65, marketCap: 5.2, network: "SOL", sentiment: 85, whaleActivity: 0.8 },
  { id: "wif", symbol: "WIF", name: "dogwifhat", price: 0.0245, change24h: 156, volume24h: 1.2, marketCap: 18, network: "SOL", sentiment: 88, whaleActivity: 1.2 },
  { id: "bonk", symbol: "BONK", name: "Bonk", price: 0.000125, change24h: 89, volume24h: 0.42, marketCap: 2.1, network: "SOL", sentiment: 72, whaleActivity: 0.5 },
];

export const mockSignals: Signal[] = [
  { id: "1", type: "BUY", title: "MOON BREAKOUT", message: "Price broke $0.00085 resistance. Strong uptrend.", score: 92, timestamp: new Date(Date.now() - 5 * 60000), coinSymbol: "MOON" },
  { id: "2", type: "BUY", title: "DOGE MOMENTUM", message: "+178% in 24h. Volume spike detected.", score: 85, timestamp: new Date(Date.now() - 15 * 60000), coinSymbol: "DOGE" },
  { id: "3", type: "SELL", title: "PEPE WHALE DUMP", message: "2.5M tokens moved to exchange.", score: 78, timestamp: new Date(Date.now() - 25 * 60000), coinSymbol: "PEPE" },
];

export const mockCandleData: CandleData[] = [
  { time: 1000, open: 0.0008, high: 0.00085, low: 0.0007, close: 0.00082, volume: 1200 },
  { time: 2000, open: 0.00082, high: 0.00088, low: 0.00081, close: 0.00087, volume: 1400 },
  { time: 3000, open: 0.00087, high: 0.0009, low: 0.00086, close: 0.00089, volume: 1600 },
  { time: 4000, open: 0.00089, high: 0.00095, low: 0.00088, close: 0.00093, volume: 1800 },
  { time: 5000, open: 0.00093, high: 0.00098, low: 0.0009, close: 0.00095, volume: 2000 },
];

export const mockPortfolio: Portfolio[] = [
  { symbol: "MOON", entryPrice: 0.00035, currentPrice: 0.00089, quantity: 50000, value: 44.5, pnl: 27, pnlPercent: 245 },
  { symbol: "DOGE", entryPrice: 0.00085, currentPrice: 0.0015, quantity: 25000, value: 37.5, pnl: 17.5, pnlPercent: 178 },
];

export const mockAlerts: Alert[] = [
  { id: "1", type: "BUY", title: "BUY SIGNAL: MOON", description: "Score 92/100 - Breakout above resistance", coinSymbol: "MOON", severity: "high", timestamp: new Date() },
  { id: "2", type: "HOLD", title: "HOLD: DOGE", description: "RSI 78 (Overbought) - Wait for pullback", coinSymbol: "DOGE", severity: "medium", timestamp: new Date(Date.now() - 10 * 60000) },
  { id: "3", type: "SELL", title: "SELL: PEPE", description: "Whale dump detected - 2.5M tokens moved", coinSymbol: "PEPE", severity: "high", timestamp: new Date(Date.now() - 20 * 60000) },
];
