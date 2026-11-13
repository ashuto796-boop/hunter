// Scalping research, round 2: more methods, filters and exits on 1-minute gold with the real
// spread of every minute (backtest/dukascopy.py --m1).
//
// Protocol against luck: rule sets are ranked on the first year only. A rule set is kept when it
// also makes money on the second year and on most quarters. Kept rule sets are then run once on
// an older, untouched period (--check, 2022-2024) that played no part in choosing them.
//
//   npx tsx backtest/scalp2.ts --data xau_m1.json [--check xau_m1_old.json] [--top 25]
import { readFileSync } from "fs";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

// ---------------------------------------------------------------------------------------------------
// Market arrays and precomputed context
// ---------------------------------------------------------------------------------------------------
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

interface Mkt {
  N: number;
  T: Float64Array;
  O: Float64Array;
  H: Float64Array;
  L: Float64Array;
  C: Float64Array;
  S: Float64Array;
  LON: Int16Array; // minutes since London midnight
  NY: Int16Array; // minutes since New York midnight
  DAY: Int32Array; // trading day (rolls at 17:00 New York)
  ATR: Float64Array; // 14 minutes
  ATR60: Float64Array; // 60 minutes
  ema: (n: number) => Float64Array;
  pdh: Float64Array; // previous trading day's high / low
  pdl: Float64Array;
  asiaHi: Float64Array; // range of the Asian session of the current day (00:00-07:00 London), once it is over
  asiaLo: Float64Array;
  twap: Float64Array; // average price since the London open (07:00 London) of the current day
  gap: Uint8Array; // 1 when the previous minute is more than 5 minutes back (rollover, weekend)
}

function load(file: string): Mkt {
  const raw = JSON.parse(readFileSync(file, "utf8")) as number[][];
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
  const LON = new Int16Array(N), NY = new Int16Array(N), DAY = new Int32Array(N), gap = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const ms = T[i] * 1000;
    const lon = new Date(ms + ukOffset(ms) * 3600e3);
    const ny = new Date(ms + usOffset(ms) * 3600e3);
    LON[i] = lon.getUTCHours() * 60 + lon.getUTCMinutes();
    NY[i] = ny.getUTCHours() * 60 + ny.getUTCMinutes();
    DAY[i] = Math.floor((ms + usOffset(ms) * 3600e3 + 7 * 3600e3) / 864e5);
    gap[i] = i > 0 && T[i] - T[i - 1] > 300 ? 1 : 0;
  }
  const atr = (n: number) => {
    const out = new Float64Array(N);
    out[0] = H[0] - L[0];
    for (let i = 1; i < N; i++) {
      const tr = Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
      out[i] = out[i - 1] + (tr - out[i - 1]) / n;
    }
    return out;
  };
  const cache = new Map<number, Float64Array>();
  const ema = (n: number) => {
    if (!cache.has(n)) {
      const out = new Float64Array(N);
      const k = 2 / (n + 1);
      out[0] = C[0];
      for (let i = 1; i < N; i++) out[i] = out[i - 1] + k * (C[i] - out[i - 1]);
      cache.set(n, out);
    }
    return cache.get(n)!;
  };
  // day levels
  const pdh = new Float64Array(N).fill(NaN), pdl = new Float64Array(N).fill(NaN);
  const asiaHi = new Float64Array(N).fill(NaN), asiaLo = new Float64Array(N).fill(NaN), twap = new Float64Array(N).fill(NaN);
  let day = -1, dh = -Infinity, dl = Infinity, ph = NaN, pl = NaN, ah = -Infinity, al = Infinity, sum = 0, cnt = 0;
  for (let i = 0; i < N; i++) {
    if (DAY[i] !== day) {
      if (day !== -1 && Number.isFinite(dh)) {
        ph = dh;
        pl = dl;
      }
      day = DAY[i];
      dh = -Infinity;
      dl = Infinity;
      ah = -Infinity;
      al = Infinity;
      sum = 0;
      cnt = 0;
    }
    pdh[i] = ph;
    pdl[i] = pl;
    const lonMin = LON[i];
    if (lonMin < 7 * 60 || lonMin >= 22 * 60) {
      ah = Math.max(ah, H[i]);
      al = Math.min(al, L[i]);
    } else if (Number.isFinite(ah)) {
      asiaHi[i] = ah;
      asiaLo[i] = al;
    }
    if (lonMin >= 7 * 60 && lonMin < 22 * 60) {
      sum += C[i];
      cnt++;
      twap[i] = sum / cnt;
    }
    dh = Math.max(dh, H[i]);
    dl = Math.min(dl, L[i]);
  }
  return { N, T, O, H, L, C, S, LON, NY, DAY, ATR: atr(14), ATR60: atr(60), ema, pdh, pdl, asiaHi, asiaLo, twap, gap };
}

