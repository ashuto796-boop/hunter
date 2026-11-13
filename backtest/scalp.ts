// Scalping research on 1-minute gold candles with the real spread of every minute (Dukascopy bid
// and ask, backtest/dukascopy.py --m1). Each method is a family of rules; every rule set is judged
// on the first half of the data (where it is chosen) and confirmed on the second half (never used
// to choose). Trades pay the real spread: a buy fills at the ask and exits at the bid. When the
// stop and the target are both reachable within the same minute, the stop is assumed first.
//
//   npx tsx backtest/scalp.ts --data backtest/scalp-data/xau_m1.json [--top 15] [--spread 1.2]
//
// Result on 2 years (Nov 2024 - Nov 2026, median spread 0.60 $): none of the 104 rule sets made
// money on both halves; the frequent ones (2 to 9 trades a day) all lost, paying 0.2 to 0.3 R of
// spread per trade.
import { readFileSync } from "fs";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const raw = JSON.parse(readFileSync(opt("data", "backtest/scalp-data/xau_m1.json"), "utf8")) as number[][];
const N = raw.length;
const T = new Float64Array(N), O = new Float64Array(N), H = new Float64Array(N), L = new Float64Array(N), C = new Float64Array(N), S = new Float64Array(N);
raw.forEach((r, i) => {
  T[i] = r[0];
  O[i] = r[1];
  H[i] = r[2];
  L[i] = r[3];
  C[i] = r[4];
  S[i] = Math.max(0, r[5]);
});
const SPLIT = T[Math.floor(N / 2)];
const days = (T[N - 1] - T[0]) / 86400;
const tradingDays = (days * 5) / 7;

// --- local clock of London and New York (daylight saving included) ---------------------------------
const lastSunday = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m + 1, 0));
  return Date.UTC(y, m, d.getUTCDate() - d.getUTCDay());
};
const nthSunday = (y: number, m: number, n: number) => {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return Date.UTC(y, m, 1 + ((7 - first) % 7) + 7 * (n - 1));
};
const ukOffset = (ms: number) => {
  const y = new Date(ms).getUTCFullYear();
  return ms >= lastSunday(y, 2) + 3600e3 && ms < lastSunday(y, 9) + 3600e3 ? 1 : 0;
};
const usOffset = (ms: number) => {
  const y = new Date(ms).getUTCFullYear();
  return ms >= nthSunday(y, 2, 2) + 7 * 3600e3 && ms < nthSunday(y, 10, 1) + 6 * 3600e3 ? -4 : -5;
};
const LON = new Int16Array(N); // minutes since London midnight
const NY = new Int16Array(N);
const DAY = new Int32Array(N); // New York trading day (rolls at 17:00 New York)
for (let i = 0; i < N; i++) {
  const ms = T[i] * 1000;
  const lon = new Date(ms + ukOffset(ms) * 3600e3);
  const ny = new Date(ms + usOffset(ms) * 3600e3);
  LON[i] = lon.getUTCHours() * 60 + lon.getUTCMinutes();
  NY[i] = ny.getUTCHours() * 60 + ny.getUTCMinutes();
  DAY[i] = Math.floor((ms + usOffset(ms) * 3600e3 + 7 * 3600e3) / 864e5);
}

// --- indicators on 1-minute closes -----------------------------------------------------------------
function ema(src: Float64Array, n: number) {
  const out = new Float64Array(N);
  const k = 2 / (n + 1);
  out[0] = src[0];
  for (let i = 1; i < N; i++) out[i] = out[i - 1] + k * (src[i] - out[i - 1]);
  return out;
}
function atr(n: number) {
  const out = new Float64Array(N);
  out[0] = H[0] - L[0];
  for (let i = 1; i < N; i++) {
    const tr = Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
    out[i] = out[i - 1] + (tr - out[i - 1]) / n;
  }
  return out;
}
const ATR = atr(14);
const ATR60 = atr(60);
const cache = new Map<number, Float64Array>();
const E = (n: number) => {
  if (!cache.has(n)) cache.set(n, ema(C, n));
  return cache.get(n)!;
};
const gap = (i: number) => i > 0 && T[i] - T[i - 1] > 300; // the market paused (rollover, weekend)

