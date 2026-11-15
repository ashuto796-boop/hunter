// The owner's idea: 1-minute scalping for small profits (4-5 € a position), ten positions at a time,
// several times a day. Two ways to hold ten positions, both on 4 years of 1-minute gold with the
// real spread of every minute:
//   "panier": ten positions opened together, each closing at its own small target or the stop;
//   "échelle": one position, then one more each time price goes `step` $ against, up to ten, each
//              closing at its own small target; the whole ladder is cut at a final stop.
// Results in dollars per ounce held (1 oz = 0.01 lot ~ 1 $ per dollar of move), so 4-5 € of profit
// per 0.01-lot position means a target of about 5 $.
//
//   npx tsx backtest/scalp_basket.ts --m1 xau_m1_4y.json
import { readFileSync } from "fs";

const args = process.argv.slice(2);
const raw = JSON.parse(readFileSync(args[args.indexOf("--m1") + 1], "utf8")) as number[][];
const N = raw.length;
const T = new Float64Array(N), O = new Float64Array(N), H = new Float64Array(N), L = new Float64Array(N), C = new Float64Array(N), S = new Float64Array(N);
raw.forEach((r, i) => ((T[i] = r[0]), (O[i] = r[1]), (H[i] = r[2]), (L[i] = r[3]), (C[i] = r[4]), (S[i] = Math.max(0, r[5]))));
const SPLIT = Date.UTC(2025, 0, 1) / 1000;
const days = ((T[N - 1] - T[0]) / 86400) * (5 / 7);
const e20 = new Float64Array(N), e200 = new Float64Array(N);
e20[0] = e200[0] = C[0];
for (let i = 1; i < N; i++) (e20[i] = e20[i - 1] + (2 / 21) * (C[i] - e20[i - 1])), (e200[i] = e200[i - 1] + (2 / 201) * (C[i] - e200[i - 1]));
const ny = (i: number) => {
  const h = new Date(T[i] * 1000).getUTCHours();
  return h >= 7 && h < 17; // London + New York, roughly, in UTC
};
// entry: a 1-minute pullback to the 20-minute average in the direction of the 200-minute average
const signal = (i: number): 1 | -1 | 0 =>
  !ny(i) || S[i] > 1 ? 0 : e20[i] > e200[i] && L[i] <= e20[i] && C[i] > e20[i] ? 1 : e20[i] < e200[i] && H[i] >= e20[i] && C[i] < e20[i] ? -1 : 0;

