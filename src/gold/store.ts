import { create } from "zustand";
import { BrainMemory, DayState, Decision, Position, Settings, Trade } from "./engine/types";
import { Stats } from "./engine/stats";
import { SourceId } from "./data/feed";
import { emptyBrain } from "./engine/brain";

export type Tab = "live" | "brain" | "trades" | "lab" | "settings";

export interface Thought {
  t: number;
  kind: "info" | "scan" | "entry" | "exit" | "warn" | "learn";
  text: string;
}

export interface TrainingResult {
  at: number;
  source: SourceId;
  mode: Settings["mode"];
  from: number;
  to: number;
  days: number;
  candles: number;
  stats: Stats;
  curve: { t: number; v: number }[];
  trades: Trade[];
}

export const DEFAULT_SETTINGS: Settings = {
  capital: 10000,
  riskPct: 1,
  mode: "equilibre",
  tf: 15,
  spread: 0.3,
  maxTradesDay: 4,
  maxDailyLossPct: 3,
  source: "auto",
  trainDays: 60,
  keepAwake: true,
  notify: true,
  sound: true,
};

export interface GoldState {
  phase: "boot" | "loading" | "training" | "ready" | "error";
  bootMsg: string;
  progress: number;
  source: SourceId | null;
  feed: "live" | "polling" | "reconnecting" | "off";
  price: number;
  dayOpen: number;
  candleVersion: number;
  tickVersion: number;
  decision: Decision | null;
  position: Position | null;
  balance: number;
  equity: number;
  unrealized: number;
  trades: Trade[];
  thoughts: Thought[];
  day: DayState;
  brain: BrainMemory;
  training: TrainingResult | null;
  settings: Settings;
  autopilot: boolean;
  cooldownUntil: number;
  tab: Tab;
}

export const useGold = create<GoldState>(() => ({
  phase: "boot",
  bootMsg: "Démarrage…",
  progress: 0,
  source: null,
  feed: "off",
  price: 0,
  dayOpen: 0,
  candleVersion: 0,
  tickVersion: 0,
  decision: null,
  position: null,
  balance: DEFAULT_SETTINGS.capital,
  equity: DEFAULT_SETTINGS.capital,
  unrealized: 0,
  trades: [],
  thoughts: [],
  day: { key: "", pnl: 0, trades: 0, startBalance: DEFAULT_SETTINGS.capital },
  brain: emptyBrain(),
  training: null,
  settings: DEFAULT_SETTINGS,
  autopilot: true,
  cooldownUntil: 0,
  tab: "live",
}));