// --- one trade, real spread ------------------------------------------------------------------------
interface Res {
  r: number;
  exit: number; // bar index where the trade ended
  t: number;
  cost: number; // spread paid, in R
}
function trade(i: number, dir: 1 | -1, stopDist: number, targetR: number, maxMin: number, beAt = 0): Res | null {
  const k = i + 1;
  if (k >= N || gap(k)) return null;
  const entry = O[k] + (dir * S[i]) / 2;
  let stop = entry - dir * stopDist;
  const risk = stopDist;
  const target = entry + dir * targetR * risk;
  for (let j = k; j < N && j <= k + maxMin; j++) {
    if (j > k && gap(j)) return { r: (dir * (C[j - 1] - (dir * S[j - 1]) / 2 - entry)) / risk, exit: j - 1, t: T[k], cost: S[i] / risk };
    const half = S[j] / 2;
    const adverse = dir === 1 ? L[j] - half : H[j] + half;
    const favor = dir === 1 ? H[j] - half : L[j] + half;
    if (dir * (adverse - stop) <= 0) {
      const fill = dir === 1 ? Math.min(stop, O[j] - half) : Math.max(stop, O[j] + half); // a gap fills worse
      return { r: (dir * (fill - entry)) / risk, exit: j, t: T[k], cost: S[i] / risk };
    }
    if (dir * (favor - target) >= 0) return { r: targetR, exit: j, t: T[k], cost: S[i] / risk };
    if (beAt > 0 && dir * (favor - (entry + dir * beAt * risk)) >= 0 && dir * (stop - entry) < 0) stop = entry;
  }
  const j = Math.min(N - 1, k + maxMin);
  return { r: (dir * (C[j] - (dir * S[j]) / 2 - entry)) / risk, exit: j, t: T[k], cost: S[i] / risk };
}

// --- methods ----------------------------------------------------------------------------------------
type Signal = (i: number) => { dir: 1 | -1; stop: number } | null;
interface Rule {
  name: string;
  family: string;
  signal: Signal;
  targetR: number;
  maxMin: number;
  beAt?: number;
  maxSpread: number;
  hours?: (i: number) => boolean;
}
const london = (i: number) => LON[i] >= 7 * 60 && LON[i] < 11 * 60 + 30;
const newYork = (i: number) => NY[i] >= 8 * 60 && NY[i] < 12 * 60;
const active = (i: number) => london(i) || newYork(i);
const anyHour = (i: number) => !(NY[i] >= 16 * 60 + 45 && NY[i] < 18 * 60 + 15);