interface Out { pnl: number; t: number; exit: number; worst: number }
// ten positions at once, each closing at target or stop (same entry, so they behave as one)
function basket(i: number, d: 1 | -1, target: number, stop: number, n: number): Out | null {
  const k = i + 1;
  if (k >= N || T[k] - T[i] > 300) return null;
  const entry = O[k] + (d * S[i]) / 2;
  let worst = 0;
  for (let j = k; j < N && j < k + 240; j++) {
    const half = S[j] / 2;
    const adv = d === 1 ? L[j] - half - entry : entry - (H[j] + half);
    const fav = d === 1 ? H[j] - half - entry : entry - (L[j] + half);
    worst = Math.min(worst, adv * n);
    if (adv <= -stop) return { pnl: -stop * n, t: T[k], exit: j, worst };
    if (fav >= target) return { pnl: target * n, t: T[k], exit: j, worst };
  }
  const j = Math.min(N - 1, k + 240);
  return { pnl: (d * (C[j] - entry) - S[j] / 2) * n, t: T[k], exit: j, worst };
}
// ladder: add one position every `step` $ against, up to n; each closes at its own target; the
// ladder is cut when price goes `step` beyond the last one (final stop) or after 8 hours
function ladder(i: number, d: 1 | -1, target: number, step: number, n: number): Out | null {
  const k = i + 1;
  if (k >= N || T[k] - T[i] > 300) return null;
  const open: number[] = [O[k] + (d * S[i]) / 2];
  let pnl = 0, worst = 0, added = 1;
  for (let j = k; j < N && j < k + 480; j++) {
    const half = S[j] / 2;
    const bid = C[j] - half, ask = C[j] + half;
    const lowSide = d === 1 ? L[j] - half : H[j] + half; // worst exit price this minute
    const highSide = d === 1 ? H[j] - half : L[j] + half; // best exit price this minute
    // each open position takes its profit
    for (let p = open.length - 1; p >= 0; p--)
      if (d * (highSide - open[p]) >= target) {
        pnl += target;
        open.splice(p, 1);
      }
    // add a rung when price went another step against the last entry
    const last = open.length ? open[open.length - 1] : null;
    if (last !== null && added < n && d * (lowSide - last) <= -step) {
      open.push(last - d * step + (d * S[j]) / 2);
      added++;
    }
    const floating = open.reduce((s, e) => s + d * ((d === 1 ? bid : ask) - e), 0);
    worst = Math.min(worst, pnl + floating);
    // final stop: all rungs used and price one more step against
    if (added >= n && open.length && d * (lowSide - open[open.length - 1]) <= -step) {
      const cut = open.reduce((s, e) => s + d * (open[open.length - 1] - d * step - e), 0);
      return { pnl: pnl + cut, t: T[k], exit: j, worst };
    }
    if (!open.length) return { pnl, t: T[k], exit: j, worst };
  }
  const j = Math.min(N - 1, k + 480);
  const half = S[j] / 2;
  return { pnl: pnl + open.reduce((s, e) => s + d * ((d === 1 ? C[j] - half : C[j] + half) - e), 0), t: T[k], exit: j, worst };
}

function report(name: string, xs: Out[]) {
  const half = (a: Out[]) => {
    const w = a.filter((x) => x.pnl > 0).length;
    const sum = a.reduce((s, x) => s + x.pnl, 0);
    return `${String(a.length).padStart(5)} séries, ${a.length ? ((w / a.length) * 100).toFixed(0) : "—"} % gagnantes, total ${(sum >= 0 ? "+" : "") + sum.toFixed(0)} $`;
  };
  let eq = 0, pk = 0, dd = 0;
  for (const x of xs) (eq += x.pnl), (pk = Math.max(pk, eq)), (dd = Math.max(dd, pk - eq));
  const worstOne = Math.min(...xs.map((x) => x.pnl));
  console.log(`${name.padEnd(54)} ${(xs.length / days).toFixed(1)}/j | 2022-24 ${half(xs.filter((x) => x.t < SPLIT))} | 2025-26 ${half(xs.filter((x) => x.t >= SPLIT))} | pire série ${worstOne.toFixed(0)} $ | pire creux ${dd.toFixed(0)} $`);
}
console.log(`Tout en dollars pour 10 positions de 1 once (0,01 lot chacune). ${days.toFixed(0)} jours ouvrés.\n`);
console.log("== 10 positions ouvertes d'un coup (panier)");
for (const target of [0.5, 1, 2, 5])
  for (const stop of [2, 5, 10]) {
    const xs: Out[] = [];
    for (let i = 300; i < N - 2; i++) {
      const d = signal(i);
      if (!d) continue;
      const o = basket(i, d, target, stop, 10);
      if (!o) continue;
      xs.push(o);
      i = o.exit;
    }
    report(`objectif ${target} $ (≈ ${(target * 0.92).toFixed(1)} € par position), stop ${stop} $`, xs);
  }
console.log("\n== 10 positions en échelle (une de plus tous les `pas` $ contre nous)");
for (const target of [0.5, 1, 2, 5])
  for (const step of [1, 2, 5]) {
    const xs: Out[] = [];
    for (let i = 300; i < N - 2; i++) {
      const d = signal(i);
      if (!d) continue;
      const o = ladder(i, d, target, step, 10);
      if (!o) continue;
      xs.push(o);
      i = o.exit;
    }
    report(`objectif ${target} $ par position, pas ${step} $`, xs);
  }