// ---------------------------------------------------------------------------------------------------
// One trade with the real spread
// ---------------------------------------------------------------------------------------------------
interface Res {
  r: number;
  exit: number;
  t: number;
}
interface Exit {
  targetR: number;
  maxMin: number;
  beAt: number; // move the stop to the entry once price reached this many R (0 = never)
}
function trade(m: Mkt, i: number, dir: 1 | -1, stopDist: number, ex: Exit): Res | null {
  const { N, O, H, L, C, S, T, gap } = m;
  const k = i + 1;
  if (k >= N || gap[k]) return null;
  const entry = O[k] + (dir * S[i]) / 2;
  let stop = entry - dir * stopDist;
  const target = entry + dir * ex.targetR * stopDist;
  for (let j = k; j < N && j <= k + ex.maxMin; j++) {
    if (j > k && gap[j]) return { r: (dir * (C[j - 1] - (dir * S[j - 1]) / 2 - entry)) / stopDist, exit: j - 1, t: T[k] };
    const half = S[j] / 2;
    const adverse = dir === 1 ? L[j] - half : H[j] + half;
    const favor = dir === 1 ? H[j] - half : L[j] + half;
    if (dir * (adverse - stop) <= 0) {
      const fill = dir === 1 ? Math.min(stop, O[j] - half) : Math.max(stop, O[j] + half);
      return { r: (dir * (fill - entry)) / stopDist, exit: j, t: T[k] };
    }
    if (dir * (favor - target) >= 0) return { r: ex.targetR, exit: j, t: T[k] };
    if (ex.beAt > 0 && dir * (favor - entry) >= ex.beAt * stopDist && dir * (stop - entry) < 0) stop = entry;
  }
  const j = Math.min(N - 1, k + ex.maxMin);
  return { r: (dir * (C[j] - (dir * S[j]) / 2 - entry)) / stopDist, exit: j, t: T[k] };
}

// ---------------------------------------------------------------------------------------------------
// Methods (signals) and filters
// ---------------------------------------------------------------------------------------------------
type Sig = { dir: 1 | -1; stop: number } | null;
type Method = { family: string; name: string; make: (m: Mkt) => (i: number) => Sig };
type Filter = { name: string; ok: (m: Mkt, i: number, dir: 1 | -1) => boolean };

const methods: Method[] = [];
// 1. Opening range breakout, optionally only after a retest of the range edge
for (const open of ["londres", "new york"] as const)
  for (const len of [15, 30, 60])
    for (const retest of [false, true])
      methods.push({
        family: "cassure d'ouverture",
        name: `ouverture ${open} ${len} min${retest ? " + retest" : ""}`,
        make: (m) => {
          const isLon = open === "londres";
          const start = isLon ? 8 * 60 : 9 * 60 + 30;
          let day = -1, hi = -Infinity, lo = Infinity, done = false, broke: 0 | 1 | -1 = 0;
          return (i) => {
            const clock = isLon ? m.LON[i] : m.NY[i];
            if (m.DAY[i] !== day) {
              day = m.DAY[i];
              hi = -Infinity;
              lo = Infinity;
              done = false;
              broke = 0;
            }
            if (clock >= start && clock < start + len) {
              hi = Math.max(hi, m.H[i]);
              lo = Math.min(lo, m.L[i]);
              return null;
            }
            if (done || clock < start + len || clock > start + 240 || !Number.isFinite(hi) || hi <= lo) return null;
            const range = hi - lo;
            const stop = Math.min(range, 4 * m.ATR60[i]);
            if (!retest) {
              if (m.C[i] > hi) return (done = true), { dir: 1, stop };
              if (m.C[i] < lo) return (done = true), { dir: -1, stop };
              return null;
            }
            if (!broke) {
              if (m.C[i] > hi) broke = 1;
              else if (m.C[i] < lo) broke = -1;
              return null;
            }
            if (broke === 1 && m.L[i] <= hi && m.C[i] > hi) return (done = true), { dir: 1, stop: m.C[i] - Math.min(m.L[i], hi) + m.ATR[i] };
            if (broke === -1 && m.H[i] >= lo && m.C[i] < lo) return (done = true), { dir: -1, stop: Math.max(m.H[i], lo) - m.C[i] + m.ATR[i] };
            return null;
          };
        },
      });
