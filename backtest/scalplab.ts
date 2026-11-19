// AURUM scalping lab: every night, searches and refines home-made scalping rules on 1-minute gold
// with the real spread of every minute (4 years, backtest/dukascopy.py --m1).
//
// A rule is a method (where to enter), filters (when, with which trend, at what spread and
// volatility) and an exit (stop in 60-minute ATR, target in R, time limit, stop to the entry).
// Methods come from what the data shows (backtest/edge_m1.ts) and from AURUM itself: "ia" scalps
// only in the direction of the 2-hour AI while it holds a position, and can stay until it exits.
// Same protection against luck as the strategy lab (backtest/lab.ts):
//   ranked on the data before 2025; "qualifiée" if 2025 up to its discovery also makes money;
//   "confirmée" only after 30+ days and 20+ trades on prices that did not exist when it was found,
//   still winning with a 50 % wider spread. Results: scalp.json and scalp.md on aurum-lab.
//
//   worker: npx tsx backtest/scalplab.ts --wf --data <M15 dir> --m1 xau_m1.json --state scalp.json --worker 0 --workers 6 --minutes 30 --out s-0.jsonl
//   merge:  npx tsx backtest/scalplab.ts --merge parts --m1 xau_m1.json --state scalp.json --report scalp.md
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { elderSignal } from "../src/gold/engine/scalprule";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const DAY = 864e5;
const TRAIN_END = Date.UTC(2025, 0, 1) / 1000;
const NOW = Date.now();

