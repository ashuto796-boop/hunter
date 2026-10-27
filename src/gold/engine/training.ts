// Walk-forward training shared by the phone app and the 24/7 server: the brain lives through
// the whole history candle by candle on a separate account and keeps the memory it built.
// In auto mode it also picks its own threshold on the first 70 % of the history and reports
// how that choice did on the last 30 % it never optimised on.
import { Trade, TraderState } from "./types";
import { AUTO_CANDIDATES, AnalyseEnv, THRESHOLDS } from "./brain";
import { newTraderState, simulate, warmupIndex } from "./trader";
import { Stats, computeStats, equityCurve, rSummary } from "./stats";

const DAY = 864e5;

export interface CalibrationRow {
  th: number;
  learnN: number;
  learnR: number;
  valN: number;
  valR: number;
  valWin: number;
}

export interface Calibration {
  chosen: number;
  splitT: number;
  rows: CalibrationRow[];
}

export interface TrainingResult {
  at: number;
  source: string;
  mode: AnalyseEnv["settings"]["mode"];
  from: number;
  to: number;
  days: number;
  candles: number;
  stats: Stats;
  curve: { t: number; v: number }[];
  trades: Trade[];
  calibration: Calibration | null;
}

export interface Trained {
  result: TrainingResult;
  st: TraderState; // the simulated account: its brain / ctx are what the live trader inherits
  threshold: number;
}

export async function train(env: AnalyseEnv, source: string, onProgress?: (msg: string, p: number) => void): Promise<Trained> {
  const m = env.m;
  const { settings } = env;
  const capital = settings.capital;
  const from = warmupIndex(m);
  const to = m.ltf.c.length - 1;
  const run = (threshold: number) => {
    const st = newTraderState(capital);
    simulate({ ...env, threshold }, st, from, to, { replay: false });
    return st;
  };
  let st: TraderState;
  let threshold = THRESHOLDS[settings.mode];
  let calibration: Calibration | null = null;
  if (settings.mode === "auto") {
    const splitT = m.ltf.c[from + Math.floor((to - from) * 0.7)].t;
    const candidates = to - from > 20000 ? [57, 61, 65] : AUTO_CANDIDATES;
    let best: { th: number; st: TraderState; obj: number } | null = null;
    const rows: CalibrationRow[] = [];
    for (const [k, th] of candidates.entries()) {
      onProgress?.(`Calibration ${k + 1}/${candidates.length} : seuil ${th}…`, k / candidates.length);
      await new Promise((r) => setTimeout(r, 0));
      const res = run(th);
      const learn = rSummary(res.trades.filter((t) => t.openTime < splitT));
      const val = rSummary(res.trades.filter((t) => t.openTime >= splitT));
      rows.push({ th, learnN: learn.n, learnR: learn.sumR, valN: val.n, valR: val.sumR, valWin: val.winRate });
      // robust objective: total R minus half the worst drawdown, with a minimum sample
      const obj = learn.n >= 6 ? learn.sumR - 0.5 * learn.maxDDR : -Infinity;
      if (!best || obj > best.obj || (obj === best.obj && th > best.th)) best = { th, st: res, obj };
    }
    if (best!.obj === -Infinity) best = { th: THRESHOLDS.auto, st: run(THRESHOLDS.auto), obj: 0 };
    threshold = best!.th;
    st = best!.st;
    calibration = { chosen: best!.th, splitT, rows };
  } else {
    st = run(threshold);
  }
  const tfMs = settings.tf * 60000;
  const t0 = m.ltf.c[Math.min(from, to)].t;
  return {
    st,
    threshold,
    result: {
      at: Date.now(),
      source,
      mode: settings.mode,
      from: t0,
      to: m.ltf.c[to].t + tfMs,
      days: (m.ltf.c[to].t - t0) / DAY,
      candles: to - from + 1,
      stats: computeStats(st.trades, capital),
      curve: equityCurve(st.trades, capital, t0),
      trades: st.trades.slice().reverse(),
      calibration,
    },
  };
}