// 2. Asian range at the London open: breakout, or the fake break faded
for (const mode of ["cassure", "fausse cassure"] as const)
  methods.push({
    family: "range asiatique",
    name: `range asiatique, ${mode}`,
    make: (m) => {
      let day = -1, done = false;
      return (i) => {
        if (m.DAY[i] !== day) {
          day = m.DAY[i];
          done = false;
        }
        const hi = m.asiaHi[i], lo = m.asiaLo[i];
        if (done || !Number.isFinite(hi) || m.LON[i] < 7 * 60 || m.LON[i] > 11 * 60) return null;
        const range = hi - lo;
        if (mode === "cassure") {
          if (m.C[i] > hi) return (done = true), { dir: 1, stop: Math.min(range / 2, 4 * m.ATR60[i]) };
          if (m.C[i] < lo) return (done = true), { dir: -1, stop: Math.min(range / 2, 4 * m.ATR60[i]) };
          return null;
        }
        if (m.H[i] > hi && m.C[i] < hi) return (done = true), { dir: -1, stop: m.H[i] - m.C[i] + m.ATR[i] };
        if (m.L[i] < lo && m.C[i] > lo) return (done = true), { dir: 1, stop: m.C[i] - m.L[i] + m.ATR[i] };
        return null;
      };
    },
  });
// 3. Previous day high / low: break and go, or the sweep faded
for (const mode of ["cassure", "fausse cassure"] as const)
  methods.push({
    family: "niveaux de la veille",
    name: `plus haut/bas de la veille, ${mode}`,
    make: (m) => {
      let day = -1, usedHi = false, usedLo = false;
      return (i) => {
        if (m.DAY[i] !== day) {
          day = m.DAY[i];
          usedHi = usedLo = false;
        }
        const hi = m.pdh[i], lo = m.pdl[i];
        if (!Number.isFinite(hi)) return null;
        if (mode === "cassure") {
          if (!usedHi && m.C[i] > hi && m.O[i] <= hi) return (usedHi = true), { dir: 1, stop: 2 * m.ATR60[i] };
          if (!usedLo && m.C[i] < lo && m.O[i] >= lo) return (usedLo = true), { dir: -1, stop: 2 * m.ATR60[i] };
          return null;
        }
        if (!usedHi && m.H[i] > hi && m.C[i] < hi) return (usedHi = true), { dir: -1, stop: m.H[i] - m.C[i] + m.ATR[i] };
        if (!usedLo && m.L[i] < lo && m.C[i] > lo) return (usedLo = true), { dir: 1, stop: m.C[i] - m.L[i] + m.ATR[i] };
        return null;
      };
    },
  });
// 4. Session average (TWAP since the London open): far from it, fade; crossing it with force, follow
for (const dev of [3, 5])
  methods.push({
    family: "moyenne de séance",
    name: `moyenne de séance, retour depuis ${dev} ATR`,
    make: (m) => (i) => {
      const v = m.twap[i];
      if (!Number.isFinite(v)) return null;
      const d = (m.C[i] - v) / m.ATR60[i];
      if (d > dev && m.C[i] < m.O[i]) return { dir: -1, stop: 2 * m.ATR60[i] };
      if (d < -dev && m.C[i] > m.O[i]) return { dir: 1, stop: 2 * m.ATR60[i] };
      return null;
    },
  });
methods.push({
  family: "moyenne de séance",
  name: "moyenne de séance, franchissement avec élan",
  make: (m) => (i) => {
    const v = m.twap[i];
    if (!Number.isFinite(v) || i < 1) return null;
    const body = Math.abs(m.C[i] - m.O[i]);
    if (body < 1.5 * m.ATR60[i]) return null;
    if (m.C[i - 1] <= v && m.C[i] > v) return { dir: 1, stop: 2 * m.ATR60[i] };
    if (m.C[i - 1] >= v && m.C[i] < v) return { dir: -1, stop: 2 * m.ATR60[i] };
    return null;
  },
});
// 5. Round numbers (every 10 $): first touch faded
for (const step of [10, 25])
  methods.push({
    family: "chiffres ronds",
    name: `chiffre rond (${step} $), rebond`,
    make: (m) => {
      let lastLevel = NaN;
      return (i) => {
        const lvl = Math.round(m.C[i] / step) * step;
        if (lvl === lastLevel) return null;
        if (m.L[i] <= lvl && m.O[i] > lvl + 0.5 && m.C[i] > lvl) return (lastLevel = lvl), { dir: 1, stop: m.C[i] - m.L[i] + m.ATR[i] };
        if (m.H[i] >= lvl && m.O[i] < lvl - 0.5 && m.C[i] < lvl) return (lastLevel = lvl), { dir: -1, stop: m.H[i] - m.C[i] + m.ATR[i] };
        return null;
      };
    },
  });