// ---------------------------------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------------------------------
const lastSunday = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m + 1, 0));
  return Date.UTC(y, m, d.getUTCDate() - d.getUTCDay());
};
const nthSunday = (y: number, m: number, n: number) => Date.UTC(y, m, 1 + ((7 - new Date(Date.UTC(y, m, 1)).getUTCDay()) % 7) + 7 * (n - 1));
const uk = (ms: number) => {
  const y = new Date(ms).getUTCFullYear();
  return ms >= lastSunday(y, 2) + 3600e3 && ms < lastSunday(y, 9) + 3600e3 ? 1 : 0;
};
const us = (ms: number) => {
  const y = new Date(ms).getUTCFullYear();
  return ms >= nthSunday(y, 2, 2) + 7 * 3600e3 && ms < nthSunday(y, 10, 1) + 6 * 3600e3 ? -4 : -5;
};
const raw = JSON.parse(readFileSync(opt("m1", "xau_m1.json"), "utf8")) as number[][];
const N = raw.length;
const T = new Float64Array(N), O = new Float64Array(N), H = new Float64Array(N), L = new Float64Array(N), C = new Float64Array(N), S0 = new Float64Array(N);
raw.forEach((r, i) => ((T[i] = r[0]), (O[i] = r[1]), (H[i] = r[2]), (L[i] = r[3]), (C[i] = r[4]), (S0[i] = Math.max(0, r[5]))));
let S = S0;
const LON = new Int16Array(N), NY = new Int16Array(N), DAYN = new Int32Array(N), GAP = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const ms = T[i] * 1000;
  const lon = new Date(ms + uk(ms) * 3600e3), ny = new Date(ms + us(ms) * 3600e3);
  LON[i] = lon.getUTCHours() * 60 + lon.getUTCMinutes();
  NY[i] = ny.getUTCHours() * 60 + ny.getUTCMinutes();
  DAYN[i] = Math.floor((ms + us(ms) * 3600e3 + 7 * 3600e3) / 864e5);
  GAP[i] = i > 0 && T[i] - T[i - 1] > 300 ? 1 : 0;
}
const ATR = new Float64Array(N);
for (let i = 1; i < N; i++) ATR[i] = ATR[i - 1] + (Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])) - ATR[i - 1]) / 60;
const emaCache = new Map<number, Float64Array>();
const EMA = (n: number) => {
  if (!emaCache.has(n)) {
    const out = new Float64Array(N);
    const k = 2 / (n + 1);
    out[0] = C[0];
    for (let i = 1; i < N; i++) out[i] = out[i - 1] + k * (C[i] - out[i - 1]);
    emaCache.set(n, out);
  }
  return emaCache.get(n)!;
};
// day levels
const PDH = new Float64Array(N).fill(NaN), PDL = new Float64Array(N).fill(NaN), AH = new Float64Array(N).fill(NaN), AL = new Float64Array(N).fill(NaN), TWAP = new Float64Array(N).fill(NaN);
{
  let day = -1, dh = -Infinity, dl = Infinity, ph = NaN, pl = NaN, ah = -Infinity, al = Infinity, sum = 0, cnt = 0;
  for (let i = 0; i < N; i++) {
    if (DAYN[i] !== day) {
      if (day !== -1 && Number.isFinite(dh)) (ph = dh), (pl = dl);
      day = DAYN[i];
      dh = ah = -Infinity;
      dl = al = Infinity;
      sum = cnt = 0;
    }
    PDH[i] = ph;
    PDL[i] = pl;
    if (LON[i] < 7 * 60 || LON[i] >= 22 * 60) (ah = Math.max(ah, H[i])), (al = Math.min(al, L[i]));
    else if (Number.isFinite(ah)) (AH[i] = ah), (AL[i] = al);
    if (LON[i] >= 7 * 60 && LON[i] < 22 * 60) (sum += C[i]), cnt++, (TWAP[i] = sum / cnt);
    dh = Math.max(dh, H[i]);
    dl = Math.min(dl, L[i]);
  }
}
// the 2-hour AI's positions, minute by minute (filled by loadAI when the M15 data is given)
const AIDIR = new Int8Array(N), AIUNTIL = new Float64Array(N);
let aiReady = false;
async function loadAI() {
  if (!args.includes("--data")) return;
  const { evaluate } = await import("./research");
  const { AURUM_2H } = await import("../src/gold/engine/strategy");
  const { fit: _f, ...rules } = AURUM_2H;
  const r = await evaluate({ name: "AURUM 2 h", tf: 120, threshold: 30, rules: { ...rules, fixedThreshold: 30, financingPctYear: 5 }, settings: { trainDays: 365, maxTradesDay: 4 } });
  const idx = (t: number) => {
    let lo = 0, hi = N;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (T[m] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  for (const t of r.trades) for (let i = idx(t.openTime / 1000); i < idx(t.closeTime / 1000) && i < N; i++) (AIDIR[i] = t.dir), (AIUNTIL[i] = t.closeTime / 1000);
  aiReady = true;
}

// ---------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------
export interface SRule {
  method: string;
  p: number[];
  when: number; // 0 all, 1 London+NY, 2 overlap, 3 London, 4 New York
  trend: number; // 0 none, 1 4-hour average, 2 day average, 3 the 2-hour AI's position
  maxSpread: number;
  minAtr: number; // $ of 60-minute ATR at least (a market that moves)
  stopK: number; // stop in 60-minute ATR
  targetR: number;
  maxMin: number; // -1: until the 2-hour AI exits
  beAt: number;
  // the owner's ladder instead of one stop and target: [n positions at most, step $ against before
  // adding one, target $ per position]; the ladder is cut one step past the last position.
  // Measured in R of its largest possible loss (step × n(n+1)/2 per ounce).
  ladder?: number[];
}
const METHODS: Record<string, { params: number[][]; label: (p: number[]) => string }> = {
  orb: { params: [[0, 1], [5, 15, 30, 60], [0, 1]], label: (p) => `cassure de l'ouverture de ${p[0] ? "New York" : "Londres"} ${p[1]} min${p[2] ? " + retest" : ""}` },
  asia: { params: [[0, 1]], label: (p) => `range asiatique, ${p[0] ? "fausse cassure" : "cassure"}` },
  pdhl: { params: [[0, 1]], label: (p) => `plus haut/bas de la veille, ${p[0] ? "fausse cassure" : "cassure"}` },
  twap: { params: [[2, 3, 4, 5, 6]], label: (p) => `retour vers la moyenne de séance depuis ${p[0]} ATR` },
  round: { params: [[5, 10, 25, 50]], label: (p) => `rebond sur chiffre rond (${p[0]} $)` },
  pull: { params: [[9, 20, 45, 60], [21, 50, 105, 180]], label: (p) => `repli sur la moyenne ${p[1]} min (rapide ${p[0]})` },
  burst: { params: [[2, 3, 4, 5]], label: (p) => `élan ×${p[0]}` },
  fade: { params: [[2, 3, 4, 5, 6]], label: (p) => `retour depuis ${p[0]} ATR de la moyenne 20 min` },
  sweep: { params: [[15, 30, 60, 120, 240]], label: (p) => `chasse aux stops (sommet/creux ${p[0]} min)` },
  elder: { params: [[240, 1440], [30, 60], [1, 5, 15], [20, 30]], label: (p) => `triple écran d'Elder : direction ${p[0] === 1440 ? "1 jour" : "4 h"}, repli ${p[1] === 60 ? "1 h" : "30 min"} (stochastique ${p[3]}/${100 - p[3]}), entrée sur cassure ${p[2]} min` },
  ia: { params: [[0, 1, 2, 3]], label: (p) => `dans le sens de l'IA 2 h : ${["repli moyenne 20 min", "repli moyenne 50 min", "creux/sommet 15 min repris", "toutes les 15 min"][p[0]]}` },
};
const OPTIONS = {
  when: [0, 1, 2, 3, 4],
  trend: [0, 0, 1, 2, 3],
  maxSpread: [0.6, 0.8, 1.2],
  minAtr: [0, 0.5, 1],
  stopK: [2, 3, 5, 8, 12, 20, 40],
  targetR: [0.5, 1, 1.5, 2, 3, 5],
  maxMin: [15, 30, 60, 120, 240, -1],
  beAt: [0, 0, 0.5, 1],
  ladderN: [5, 10, 10],
  ladderStep: [1, 2, 3, 5, 8],
  ladderTarget: [0.5, 1, 2, 3, 5],
  ladderMaxMin: [60, 120, 240, 480, -1],
};
const randomLadder = (rnd: () => number) => [pick(rnd, OPTIONS.ladderN), pick(rnd, OPTIONS.ladderStep), pick(rnd, OPTIONS.ladderTarget)];
const WHEN = ["toutes heures", "Londres + New York", "chevauchement", "Londres", "New York"];
const TREND = ["sans tendance", "avec la tendance 4 h", "avec la tendance du jour", "avec la position de l'IA 2 h"];
const describe = (r: SRule) =>
  `${METHODS[r.method].label(r.p)} · ${WHEN[r.when]} · ${TREND[r.trend]} · écart ≤ ${r.maxSpread} · ATR ≥ ${r.minAtr} $ · ${
    r.ladder
      ? `échelle de ${r.ladder[0]} positions (une de plus tous les ${r.ladder[1]} $ contre, +${r.ladder[2]} $ chacune, coupée un pas après la dernière)`
      : `stop ${r.stopK} ATR · obj ${r.targetR}R`
  } · ${r.maxMin < 0 ? "jusqu'à la sortie de l'IA" : `${r.maxMin} min`}${r.beAt ? ` · stop à l'entrée à ${r.beAt}R` : ""}`;

type Signal = (i: number) => 1 | -1 | 0;
function makeSignal(r: SRule): Signal {
  const p = r.p;
  switch (r.method) {
    case "orb": {
      const start = p[0] ? 9 * 60 + 30 : 8 * 60;
      let day = -1, hi = -Infinity, lo = Infinity, done = false, broke = 0;
      return (i) => {
        const clock = p[0] ? NY[i] : LON[i];
        if (DAYN[i] !== day) (day = DAYN[i]), (hi = -Infinity), (lo = Infinity), (done = false), (broke = 0);
        if (clock >= start && clock < start + p[1]) return (hi = Math.max(hi, H[i])), (lo = Math.min(lo, L[i])), 0;
        if (done || clock < start + p[1] || clock > start + 240 || !Number.isFinite(hi)) return 0;
        if (!p[2]) return C[i] > hi ? ((done = true), 1) : C[i] < lo ? ((done = true), -1) : 0;
        if (!broke) return (broke = C[i] > hi ? 1 : C[i] < lo ? -1 : 0), 0;
        if (broke === 1 && L[i] <= hi && C[i] > hi) return (done = true), 1;
        if (broke === -1 && H[i] >= lo && C[i] < lo) return (done = true), -1;
        return 0;
      };
    }
    case "asia": {
      let day = -1, done = false;
      return (i) => {
        if (DAYN[i] !== day) (day = DAYN[i]), (done = false);
        const hi = AH[i], lo = AL[i];
        if (done || !Number.isFinite(hi) || LON[i] < 7 * 60 || LON[i] > 11 * 60) return 0;
        if (!p[0]) return C[i] > hi ? ((done = true), 1) : C[i] < lo ? ((done = true), -1) : 0;
        if (H[i] > hi && C[i] < hi) return (done = true), -1;
        if (L[i] < lo && C[i] > lo) return (done = true), 1;
        return 0;
      };
    }
    case "pdhl": {
      let day = -1, uh = false, ul = false;
      return (i) => {
        if (DAYN[i] !== day) (day = DAYN[i]), (uh = ul = false);
        const hi = PDH[i], lo = PDL[i];
        if (!Number.isFinite(hi)) return 0;
        if (!p[0]) {
          if (!uh && C[i] > hi && O[i] <= hi) return (uh = true), 1;
          if (!ul && C[i] < lo && O[i] >= lo) return (ul = true), -1;
          return 0;
        }
        if (!uh && H[i] > hi && C[i] < hi) return (uh = true), -1;
        if (!ul && L[i] < lo && C[i] > lo) return (ul = true), 1;
        return 0;
      };
    }
    case "twap":
      return (i) => {
        const v = TWAP[i];
        if (!Number.isFinite(v) || !ATR[i]) return 0;
        const d = (C[i] - v) / ATR[i];
        return d > p[0] && C[i] < O[i] ? -1 : d < -p[0] && C[i] > O[i] ? 1 : 0;
      };
    case "round": {
      let last = NaN;
      return (i) => {
        const lvl = Math.round(C[i] / p[0]) * p[0];
        if (lvl === last) return 0;
        if (L[i] <= lvl && O[i] > lvl + 0.5 && C[i] > lvl) return (last = lvl), 1;
        if (H[i] >= lvl && O[i] < lvl - 0.5 && C[i] < lvl) return (last = lvl), -1;
        return 0;
      };
    }
    case "pull": {
      const f = EMA(p[0]), s = EMA(Math.max(p[1], p[0] + 1));
      return (i) => (f[i] > s[i] && L[i] <= s[i] && C[i] > s[i] && C[i] > O[i] ? 1 : f[i] < s[i] && H[i] >= s[i] && C[i] < s[i] && C[i] < O[i] ? -1 : 0);
    }
    case "burst":
      return (i) => {
        const rg = H[i] - L[i];
        if (rg < p[0] * ATR[i] || rg <= 0) return 0;
        const pos = (C[i] - L[i]) / rg;
        return pos > 0.8 ? 1 : pos < 0.2 ? -1 : 0;
      };
    case "fade": {
      const e = EMA(20);
      return (i) => {
        if (!ATR[i]) return 0;
        const d = (C[i] - e[i]) / ATR[i];
        return d > p[0] ? -1 : d < -p[0] ? 1 : 0;
      };
    }
    case "sweep":
      return (i) => {
        if (i < p[0] + 1) return 0;
        let hi = -Infinity, lo = Infinity;
        for (let j = i - p[0]; j < i; j++) (hi = Math.max(hi, H[j])), (lo = Math.min(lo, L[j]));
        return H[i] > hi && C[i] < hi && C[i] < O[i] ? -1 : L[i] < lo && C[i] > lo && C[i] > O[i] ? 1 : 0;
      };
    case "elder":
      return elderSignal({ N, T, H, L, C }, p);
    case "ia": {
      const e20 = EMA(20), e50 = EMA(50);
      return (i) => {
        const d = AIDIR[i] as 1 | -1 | 0;
        if (!d) return 0;
        if (p[0] === 0) return (d === 1 ? L[i] <= e20[i] && C[i] > e20[i] && C[i] > O[i] : H[i] >= e20[i] && C[i] < e20[i] && C[i] < O[i]) ? d : 0;
        if (p[0] === 1) return (d === 1 ? L[i] <= e50[i] && C[i] > e50[i] && C[i] > O[i] : H[i] >= e50[i] && C[i] < e50[i] && C[i] < O[i]) ? d : 0;
        if (p[0] === 2) {
          if (i < 16) return 0;
          let lo = Infinity, hi = -Infinity;
          for (let j = i - 15; j < i; j++) (lo = Math.min(lo, L[j])), (hi = Math.max(hi, H[j]));
          return (d === 1 ? L[i] < lo && C[i] > lo : H[i] > hi && C[i] < hi) ? d : 0;
        }
        return T[i] % 900 === 0 ? d : 0;
      };
    }
  }
  return () => 0;
}
const whenOk = (w: number, i: number) =>
  w === 0 ? !(NY[i] >= 16 * 60 + 45 && NY[i] < 18 * 60 + 15) : w === 1 ? (LON[i] >= 7 * 60 && LON[i] < 11 * 60 + 30) || (NY[i] >= 8 * 60 && NY[i] < 12 * 60) : w === 2 ? NY[i] >= 8 * 60 && NY[i] < 11 * 60 + 30 : w === 3 ? LON[i] >= 7 * 60 && LON[i] < 11 * 60 + 30 : NY[i] >= 8 * 60 && NY[i] < 12 * 60;
function trendOk(t: number, i: number, d: number) {
  if (t === 0) return true;
  if (t === 1) {
    const e = EMA(240);
    return d * (C[i] - e[i]) > 0 && d * (e[i] - e[Math.max(0, i - 60)]) > 0;
  }
  if (t === 2) return d * (C[i] - EMA(1200)[i]) > 0;
  return AIDIR[i] === d;
}

interface Res {
  r: number;
  t: number;
  exit: number;
}
// One ladder from the signal on minute i, on the real spread of every minute (same rules as
// src/gold/engine/ladder.ts, which the demo account runs)
function ladderRun(i: number, d: 1 | -1, lad: number[], until: number): Res | null {
  const [n, step, target] = lad;
  const unit = (step * n * (n + 1)) / 2;
  const k = i + 1;
  const open = [O[k] + (d * S[i]) / 2];
  let pnl = 0, added = 1;
  const done = (extra: number, j: number): Res => ({ r: (pnl + extra) / unit, t: T[k], exit: j });
  const markAt = (px: number) => open.reduce((s, e) => s + d * (px - e), 0);
  for (let j = k; j < N; j++) {
    const half = S[j] / 2;
    if (j > k && GAP[j]) return done(markAt(C[j - 1] - (d * S[j - 1]) / 2), j - 1);
    const worstPx = d === 1 ? L[j] - half : H[j] + half, bestPx = d === 1 ? H[j] - half : L[j] + half;
    for (let p = open.length - 1; p >= 0; p--)
      if (d * (bestPx - open[p]) >= target) {
        pnl += target;
        open.splice(p, 1);
      }
    const last = open.length ? open[open.length - 1] : null;
    if (last !== null && added < n && d * (worstPx - last) <= -step) {
      open.push(last - d * step + d * half);
      added++;
    }
    if (added >= n && open.length && d * (worstPx - open[open.length - 1]) <= -step) return done(markAt(open[open.length - 1] - d * step), j);
    if (!open.length) return done(0, j);
    if (T[j] >= until) return done(markAt(C[j] - d * half), j);
  }
  return null;
}

export function run(r: SRule): Res[] {
  if ((r.method === "ia" || r.trend === 3 || r.maxMin < 0) && !aiReady) return [];
  const sig = makeSignal(r);
  const out: Res[] = [];
  for (let i = 1500; i < N - 2; i++) {
    const d = sig(i);
    if (!d || GAP[i + 1] || S[i] > r.maxSpread || ATR[i] < r.minAtr || !whenOk(r.when, i) || !trendOk(r.trend, i, d)) continue;
    if (r.ladder) {
      const res = ladderRun(i, d, r.ladder, r.maxMin < 0 ? AIUNTIL[i] || T[i] + 8 * 3600 : T[i + 1] + r.maxMin * 60);
      if (!res) break;
      out.push(res);
      for (let j = i + 1; j <= res.exit; j++) sig(j);
      i = res.exit;
      continue;
    }
    const stop = r.stopK * ATR[i];
    if (stop < 2 * S[i]) continue;
    const k = i + 1;
    const entry = O[k] + (d * S[i]) / 2;
    let sl = entry - d * stop;
    const tp = entry + d * r.targetR * stop;
    const until = r.maxMin < 0 ? AIUNTIL[i] || T[i] + 8 * 3600 : T[k] + r.maxMin * 60;
    let res: Res | null = null;
    for (let j = k; j < N; j++) {
      const half = S[j] / 2;
      if (j > k && GAP[j]) {
        res = { r: (d * (C[j - 1] - (d * S[j - 1]) / 2 - entry)) / stop, t: T[k], exit: j - 1 };
        break;
      }
      if (d * ((d === 1 ? L[j] - half : H[j] + half) - sl) <= 0) {
        res = { r: (d * ((d === 1 ? Math.min(sl, O[j] - half) : Math.max(sl, O[j] + half)) - entry)) / stop, t: T[k], exit: j };
        break;
      }
      if (d * ((d === 1 ? H[j] - half : L[j] + half) - tp) >= 0) {
        res = { r: r.targetR, t: T[k], exit: j };
        break;
      }
      if (r.beAt > 0 && d * ((d === 1 ? H[j] - half : L[j] + half) - entry) >= r.beAt * stop && d * (sl - entry) < 0) sl = entry;
      if (T[j] >= until) {
        res = { r: (d * (C[j] - (d * S[j]) / 2 - entry)) / stop, t: T[k], exit: j };
        break;
      }
    }
    if (!res) break;
    out.push(res);
    for (let j = i + 1; j <= res.exit; j++) sig(j);
    i = res.exit;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Judging, search, leaderboard
// ---------------------------------------------------------------------------------------------------
interface Period {
  n: number;
  sumR: number;
  pf: number;
  days: number;
}
interface Metrics {
  train: Period;
  valid: Period;
  live: Period;
  halves: number[]; // R per half-year before 2025
  dd: number;
  perDay: number;
  stress?: number;
  score: number;
}
interface Entry {
  id: string;
  rule: SRule;
  foundAt: number;
  origin: string;
  m: Metrics;
  status: "rejetée" | "candidate" | "qualifiée" | "confirmée";
  checkedAt: number;
}
interface ScalpState {
  version: 1;
  updatedAt: number;
  nights: number;
  tried: number;
  entries: Entry[];
  champion: string | null;
}
const period = (xs: Res[], from: number, to: number): Period => {
  let gp = 0, gl = 0, s = 0;
  for (const x of xs) (s += x.r), x.r > 0 ? (gp += x.r) : (gl -= x.r);
  return { n: xs.length, sumR: s, pf: gl ? gp / gl : gp ? 9.99 : 0, days: Math.max(0, (to - from) / 86400) };
};
const maxDD = (xs: Res[]) => {
  let eq = 0, pk = 0, dd = 0;
  for (const x of xs) (eq += x.r), (pk = Math.max(pk, eq)), (dd = Math.max(dd, pk - eq));
  return dd;
};
function judge(rule: SRule, foundAt: number, withStress: boolean): Metrics {
  const xs = run(rule);
  const f = foundAt / 1000;
  const t0 = T[0], t1 = T[N - 1];
  const train = period(xs.filter((x) => x.t < TRAIN_END), t0, TRAIN_END);
  const valid = period(xs.filter((x) => x.t >= TRAIN_END && x.t < f), TRAIN_END, Math.min(f, t1));
  const live = period(xs.filter((x) => x.t >= f), f, Math.max(f, t1));
  const halves: number[] = [];
  for (let h = t0; h < TRAIN_END; h += 182.5 * 86400) halves.push(xs.filter((x) => x.t >= h && x.t < Math.min(TRAIN_END, h + 182.5 * 86400)).reduce((s, x) => s + x.r, 0));
  const trainYears = Math.max(0.5, train.days / 365);
  const m: Metrics = { train, valid, live, halves, dd: maxDD(xs), perDay: xs.length / Math.max(1, ((t1 - t0) / 86400) * (5 / 7)), score: (train.sumR - 0.5 * maxDD(xs.filter((x) => x.t < TRAIN_END))) / trainYears };
  if (withStress) {
    S = S0.map((v) => v * 1.5);
    m.stress = run(rule).reduce((s, x) => s + x.r, 0);
    S = S0;
  }
  return m;
}
function statusOf(m: Metrics): Entry["status"] {
  const posHalves = m.halves.filter((v) => v > 0).length;
  const qualified =
    m.score > 0 &&
    m.train.pf >= 1.15 &&
    m.train.n >= 100 * (m.train.days / 365) &&
    posHalves >= Math.ceil(m.halves.length * 0.6) &&
    m.valid.sumR > 0 &&
    m.valid.pf >= 1.1 &&
    m.dd <= 40;
  if (!qualified) return m.score > 0 ? "candidate" : "rejetée";
  // failing on prices that did not exist when it was found takes it off the board
  if (m.live.sumR <= -10 || (m.live.n >= 20 && m.live.sumR <= -5)) return "rejetée";
  return m.live.days >= 30 && m.live.n >= 20 && m.live.sumR >= 0 && (m.stress ?? -1) > 0 ? "confirmée" : "qualifiée";
}
const idOf = (r: SRule) => {
  let h = 2166136261;
  for (const ch of JSON.stringify(r)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `K${(h >>> 0).toString(36).toUpperCase()}`;
};
function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <X>(rnd: () => number, xs: readonly X[]) => xs[Math.floor(rnd() * xs.length)];
// a third of the new rules are ladders (the owner's idea: up to 10 small positions on one signal)
function randomRule(rnd: () => number): SRule {
  const method = pick(rnd, Object.keys(METHODS));
  if (rnd() < 0.33)
    return {
      method,
      p: METHODS[method].params.map((ps) => pick(rnd, ps)),
      when: pick(rnd, OPTIONS.when),
      trend: pick(rnd, OPTIONS.trend),
      maxSpread: pick(rnd, OPTIONS.maxSpread),
      minAtr: pick(rnd, OPTIONS.minAtr),
      stopK: 0,
      targetR: 0,
      maxMin: method === "ia" || rnd() < 0.15 ? pick(rnd, OPTIONS.ladderMaxMin) : pick(rnd, OPTIONS.ladderMaxMin.filter((x) => x > 0)),
      beAt: 0,
      ladder: randomLadder(rnd),
    };
  return {
    method,
    p: METHODS[method].params.map((ps) => pick(rnd, ps)),
    when: pick(rnd, OPTIONS.when),
    trend: pick(rnd, OPTIONS.trend),
    maxSpread: pick(rnd, OPTIONS.maxSpread),
    minAtr: pick(rnd, OPTIONS.minAtr),
    stopK: pick(rnd, OPTIONS.stopK),
    targetR: pick(rnd, OPTIONS.targetR),
    maxMin: method === "ia" || rnd() < 0.15 ? pick(rnd, OPTIONS.maxMin) : pick(rnd, OPTIONS.maxMin.filter((x) => x > 0)),
    beAt: pick(rnd, OPTIONS.beAt),
  };
}
function mutate(rnd: () => number, r0: SRule): SRule {
  const r: SRule = structuredClone(r0);
  const n = 1 + Math.floor(rnd() * 2);
  for (let k = 0; k < n; k++) {
    const which = Math.floor(rnd() * 9);
    if (which === 0) {
      const i = Math.floor(rnd() * r.p.length);
      if (r.p.length) r.p[i] = pick(rnd, METHODS[r.method].params[i]);
    } else if (which === 1) r.when = pick(rnd, OPTIONS.when);
    else if (which === 2) r.trend = pick(rnd, OPTIONS.trend);
    else if (which === 3) r.maxSpread = pick(rnd, OPTIONS.maxSpread);
    else if (which === 4) r.minAtr = pick(rnd, OPTIONS.minAtr);
    else if (which === 5) r.stopK = pick(rnd, OPTIONS.stopK);
    else if (which === 6) r.targetR = pick(rnd, OPTIONS.targetR);
    else if (which === 7) r.maxMin = pick(rnd, r.ladder ? OPTIONS.ladderMaxMin : OPTIONS.maxMin);
    else r.beAt = pick(rnd, OPTIONS.beAt);
    if (r.ladder && which >= 5 && rnd() < 0.7) {
      // a ladder refines its own settings instead of a stop and target
      const lad = randomLadder(rnd);
      const q = Math.floor(rnd() * 3);
      r.ladder = r.ladder.map((v, x) => (x === q ? lad[x] : v));
    }
  }
  if (r.ladder) (r.stopK = 0), (r.targetR = 0), (r.beAt = 0);
  return r;
}
const loadState = (f: string): ScalpState => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { version: 1, updatedAt: 0, nights: 0, tried: 0, entries: [], champion: null });

async function worker() {
  await loadAI();
  const state = loadState(opt("state", "scalp.json"));
  const out = opt("out", "s.jsonl");
  const k = Number(opt("worker", "0")), W = Number(opt("workers", "1"));
  const deadline = NOW + Number(opt("minutes", "30")) * 60000;
  const cap = Number(opt("cap", "3000"));
  writeFileSync(out, "");
  const write = (e: Entry) => appendFileSync(out, JSON.stringify(e) + "\n");
  // 1. re-judge the qualified rules on today's data (their live days grow)
  state.entries.filter((e) => e.status === "qualifiée" || e.status === "confirmée").filter((_e, i) => i % W === k).forEach((e) => {
    const m = judge(e.rule, e.foundAt, true);
    write({ ...e, m, status: statusOf(m), checkedAt: NOW });
  });
  // 2. search: half random, half refinements of the best
  const seen = new Set(state.entries.map((e) => e.id));
  const parents = state.entries.filter((e) => e.status !== "rejetée").sort((a, b) => b.m.score - a.m.score).slice(0, 40);
  const rnd = mulberry(Math.floor(NOW / DAY) * 7919 + k);
  let tried = 0;
  while (Date.now() < deadline && tried < cap) {
    const parent = parents.length && rnd() < 0.5 ? parents[Math.floor(Math.pow(rnd(), 2) * parents.length)] : null;
    const rule = parent ? mutate(rnd, parent.rule) : randomRule(rnd);
    const id = idOf(rule);
    if (seen.has(id)) continue;
    seen.add(id);
    let m = judge(rule, NOW, false);
    if (statusOf(m) === "qualifiée") m = judge(rule, NOW, true);
    write({ id, rule, foundAt: NOW, origin: parent ? `affinage de ${parent.id}` : "hasard", m, status: statusOf(m), checkedAt: NOW });
    tried++;
  }
  console.log(`scalping : ${tried} règles essayées (IA 2 h ${aiReady ? "chargée" : "absente"})`);
}

function merge() {
  const file = opt("state", "scalp.json");
  const state = loadState(file);
  const byId = new Map(state.entries.map((e) => [e.id, e]));
  let tried = 0;
  const dir = opt("merge", "parts");
  for (const f of readdirSync(dir, { recursive: true }) as string[]) {
    if (!f.endsWith(".jsonl") || !f.split("/").pop()!.startsWith("s-")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const e = JSON.parse(line) as Entry;
      const old = byId.get(e.id);
      if (old) e.foundAt = Math.min(old.foundAt, e.foundAt);
      else tried++;
      byId.set(e.id, e);
    }
  }
  const all = [...byId.values()];
  const keep = new Set(all.filter((e) => e.status === "qualifiée" || e.status === "confirmée").map((e) => e.id));
  all.filter((e) => e.status !== "rejetée").sort((a, b) => b.m.score - a.m.score).slice(0, 300).forEach((e) => keep.add(e.id));
  state.entries = all.filter((e) => keep.has(e.id)).sort((a, b) => b.m.score - a.m.score);
  state.nights++;
  state.tried += tried;
  state.updatedAt = Date.now();
  const yearly = (e: Entry) => (e.m.valid.sumR + e.m.live.sumR) / Math.max(0.25, (e.m.valid.days + e.m.live.days) / 365);
  const confirmed = state.entries.filter((e) => e.status === "confirmée").sort((a, b) => yearly(b) - yearly(a));
  state.champion = confirmed[0]?.id ?? null;
  writeFileSync(file, JSON.stringify(state));
  const qualified = state.entries.filter((e) => e.status === "qualifiée" || e.status === "confirmée").sort((a, b) => yearly(b) - yearly(a));
  const fR = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}R`;
  const row = (e: Entry) =>
    `| ${e.id} | ${e.status} | ${e.m.perDay.toFixed(1)} | ${fR(e.m.train.sumR)} (pf ${e.m.train.pf.toFixed(2)}) | ${fR(e.m.valid.sumR)} (pf ${e.m.valid.pf.toFixed(2)}) | ${e.m.live.days >= 1 ? `${fR(e.m.live.sumR)} sur ${e.m.live.days.toFixed(0)} j` : "—"} | ${e.m.dd.toFixed(0)}R | ${e.m.stress !== undefined ? fR(e.m.stress) : "—"} | ${describe(e.rule)} |`;
  const head = "| Règle | Statut | Trades/jour | Avant 2025 | 2025 → découverte | En direct | Pire repli | Écart ×1,5 | Réglages |\n|---|---|---|---|---|---|---|---|---|";
  const d = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const md = [
    `# Labo scalping AURUM : nuit ${state.nights}`,
    "",
    `Données : or minute par minute du ${d(T[0])} au ${d(T[N - 1])}, écart réel de chaque minute. Cette nuit : ${tried} règles essayées ; depuis le début : ${state.tried}. Qualifiées : ${qualified.length}. Confirmées : ${confirmed.length}.`,
    "",
    "Méthode : classement avant 2025 seulement (au moins 100 trades par an, 60 % des semestres gagnants) ; qualifiée si 2025 → jour de découverte gagne aussi ; confirmée après au moins 30 jours et 20 trades gagnants sur des prix nouveaux, et encore gagnante avec un écart 50 % plus large ; retirée si elle perd 5R sur 20 trades nouveaux, ou 10R à tout moment.",
    "",
    "## Champion du scalping",
    "",
    state.champion ? `${state.champion} : ${describe(state.entries.find((e) => e.id === state.champion)!.rule)}` : "Aucun pour l'instant.",
    "",
    "## Qualifiées",
    "",
    qualified.length ? head : "Aucune pour l'instant.",
    ...qualified.slice(0, 15).map(row),
    "",
    "## Échelles de petites positions (l'idée du propriétaire)",
    "",
    "Jusqu'à 10 positions sur un même signal, une de plus à chaque recul, chacune avec un petit objectif. En R de la plus grosse perte possible de l'échelle.",
    "",
    head,
    ...state.entries.filter((e) => e.rule.ladder && e.status !== "rejetée").slice(0, 10).map(row),
    "",
    "## Meilleures avant 2025 (pas encore validées)",
    "",
    head,
    ...state.entries.filter((e) => e.status === "candidate").slice(0, 10).map(row),
    "",
  ].join("\n");
  writeFileSync(opt("report", "scalp.md"), md);
  console.log(md);
}

if (args.includes("--merge")) merge();
else worker();
