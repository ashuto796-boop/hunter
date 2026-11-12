// The strategy's adjustable rules, in one place. The values below are what the app and the
// server trade with; backtest/research.ts changes them to test ideas on 5 years of real gold
// prices before any of them is adopted.
import { ModuleId, Regime, Session } from "./types";

export type RegimeKey = "TREND" | "RANGE" | "SQUEEZE" | "VOLATILE";

export interface Strategy {
  fit: Record<ModuleId, Record<RegimeKey, number>>; // how well each specialist suits each market state
  base: Partial<Record<ModuleId, number>>; // overrides of each specialist's base weight
  sweepKillzoneOnly: boolean; // liquidity sweeps only during the London / New York killzones
  sweepMinBias: number; // sweeps need at least this much higher-timeframe agreement (-1 = any)
  sweepNeedFvg: boolean; // sweeps need a displacement with a fair value gap
  minBias: number; // any entry needs at least this much H1/H4 agreement (-1 = any)
  minBiasShort: number; // sells need at least this much (gold drifts up over time; -1 = same as buys)
  blockRegimes: Regime[]; // no new entry in these market states
  blockSessions: Session[]; // no new entry in these sessions
  tp1Fraction: number; // share of the position taken off at the first target (1R)
  beAfterTp1: boolean; // move the stop to the entry once the first target is hit
  trailAtr: number; // trailing distance after the first target, in ATR (0 = no trailing)
  timeStopMin: number; // close a trade going nowhere after this many minutes
  weekendFlat: boolean; // close everything before the weekend
  sessionWeight: boolean; // weigh confidence by the session's liquidity (meaningful for intraday candles only)
  financingPctYear: number; // overnight financing charged by the broker, % of the position per year
  realMoney: boolean; // validated on 5 years: may trade a live (real-money) account
  fixedThreshold: number | null; // entry threshold used whatever the mode (null = the mode's / calibrated one)
}

// The rules AURUM used until November 2026: 15-minute intraday trading with all 7 specialists.
// On 5 years of real gold prices they lost money every year (backtest/report on aurum-backtest).
export const LEGACY_M15: Strategy = {
  fit: {
    sweep: { TREND: 0.85, RANGE: 1, SQUEEZE: 0.7, VOLATILE: 0.5 },
    pullback: { TREND: 1, RANGE: 0.45, SQUEEZE: 0.5, VOLATILE: 0.3 },
    london: { TREND: 0.9, RANGE: 0.75, SQUEEZE: 1, VOLATILE: 0.4 },
    squeeze: { TREND: 0.7, RANGE: 0.65, SQUEEZE: 1, VOLATILE: 0.3 },
    momentum: { TREND: 1, RANGE: 0.35, SQUEEZE: 0.7, VOLATILE: 0.4 },
    reversion: { TREND: 0.25, RANGE: 1, SQUEEZE: 0.4, VOLATILE: 0.2 },
    divergence: { TREND: 0.45, RANGE: 0.9, SQUEEZE: 0.6, VOLATILE: 0.4 },
  },
  base: {},
  sweepKillzoneOnly: false,
  sweepMinBias: -1,
  sweepNeedFvg: false,
  minBias: -1,
  minBiasShort: -1,
  blockRegimes: [],
  blockSessions: [],
  tp1Fraction: 0.5,
  beAfterTp1: true,
  trailAtr: 2.5,
  timeStopMin: 480,
  weekendFlat: true,
  sessionWeight: true,
  financingPctYear: 0,
  fixedThreshold: null,
  realMoney: false,
};

// AURUM 2 h, chosen among 256 rule sets on 2022-2024 and confirmed on
// 2025-2026 with the server's retraining (backtest/research.ts): 2-hour candles (settings.tf),
// the four specialists that held up (divergence, momentum, squeeze, liquidity sweep with the
// trend), sells only in a clear downtrend, plain stop and target, flat within the day and before
// weekends, overnight financing counted. Walk-forward: +15.8R on 2022-2024, +17.7R on 2025-2026.
export const AURUM_2H: Strategy = {
  ...LEGACY_M15,
  base: { pullback: 0, london: 0, reversion: 0 },
  sweepMinBias: 0,
  minBiasShort: 0.5,
  tp1Fraction: 0,
  beAfterTp1: false,
  trailAtr: 0,
  sessionWeight: false,
  financingPctYear: 5,
  fixedThreshold: 30,
  realMoney: true,
};

// AURUM 30 min (the owner's choice, November 2026): more trades per year, about 130. 30-minute
// candles, all 7 specialists, sweeps only in the London / New York killzones, no entry during the
// Asian session, score 50, half taken at 1R then trailed. On 5 years with the server's retraining
// it lost (-31R on 2022-2024, +4R on 2025-2026), so it runs on demo accounts only; AURUM_2H stays
// ready (settings.tf 120 + DEFAULT_STRATEGY = AURUM_2H) and is the one cleared for real money.
export const AURUM_30M: Strategy = {
  ...LEGACY_M15,
  sweepKillzoneOnly: true,
  blockSessions: ["ASIE"],
  financingPctYear: 5,
  fixedThreshold: 50,
  realMoney: false,
};

export const DEFAULT_STRATEGY: Strategy = AURUM_30M;

// The live rules (mutable so the research script can swap them; the app never does)
export const STRATEGY: Strategy = structuredClone(DEFAULT_STRATEGY);

export function useStrategy(s: Partial<Strategy>) {
  Object.assign(STRATEGY, structuredClone(DEFAULT_STRATEGY), structuredClone(s));
}
