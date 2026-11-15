// AURUM's own scalping idea: scalp only in the direction of the 2-hour AI.
//
// 1-minute gold alone shows no edge over the spread (backtest/edge_m1.ts). The 2-hour AI does
// (5 years walk-forward). So: while the 2-hour AI holds a position, take short 1-minute trades in
// the same direction, entered on small pullbacks with a tight stop. The same scalps taken outside
// the AI's positions are the control: if the edge comes from the AI, they must do worse.
//
//   npx tsx backtest/scalp_ai.ts --wf --data <M15 dir> --m1 xau_m1_4y.json
import { readFileSync } from "fs";
import { evaluate } from "./research";
import { AURUM_2H, Strategy } from "../src/gold/engine/strategy";
import { Trade } from "../src/gold/engine/types";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const raw = JSON.parse(readFileSync(opt("m1", ""), "utf8")) as number[][];
const N = raw.length;
const T = new Float64Array(N), O = new Float64Array(N), H = new Float64Array(N), L = new Float64Array(N), C = new Float64Array(N), S = new Float64Array(N);
raw.forEach((r, i) => ((T[i] = r[0]), (O[i] = r[1]), (H[i] = r[2]), (L[i] = r[3]), (C[i] = r[4]), (S[i] = Math.max(0, r[5]))));
const SPLIT = Date.UTC(2025, 0, 1) / 1000;
const atr = new Float64Array(N);
for (let i = 1; i < N; i++) atr[i] = atr[i - 1] + (Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])) - atr[i - 1]) / 60;
const ema = (n: number) => {
  const out = new Float64Array(N);
  const k = 2 / (n + 1);
  out[0] = C[0];
  for (let i = 1; i < N; i++) out[i] = out[i - 1] + k * (C[i] - out[i - 1]);
  return out;
};
const idx = (tSec: number) => {
  let lo = 0, hi = N;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (T[m] < tSec) lo = m + 1;
    else hi = m;
  }
  return lo;
};

interface Res { r: number; t: number; exit: number }
function trade(i: number, dir: 1 | -1, stop: number, targetR: number, maxMin: number, until: number): Res | null {
  const k = i + 1;
  if (k >= N || T[k] - T[i] > 300) return null;
  const entry = O[k] + (dir * S[i]) / 2;
  const sl = entry - dir * stop, tp = entry + dir * targetR * stop;
  for (let j = k; j < N && j <= k + maxMin; j++) {
    const half = S[j] / 2;
    if (j > k && T[j] - T[j - 1] > 300) return { r: (dir * (C[j - 1] - (dir * S[j - 1]) / 2 - entry)) / stop, t: T[k], exit: j - 1 };
    if (dir * ((dir === 1 ? L[j] - half : H[j] + half) - sl) <= 0) return { r: (dir * ((dir === 1 ? Math.min(sl, O[j] - half) : Math.max(sl, O[j] + half)) - entry)) / stop, t: T[k], exit: j };
    if (dir * ((dir === 1 ? H[j] - half : L[j] + half) - tp) >= 0) return { r: targetR, t: T[k], exit: j };
    if (T[j] >= until) return { r: (dir * (C[j] - (dir * S[j]) / 2 - entry)) / stop, t: T[k], exit: j }; // the AI closed: so do we
  }
  const j = Math.min(N - 1, k + maxMin);
  return { r: (dir * (C[j] - (dir * S[j]) / 2 - entry)) / stop, t: T[k], exit: j };
}

// Entry styles inside a window, all in the window's direction
type Style = { name: string; sig: (i: number, d: 1 | -1) => boolean };
const e20 = ema(20), e50 = ema(50);
const styles: Style[] = [
  { name: "repli sur la moyenne 20 min", sig: (i, d) => (d === 1 ? L[i] <= e20[i] && C[i] > e20[i] && C[i] > O[i] : H[i] >= e20[i] && C[i] < e20[i] && C[i] < O[i]) },
  { name: "repli sur la moyenne 50 min", sig: (i, d) => (d === 1 ? L[i] <= e50[i] && C[i] > e50[i] && C[i] > O[i] : H[i] >= e50[i] && C[i] < e50[i] && C[i] < O[i]) },
  {
    name: "creux/sommet de 15 min balayé puis repris",
    sig: (i, d) => {
      if (i < 16) return false;
      let lo = Infinity, hi = -Infinity;
      for (let j = i - 15; j < i; j++) (lo = Math.min(lo, L[j])), (hi = Math.max(hi, H[j]));
      return d === 1 ? L[i] < lo && C[i] > lo : H[i] > hi && C[i] < hi;
    },
  },
  { name: "chaque 15 min (sans signal)", sig: (i) => T[i] % 900 === 0 },
];