// Opening range breakout: the first `len` minutes after an open set a range; a close beyond it
// is followed, stop at the far side (capped), once per session.
function orb(open: "londres" | "new york", len: number): Signal {
  const isLon = open === "londres";
  const startMin = isLon ? 8 * 60 : 9 * 60 + 30;
  let day = -1;
  let hi = 0;
  let lo = 0;
  let done = false;
  return (i) => {
    const clock = isLon ? LON[i] : NY[i];
    if (DAY[i] !== day) {
      day = DAY[i];
      hi = -Infinity;
      lo = Infinity;
      done = false;
    }
    if (clock >= startMin && clock < startMin + len) {
      hi = Math.max(hi, H[i]);
      lo = Math.min(lo, L[i]);
      return null;
    }
    if (done || clock < startMin + len || clock > startMin + 180 || !Number.isFinite(hi)) return null;
    const range = hi - lo;
    if (range <= 0) return null;
    if (C[i] > hi) {
      done = true;
      return { dir: 1, stop: Math.min(range, 3 * ATR[i]) };
    }
    if (C[i] < lo) {
      done = true;
      return { dir: -1, stop: Math.min(range, 3 * ATR[i]) };
    }
    return null;
  };
}
// Momentum burst: a minute much larger than usual closing near its extreme is followed.
function burst(mult: number, stopAtr: number): Signal {
  return (i) => {
    const r = H[i] - L[i];
    if (r < mult * ATR60[i] || r <= 0) return null;
    const pos = (C[i] - L[i]) / r;
    if (pos > 0.8) return { dir: 1, stop: stopAtr * ATR[i] };
    if (pos < 0.2) return { dir: -1, stop: stopAtr * ATR[i] };
    return null;
  };
}
// Snap-back: price stretched far from its 20-minute average is faded.
function fade(dev: number, stopAtr: number): Signal {
  const e = E(20);
  return (i) => {
    const d = (C[i] - e[i]) / ATR60[i];
    if (d > dev) return { dir: -1, stop: stopAtr * ATR60[i] };
    if (d < -dev) return { dir: 1, stop: stopAtr * ATR60[i] };
    return null;
  };
}
// Trend pullback: fast average above slow, price dips to the slow one and closes back up.
function pullback(fast: number, slow: number, stopAtr: number): Signal {
  const f = E(fast);
  const s = E(slow);
  const trend = E(200);
  return (i) => {
    if (f[i] > s[i] && C[i] > trend[i] && L[i] <= s[i] && C[i] > s[i] && C[i] > O[i]) return { dir: 1, stop: stopAtr * ATR[i] };
    if (f[i] < s[i] && C[i] < trend[i] && H[i] >= s[i] && C[i] < s[i] && C[i] < O[i]) return { dir: -1, stop: stopAtr * ATR[i] };
    return null;
  };
}
// Liquidity sweep: the high (low) of the last `look` minutes is pierced then the minute closes
// back inside: fade the false break.
function sweep(look: number, stopAtr: number): Signal {
  return (i) => {
    if (i < look + 1) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - look; j < i; j++) {
      hi = Math.max(hi, H[j]);
      lo = Math.min(lo, L[j]);
    }
    if (H[i] > hi && C[i] < hi && C[i] < O[i]) return { dir: -1, stop: H[i] - C[i] + stopAtr * ATR[i] };
    if (L[i] < lo && C[i] > lo && C[i] > O[i]) return { dir: 1, stop: C[i] - L[i] + stopAtr * ATR[i] };
    return null;
  };
}

const rules: Rule[] = [];
for (const spread of [Number(opt("spread", "1.2"))]) {
  for (const open of ["londres", "new york"] as const)
    for (const len of [5, 15, 30])
      for (const tr of [1, 1.5, 2])
        for (const mx of [30, 90])
          rules.push({ family: "cassure d'ouverture", name: `ouverture ${open} ${len} min, obj ${tr}R, ${mx} min`, signal: orb(open, len), targetR: tr, maxMin: mx, maxSpread: spread });
  for (const mult of [2.5, 3.5])
    for (const st of [1, 2])
      for (const tr of [1, 2])
        for (const hrs of ["actives", "toutes"] as const)
          rules.push({ family: "élan", name: `élan ×${mult}, stop ${st} ATR, obj ${tr}R, heures ${hrs}`, signal: burst(mult, st), targetR: tr, maxMin: 30, maxSpread: spread, hours: hrs === "actives" ? active : anyHour });
  for (const dev of [2.5, 3.5, 5])
    for (const st of [1.5, 2.5])
      for (const tr of [0.7, 1.2])
        for (const hrs of ["actives", "toutes"] as const)
          rules.push({ family: "retour à la moyenne", name: `écart ${dev} ATR, stop ${st} ATR, obj ${tr}R, heures ${hrs}`, signal: fade(dev, st), targetR: tr, maxMin: 30, maxSpread: spread, hours: hrs === "actives" ? active : anyHour });
  for (const [f, s] of [[9, 21], [20, 50]])
    for (const st of [1.5, 2.5])
      for (const tr of [1, 2])
        for (const be of [0, 1])
          rules.push({ family: "repli de tendance", name: `moyennes ${f}/${s}, stop ${st} ATR, obj ${tr}R${be ? ", BE à 1R" : ""}`, signal: pullback(f, s, st), targetR: tr, maxMin: 45, beAt: be, maxSpread: spread, hours: active });
  for (const look of [30, 60, 120])
    for (const st of [0.5, 1])
      for (const tr of [1, 2])
        rules.push({ family: "chasse aux stops", name: `sommet/creux ${look} min, marge ${st} ATR, obj ${tr}R`, signal: sweep(look, st), targetR: tr, maxMin: 45, maxSpread: spread, hours: active });
}

