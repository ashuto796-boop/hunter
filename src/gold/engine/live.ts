// Real-money execution at the broker (OANDA), as the server records it and the app displays it.
// The detailed state is sealed (see seal.ts): on the public data branch only its owner can read it.
import { Sealed } from "./seal";

// To trade a live (real-money) account, this exact sentence must be in server/config.json
export const LIVE_CONFIRM = "J'accepte de risquer de l'argent réel";

export interface LiveLeg {
  clientId: string;
  leg: "a" | "b"; // a: first half, target 1R · b: the rest, target TP2
  units: number; // signed ounces
  price: number;
  openTime: number;
  sl: number | null;
  tp: number | null;
  pl: number; // unrealized, account currency
}

export interface LiveClosed {
  clientId: string;
  units: number;
  open: number;
  close: number | null;
  pl: number;
  openTime: number;
  t: number; // close time
}

export interface LiveEvent {
  t: number;
  kind: "ordre" | "clôture" | "stop" | "ignoré" | "erreur" | "info" | "coupure";
  text: string;
}

export interface LiveState {
  broker: "oanda";
  env: "practice" | "live";
  status: "actif" | "en pause" | "coupé";
  reason: string | null; // why new entries are paused, when they are
  currency: string;
  nav: number;
  balance: number;
  unrealized: number;
  marginAvailable: number;
  riskPct: number; // risk per trade actually applied
  startNav: number; // reference for the drawdown breaker (reset with "reset" in config)
  startedAt: number;
  dayKey: string;
  dayStartNav: number;
  resetSeen: number;
  halt: { kind: "jour" | "total"; at: number; text: string } | null;
  open: LiveLeg[];
  closed: LiveClosed[];
  log: LiveEvent[];
  handled: number[]; // AI entries (decision time) already sent or deliberately skipped
  executions: number;
  errors: number;
  runTimes: number[]; // recent server runs, to judge whether positions are watched often enough
  updatedAt: number;
}

// What state.json carries in clear
export interface LivePublic {
  configured: boolean; // broker secrets present on the server
  sealed: Sealed | null;
  note: string | null; // setup hint, never account data
}

// Median gap between recent runs, in minutes (null until there are enough runs)
export function runGapMin(runTimes: number[]): number | null {
  const r = runTimes.slice(-7);
  if (r.length < 4) return null;
  const gaps = r.slice(1).map((t, i) => (t - r[i]) / 60000).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}