async function windows(name: string, rules: Partial<Strategy>, tf: number, threshold: number, trainDays: number) {
  const r = await evaluate({ name, tf, threshold, rules: { ...rules, fixedThreshold: threshold, financingPctYear: 5 }, settings: { trainDays, maxTradesDay: 4 } });
  return r.trades.filter((t: Trade) => t.openTime / 1000 >= T[0]);
}

(async () => {
  const { fit: _f, ...ai2h } = AURUM_2H;
  const trades = await windows("AURUM 2 h", ai2h, 120, 30, 365);
  console.log(`IA 2 h : ${trades.length} positions sur la période des données minute`);
  const base = trades.filter((t) => t.openTime / 1000 < SPLIT);
  const ai = (ts: Trade[]) => `${ts.length} trades ${ts.reduce((s, t) => s + t.r, 0).toFixed(1)}R`;
  console.log(`  ses propres trades : 2022-24 ${ai(base)} · 2025-26 ${ai(trades.filter((t) => t.openTime / 1000 >= SPLIT))}`);
  // minute-level map of the AI's direction
  const dirAt = new Int8Array(N), untilAt = new Float64Array(N);
  for (const t of trades) {
    const a = idx(t.openTime / 1000), b = idx(t.closeTime / 1000);
    for (let i = a; i < b && i < N; i++) (dirAt[i] = t.dir), (untilAt[i] = t.closeTime / 1000);
  }
  const fmt = (xs: Res[]) => {
    const g = xs.reduce((s, x) => s + (x.r > 0 ? x.r : 0), 0), l = -xs.reduce((s, x) => s + (x.r < 0 ? x.r : 0), 0);
    return `${String(xs.length).padStart(5)} tr ${(xs.reduce((s, x) => s + x.r, 0) >= 0 ? "+" : "") + xs.reduce((s, x) => s + x.r, 0).toFixed(1).padStart(6)}R pf ${(l ? g / l : 0).toFixed(2)}`;
  };
  const days = ((T[N - 1] - T[0]) / 86400) * (5 / 7);
  for (const st of styles)
    for (const stopK of (opt("stops", "5,10,20")).split(",").map(Number))
      for (const tr of (opt("targets", "1,2,3")).split(",").map(Number))
        for (const mx of (opt("maxes", "30,120")).split(",").map(Number)) {
          const inside: Res[] = [], outside: Res[] = [];
          for (const [list, wantInside] of [[inside, true], [outside, false]] as const) {
            for (let i = 100; i < N - 2; i++) {
              const d = dirAt[i] as -1 | 0 | 1;
              if (wantInside ? !d : d) continue;
              // control: outside the AI's positions, take the scalp in the direction of the AI's last trade
              const dir = (d || (Math.sign(e50[i] - e50[i - 60]) as -1 | 1)) as 1 | -1;
              if (!dir || S[i] > 1.2 || !st.sig(i, dir)) continue;
              const stop = stopK * atr[i];
              if (stop < 2 * S[i]) continue;
              const res = trade(i, dir, stop, tr, mx, wantInside ? untilAt[i] : Infinity);
              if (!res) continue;
              list.push(res);
              i = res.exit;
            }
          }
          const a = inside.filter((x) => x.t < SPLIT), b = inside.filter((x) => x.t >= SPLIT);
          console.log(`${st.name.padEnd(42)} stop ${stopK} ATR obj ${tr}R ${String(mx).padStart(3)} min | ${(inside.length / days).toFixed(1)}/j | dans le sens de l'IA : 2022-24 ${fmt(a)} · 2025-26 ${fmt(b)} | hors IA (contrôle) ${fmt(outside)}`);
        }
})();
