import { create } from "zustand";
import { BrainMemory, ContextMemory, DayState, Decision, ModuleStats, Position, Settings, Trade } from "./engine/types";
import { SourceId } from "./data/feed";
import { emptyBrain } from "./engine/brain";
import { DEFAULT_SETTINGS } from "./engine/defaults";
import { TrainingResult } from "./engine/training";
import { Thought } from "./engine/narrate";

export { DEFAULT_SETTINGS };
export type { Thought, TrainingResult };
export type { Calibration, CalibrationRow } from "./engine/training";

export type Tab = "live" | "brain" | "trades" | "lab" | "settings";

// The phone mirrors the 24/7 server when one is publishing
export interface RemoteInfo {
  updatedAt: number;
  startedAt: number;
  runs: number;
  host: string;
  fetchedAt: number;
  error: string | null;
}

export interface GoldState {
  phase: "boot" | "loading" | "training" | "ready" | "error";
  threshold: number;
  remote: RemoteInfo | null;
  serverNote: string | null; // why the phone is trading locally although the server is enabled
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
  ctx: ContextMemory;
  note: { day: string; at: number; text: string; model: string } | null; // evening log written by Claude (server)
  memStats: Record<string, ModuleStats>; // shadow-trade lessons per specialist (and per regime)
  memTotal: number;
  training: TrainingResult | null;
  settings: Settings;
  trader: Settings; // settings of whoever is trading: the server's in server mode, else the phone's
  autopilot: boolean;
  cooldownUntil: number;
  tab: Tab;
}

export const useGold = create<GoldState>(() => ({
  phase: "boot",
  threshold: 61,
  remote: null,
  serverNote: null,
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
  ctx: {},
  note: null,
  memStats: {},
  memTotal: 0,
  training: null,
  settings: DEFAULT_SETTINGS,
  trader: DEFAULT_SETTINGS,
  autopilot: true,
  cooldownUntil: 0,
  tab: "live",
}));