function run(rule: Rule) {
  const out: Res[] = [];
  for (let i = 300; i < N - 2; i++) {
    const sig = rule.signal(i); // stateful signals must see every minute
    if (!sig || gap(i + 1) || S[i] > rule.maxSpread || (rule.hours && !rule.hours(i))) continue;
    if (!(sig.stop > 2 * S[i])) continue; // a stop inside the spread is not a trade
    const res = trade(i, sig.dir, sig.stop, rule.targetR, rule.maxMin, rule.beAt);
    if (!res) continue;
    out.push(res);
    for (let j = i + 1; j <= res.exit; j++) rule.signal(j); // one position at a time, signals keep their state
    i = res.exit;
  }
  return out;
}

const stats = (xs: Res[]) => {
  let gp = 0;
  let gl = 0;
  let sum = 0;
  let cost = 0;
  let wins = 0;
  for (const x of xs) {
    sum += x.r;
    cost += x.cost;
    if (x.r > 0) {
      gp += x.r;
      wins++;
    } else gl -= x.r;
  }
  return { n: xs.length, sum, pf: gl ? gp / gl : 0, win: xs.length ? wins / xs.length : 0, cost: xs.length ? cost / xs.length : 0 };
};
const dd = (xs: Res[]) => {
  let eq = 0;
  let peak = 0;
  let m = 0;
  for (const x of xs) {
    eq += x.r;
    peak = Math.max(peak, eq);
    m = Math.max(m, peak - eq);
  }
  return m;
};

console.log(`${N} minutes, ${tradingDays.toFixed(0)} jours ouvrés, du ${new Date(T[0] * 1000).toISOString().slice(0, 10)} au ${new Date(T[N - 1] * 1000).toISOString().slice(0, 10)}, écart médian ${[...S].sort((a, b) => a - b)[N >> 1].toFixed(3)} $`);
const rows = rules.map((rule) => {
  const xs = run(rule);
  const a = xs.filter((x) => x.t < SPLIT);
  const b = xs.filter((x) => x.t >= SPLIT);
  return { rule, a: stats(a), b: stats(b), dd: dd(xs), perDay: xs.length / tradingDays };
});
const fmt = (s: ReturnType<typeof stats>) => `${String(s.n).padStart(5)} tr ${(s.sum >= 0 ? "+" : "") + s.sum.toFixed(1).padStart(6)}R pf ${s.pf.toFixed(2)} ${(s.win * 100).toFixed(0)}%`;
const line = (x: (typeof rows)[number]) => `${x.rule.name.padEnd(58)} ${x.perDay.toFixed(1).padStart(4)}/j | 1re moitié ${fmt(x.a)} | 2e moitié ${fmt(x.b)} | écart ${x.a.cost.toFixed(2)}R/tr | creux ${x.dd.toFixed(0)}R`;
const top = Number(opt("top", "8"));
for (const fam of [...new Set(rules.map((r) => r.family))]) {
  console.log(`\n== ${fam}`);
  rows
    .filter((x) => x.rule.family === fam)
    .sort((p, q) => q.a.sum - p.a.sum)
    .slice(0, top)
    .forEach((x) => console.log(line(x)));
}
const both = rows.filter((x) => x.a.sum > 0 && x.b.sum > 0 && x.a.n >= 50 && x.b.n >= 50);
console.log(`\n== gagnantes sur les deux moitiés (au moins 50 trades chacune) : ${both.length} sur ${rows.length}`);
both.sort((p, q) => q.a.sum + q.b.sum - (p.a.sum + p.b.sum)).forEach((x) => console.log(line(x)));
