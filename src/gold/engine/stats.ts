// Performance metrics used by the Labo (backtest) and the live account.
import { ModuleId, Trade } from "./types";
import { MODULE_IDS } from "./modules";

export interface ModulePerf {
  n: number;
  winRate: number;
  avgR: number;
  pnl: number;
}

export interface Stats {
  n: number;
  winRate: number;
  pf: number;
  pnl: number;
  netPct: number;
  maxDD: number; // fraction of peak equity
  avgR: number;
  sumR: number;
  avgWinR: number;
  avgLossR: number;
  best: number;
  worst: number;
  perModule: Record<ModuleId, ModulePerf>;
}

export function computeStats(trades: Trade[], start: number): Stats {
  let gp = 0;
  let gl = 0;
  let wins = 0;
  let sumR = 0;
  let winR = 0;
  let lossR = 0;
  let eq = start;
  let peak = start;
  let maxDD = 0;
  let best = 0;
  let worst = 0;
  const perModule = {} as Record<ModuleId, ModulePerf>;
  for (const id of MODULE_IDS) perModule[id] = { n: 0, winRate: 0, avgR: 0, pnl: 0 };
  for (const t of trades) {
    if (t.pnl > 0) {
      gp += t.pnl;
      wins++;
      winR += t.r;
    } else {
      gl -= t.pnl;
      lossR += t.r;
    }
    sumR += t.r;
    eq += t.pnl;
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, 1 - eq / peak);
    best = Math.max(best, t.pnl);
    worst = Math.min(worst, t.pnl);
    const pm = perModule[t.primary];
    pm.n++;
    pm.pnl += t.pnl;
    pm.avgR += t.r;
    if (t.pnl > 0) pm.winRate++;
  }
  for (const id of MODULE_IDS) {
    const pm = perModule[id];
    if (pm.n) {
      pm.winRate /= pm.n;
      pm.avgR /= pm.n;
    }
  }
  const n = trades.length;
  const losses = n - wins;
  return {
    n,
    winRate: n ? wins / n : 0,
    pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    pnl: gp - gl,
    netPct: (gp - gl) / start,
    maxDD,
    avgR: n ? sumR / n : 0,
    sumR,
    avgWinR: wins ? winR / wins : 0,
    avgLossR: losses ? lossR / losses : 0,
    best,
    worst,
    perModule,
  };
}

export function equityCurve(trades: Trade[], start: number, t0: number): { t: number; v: number }[] {
  const out = [{ t: t0, v: start }];
  let eq = start;
  for (const tr of trades) {
    eq += tr.pnl;
    out.push({ t: tr.closeTime, v: eq });
  }
  return out;
}

export interface RSummary {
  n: number;
  sumR: number;
  winRate: number;
  maxDDR: number; // deepest drop of the cumulative R curve
}

export function rSummary(trades: Trade[]): RSummary {
  let sumR = 0;
  let peak = 0;
  let maxDDR = 0;
  let wins = 0;
  for (const t of trades) {
    sumR += t.r;
    if (t.r > 0) wins++;
    peak = Math.max(peak, sumR);
    maxDDR = Math.max(maxDDR, peak - sumR);
  }
  return { n: trades.length, sumR, winRate: trades.length ? wins / trades.length : 0, maxDDR };
}

export interface MonteCarlo {
  horizonDays: number;
  tradesPerRun: number;
  median: number; // final return, fraction of capital
  p5: number;
  p95: number;
  probProfit: number;
  probDD10: number; // chance of a 10 % drawdown at some point
  bins: { from: number; to: number; count: number }[];
}

// Replays thousands of possible futures by drawing the past trades at random (with replacement),
// at the pace they happened, to show the spread of outcomes rather than one lucky equity curve.
export function monteCarlo(trades: Trade[], start: number, days: number, horizonDays = 30, runs = 2000): MonteCarlo | null {
  if (trades.length < 10 || days <= 0) return null;
  // each trade as a fraction of the balance it was taken with
  let bal = start;
  const rets = trades.map((t) => {
    const r = t.pnl / bal;
    bal += t.pnl;
    return r;
  });
  const n = Math.max(1, Math.round((trades.length / days) * horizonDays));
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const finals: number[] = [];
  let profit = 0;
  let dd10 = 0;
  for (let k = 0; k < runs; k++) {
    let eq = 1;
    let peak = 1;
    let hit = false;
    for (let j = 0; j < n; j++) {
      eq *= 1 + rets[Math.floor(rand() * rets.length)];
      peak = Math.max(peak, eq);
      if (eq / peak <= 0.9) hit = true;
    }
    finals.push(eq - 1);
    if (eq > 1) profit++;
    if (hit) dd10++;
  }
  finals.sort((a, b) => a - b);
  const q = (p: number) => finals[Math.min(finals.length - 1, Math.floor(p * finals.length))];
  const lo = q(0.01);
  const hi = q(0.99);
  const B = 24;
  const width = (hi - lo) / B || 1e-6;
  const bins = Array.from({ length: B }, (_, j) => ({ from: lo + j * width, to: lo + (j + 1) * width, count: 0 }));
  for (const f of finals) bins[Math.max(0, Math.min(B - 1, Math.floor((f - lo) / width)))].count++;
  return { horizonDays, tradesPerRun: n, median: q(0.5), p5: q(0.05), p95: q(0.95), probProfit: profit / runs, probDD10: dd10 / runs, bins };
}