// 6. Trend pullback on 5-minute averages (45 / 105 one-minute bars), entry on a close back with the trend
for (const st of [2, 3])
  methods.push({
    family: "repli de tendance",
    name: `repli M5 vers la moyenne lente, stop ${st} ATR60`,
    make: (m) => {
      const f = m.ema(45), s = m.ema(105);
      return (i) => {
        if (f[i] > s[i] && m.L[i] <= s[i] && m.C[i] > s[i] && m.C[i] > m.O[i]) return { dir: 1, stop: st * m.ATR60[i] };
        if (f[i] < s[i] && m.H[i] >= s[i] && m.C[i] < s[i] && m.C[i] < m.O[i]) return { dir: -1, stop: st * m.ATR60[i] };
        return null;
      };
    },
  });
// 7. Momentum burst followed
for (const mult of [3, 4])
  methods.push({
    family: "élan",
    name: `élan ×${mult}`,
    make: (m) => (i) => {
      const r = m.H[i] - m.L[i];
      if (r < mult * m.ATR60[i] || r <= 0) return null;
      const pos = (m.C[i] - m.L[i]) / r;
      if (pos > 0.8) return { dir: 1, stop: 2 * m.ATR60[i] };
      if (pos < 0.2) return { dir: -1, stop: 2 * m.ATR60[i] };
      return null;
    },
  });

const filters: Filter[][] = [
  // when
  [
    { name: "toutes heures", ok: (m, i) => !(m.NY[i] >= 16 * 60 + 45 && m.NY[i] < 18 * 60 + 15) },
    { name: "Londres+NY", ok: (m, i) => (m.LON[i] >= 7 * 60 && m.LON[i] < 11 * 60 + 30) || (m.NY[i] >= 8 * 60 && m.NY[i] < 12 * 60) },
    { name: "chevauchement", ok: (m, i) => m.NY[i] >= 8 * 60 && m.NY[i] < 11 * 60 + 30 },
  ],
  // with the higher timeframes
  [
    { name: "sans tendance", ok: () => true },
    { name: "avec la tendance 4 h", ok: (m, i, d) => d * (m.C[i] - m.ema(240)[i]) > 0 && d * (m.ema(240)[i] - m.ema(240)[Math.max(0, i - 60)]) > 0 },
    { name: "avec la tendance du jour", ok: (m, i, d) => d * (m.C[i] - m.ema(1200)[i]) > 0 },
  ],
  // costs
  [
    { name: "écart ≤ 0,8", ok: (m, i) => m.S[i] <= 0.8 },
    { name: "écart ≤ 15 % du stop", ok: () => true }, // checked against the stop in run()
  ],
];
const exits: Exit[] = [];
for (const targetR of [1, 1.5, 2, 3]) for (const maxMin of [30, 120]) for (const beAt of [0, 1]) if (!(beAt && targetR <= 1)) exits.push({ targetR, maxMin, beAt });

// ---------------------------------------------------------------------------------------------------
// Running and judging
// ---------------------------------------------------------------------------------------------------
interface Rule {
  method: Method;
  when: Filter;
  trend: Filter;
  cost: Filter;
  ex: Exit;
  name: string;
}
const rules: Rule[] = [];
for (const method of methods)
  for (const when of filters[0])
    for (const trend of filters[1])
      for (const cost of filters[2])
        for (const ex of exits)
          rules.push({ method, when, trend, cost, ex, name: `${method.name} · ${when.name} · ${trend.name} · ${cost.name} · obj ${ex.targetR}R ${ex.maxMin} min${ex.beAt ? " BE" : ""}` });

function run(m: Mkt, rule: Rule): Res[] {
  const sig = rule.method.make(m);
  const out: Res[] = [];
  const maxSpreadShare = rule.cost.name.includes("%") ? 0.15 : Infinity;
  for (let i = 1500; i < m.N - 2; i++) {
    const s = sig(i);
    if (!s || m.gap[i + 1] || !rule.when.ok(m, i, s.dir) || !rule.trend.ok(m, i, s.dir) || !rule.cost.ok(m, i, s.dir)) continue;
    if (!(s.stop > 0) || m.S[i] > maxSpreadShare * s.stop || s.stop < 2 * m.S[i]) continue;
    const res = trade(m, i, s.dir, s.stop, rule.ex);
    if (!res) continue;
    out.push(res);
    for (let j = i + 1; j <= res.exit; j++) sig(j); // stateful signals see every minute
    i = res.exit;
  }
  return out;
}
const stat = (xs: Res[]) => {
  let gp = 0, gl = 0, sum = 0, w = 0;
  for (const x of xs) {
    sum += x.r;
    if (x.r > 0) (gp += x.r), w++;
    else gl -= x.r;
  }
  return { n: xs.length, sum, pf: gl ? gp / gl : gp ? 9.99 : 0, win: xs.length ? w / xs.length : 0 };
};
const maxDD = (xs: Res[]) => {
  let eq = 0, pk = 0, dd = 0;
  for (const x of xs) {
    eq += x.r;
    pk = Math.max(pk, eq);
    dd = Math.max(dd, pk - eq);
  }
  return dd;
};
const fmt = (s: ReturnType<typeof stat>) => `${String(s.n).padStart(4)} tr ${(s.sum >= 0 ? "+" : "") + s.sum.toFixed(1).padStart(6)}R pf ${s.pf.toFixed(2)}`;

