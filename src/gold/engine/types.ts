// Core types shared by the AURUM engine (live, replay and backtest use the same code path).
import type { DejaVu, Memory } from "./memory";

export interface Candle {
  t: number; // open time (ms, UTC)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Dir = 1 | -1;

export type Regime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "SQUEEZE" | "VOLATILE";

export type Session = "ASIE" | "LONDRES" | "OVERLAP" | "NEW_YORK" | "ROLLOVER" | "FERME";

export type ModuleId =
  | "sweep"
  | "pullback"
  | "london"
  | "squeeze"
  | "momentum"
  | "reversion"
  | "divergence";

export type Mode = "auto" | "prudent" | "equilibre" | "agressif";

export interface Vote {
  id: ModuleId;
  dir: Dir;
  strength: number; // 0..1, module's own conviction
  sl: number;
  tp: number;
  reasons: string[];
}

export interface WeightedVote extends Vote {
  weight: number; // final contribution after regime fit and learned weight
  fit: number;
  learned: number;
  f: number[]; // situation features (memory key)
  deja: DejaVu | null; // how similar past situations of this specialist played out
  recall: number; // weight multiplier from that memory
}

export interface Plan {
  dir: Dir;
  entry: number; // reference mid price at decision time
  sl: number;
  tp1: number;
  tp2: number;
  rr: number;
  primary: ModuleId;
  contributors: ModuleId[];
  score: number;
  riskMult: number;
  reasons: string[];
  regime: Regime;
  session: Session;
}

export interface Decision {
  t: number; // close time of the analysed candle
  price: number;
  score: number; // best directional score 0..99
  scoreLong: number;
  scoreShort: number;
  dir: Dir | 0;
  threshold: number;
  regime: Regime;
  bias: number; // -1..1 higher timeframe bias
  session: Session;
  killzone: string | null;
  intermarket: Intermarket | null;
  memory: DejaVu | null; // déjà vu of the leading specialist
  votes: WeightedVote[];
  pros: string[];
  cons: string[];
  verdict: string;
  blocked: string | null;
  plan: Plan | null;
}

export interface Position {
  id: string;
  dir: Dir;
  openTime: number;
  entry: number; // fill price (spread included)
  sl: number;
  sl0: number;
  tp1: number;
  tp2: number;
  oz: number; // remaining ounces
  oz0: number;
  riskAmt: number;
  realized: number; // realised P&L from partial exits
  tp1Done: boolean;
  bestPrice: number;
  barsHeld: number;
  score: number;
  primary: ModuleId;
  contributors: ModuleId[];
  reasons: string[];
  replay: boolean;
  regime: Regime;
  session: Session;
}

export type ExitReason = "SL" | "TP2" | "BE" | "TRAIL" | "TEMPS" | "WEEKEND" | "MANUEL";

export interface Trade {
  id: string;
  dir: Dir;
  openTime: number;
  closeTime: number;
  entry: number;
  exit: number; // volume-weighted average exit
  sl0: number;
  tp1: number;
  tp2: number;
  oz: number;
  pnl: number;
  r: number;
  reason: ExitReason;
  score: number;
  primary: ModuleId;
  contributors: ModuleId[];
  reasons: string[];
  replay: boolean;
  regime?: Regime; // absent on trades saved by older versions
  session?: Session;
}

export interface ModuleStats {
  n: number;
  wins: number;
  sumR: number;
}

export type BrainMemory = Record<ModuleId, ModuleStats>;

// Same statistics split by market context ("sweep:RANGE", "pullback:TREND", ...)
export type ContextMemory = Record<string, ModuleStats>;

// Silver and the dollar (via EUR/USD) read on H1: +1 = both push gold up, -1 = both push it down
export interface Intermarket {
  silver: number | null;
  usd: number | null; // EUR/USD trend: positive = weak dollar
  score: number;
}

export interface Settings {
  capital: number;
  riskPct: number;
  mode: Mode;
  tf: 5 | 15;
  spread: number; // $ per oz
  maxTradesDay: number;
  maxDailyLossPct: number;
  source: "auto" | "xau" | "paxg" | "sim";
  trainDays: number;
  keepAwake: boolean;
  notify: boolean;
  sound: boolean;
  server: boolean; // follow the 24/7 server instead of trading on the phone
  serverUrl: string;
}

export interface DayState {
  key: string;
  pnl: number;
  trades: number;
  startBalance: number;
}

export interface TraderState {
  balance: number;
  peak: number;
  position: Position | null;
  trades: Trade[];
  brain: BrainMemory;
  ctx: ContextMemory;
  mem?: Memory; // shadow trades (absent on states saved by older versions)
  day: DayState;
  lossStreak: number;
  cooldownUntil: number;
  lastLoss: { dir: Dir; t: number } | null;
  pending: Plan | null;
  seq: number;
}

export interface NewsEvent {
  t: number;
  title: string;
  before: number; // minutes blocked before
  after: number; // minutes blocked after
}
