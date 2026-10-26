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