const main = load(opt("data", "backtest/scalp-data/xau_m1.json"));
const T0 = main.T[0], T1 = main.T[main.N - 1], SPLIT = (T0 + T1) / 2;
const tradingDays = ((T1 - T0) / 86400) * (5 / 7);
console.log(`${main.N} minutes, du ${new Date(T0 * 1000).toISOString().slice(0, 10)} au ${new Date(T1 * 1000).toISOString().slice(0, 10)} · ${rules.length} règles`);
const t0 = Date.now();
const rows = rules.map((rule, k) => {
  if (k % 500 === 0 && k) console.error(`  ${k}/${rules.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const xs = run(main, rule);
  const a = xs.filter((x) => x.t < SPLIT), b = xs.filter((x) => x.t >= SPLIT);
  const q: number[] = [];
  for (let k2 = 0; k2 < 8; k2++) {
    const lo = T0 + ((T1 - T0) * k2) / 8, hi = T0 + ((T1 - T0) * (k2 + 1)) / 8;
    q.push(xs.filter((x) => x.t >= lo && x.t < hi).reduce((s2, x) => s2 + x.r, 0));
  }
  return { rule, a: stat(a), b: stat(b), dd: maxDD(xs), perDay: xs.length / tradingDays, qPos: q.filter((v) => v > 0).length };
});
const line = (x: (typeof rows)[number]) => `${x.rule.name.padEnd(120)} ${x.perDay.toFixed(1).padStart(4)}/j | an 1 ${fmt(x.a)} | an 2 ${fmt(x.b)} | trimestres + ${x.qPos}/8 | creux ${x.dd.toFixed(0)}R`;

console.log("\n== meilleures de chaque méthode sur l'an 1 (au moins 100 trades)");
for (const meth of methods) {
  const best = rows.filter((x) => x.rule.method === meth && x.a.n >= 100).sort((p, q) => q.a.sum - p.a.sum)[0];
  if (best) console.log(line(best));
}
const kept = rows.filter((x) => x.a.n >= 100 && x.b.n >= 100 && x.a.sum > 0 && x.b.sum > 0 && x.qPos >= 6);
console.log(`\n== retenues : gagnantes l'an 1 et l'an 2, au moins 6 trimestres sur 8 positifs, 100 trades par an : ${kept.length} sur ${rules.length}`);
kept.sort((p, q) => q.a.sum + q.b.sum - (p.a.sum + p.b.sum));
const top = Number(opt("top", "25"));
kept.slice(0, top).forEach((x) => console.log(line(x)));
const freq = kept.filter((x) => x.perDay >= 2);
console.log(`\n== dont au moins 2 trades par jour : ${freq.length}`);
freq.slice(0, top).forEach((x) => console.log(line(x)));

const checkFile = opt("check", "");
if (checkFile && kept.length) {
  const old = load(checkFile);
  const oldDays = ((old.T[old.N - 1] - old.T[0]) / 86400) * (5 / 7);
  console.log(`\n== contrôle final sur une période jamais vue : du ${new Date(old.T[0] * 1000).toISOString().slice(0, 10)} au ${new Date(old.T[old.N - 1] * 1000).toISOString().slice(0, 10)}`);
  let pass = 0;
  for (const x of kept.slice(0, Math.max(top, 60))) {
    const xs = run(old, x.rule);
    const s = stat(xs);
    if (s.sum > 0) pass++;
    console.log(`${x.rule.name.padEnd(120)} ${(xs.length / oldDays).toFixed(1).padStart(4)}/j | contrôle ${fmt(s)} | creux ${maxDD(xs).toFixed(0)}R`);
  }
  console.log(`gagnantes au contrôle : ${pass} sur ${Math.min(kept.length, Math.max(top, 60))}`);
}
