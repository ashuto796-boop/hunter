// Scalping rules found by the nightly lab (backtest/scalplab.ts), runnable on any series of
// 1-minute bars: the server replays the lab's best rule on the last days of real prices to run
// the scalp demo account. Same signals, filters and exits as the lab, so the account trades what
// the lab measured. Rules that need the 2-hour AI's positions are not runnable here.

export interface SRule {
  method: string;
  p: number[];
  when: number; // 0 all, 1 London+NY, 2 overlap, 3 London, 4 New York
  trend: number; // 0 none, 1 4-hour average, 2 day average, 3 the 2-hour AI (not runnable here)
  maxSpread: number;
  minAtr: number;
  stopK: number; // stop in 60-minute ATR
  targetR: number;
  maxMin: number; // -1: until the 2-hour AI exits (not runnable here)
  beAt: number;
  ladder?: number[];
}
export interface M1Row {
  t: number; // open time, seconds UTC
  o: number;
  h: number;
  l: number;
  c: number;
  s: number; // spread, $
}
export interface ScalpTrade {
  dir: 1 | -1;
  t: number; // entry time, seconds (open of the minute after the signal)
  entry: number;
  stop: number; // distance to the initial stop, $ (1R)
  exitT: number | null; // null: still open at the last bar
  r: number; // result in R (at the last close when still open)
}

export const runnable = (r: SRule) => r.method !== "ia" && r.trend !== 3 && r.maxMin >= 0 && !r.ladder;

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

export interface ScalpMarket {
  N: number;
  T: Float64Array;
  O: Float64Array;
  H: Float64Array;
  L: Float64Array;
  C: Float64Array;
  S: Float64Array;
  LON: Int16Array;
  NY: Int16Array;
  DAYN: Int32Array;
  GAP: Uint8Array;
  ATR: Float64Array;
  PDH: Float64Array;
  PDL: Float64Array;
  AH: Float64Array;
  AL: Float64Array;
  TWAP: Float64Array;
  ema: (n: number) => Float64Array;
}

export function scalpMarket(rows: M1Row[]): ScalpMarket {
  const N = rows.length;
  const T = new Float64Array(N), O = new Float64Array(N), H = new Float64Array(N), L = new Float64Array(N), C = new Float64Array(N), S = new Float64Array(N);
  rows.forEach((r, i) => ((T[i] = r.t), (O[i] = r.o), (H[i] = r.h), (L[i] = r.l), (C[i] = r.c), (S[i] = Math.max(0, r.s))));
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
  const PDH = new Float64Array(N).fill(NaN), PDL = new Float64Array(N).fill(NaN), AH = new Float64Array(N).fill(NaN), AL = new Float64Array(N).fill(NaN), TWAP = new Float64Array(N).fill(NaN);
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
  return { N, T, O, H, L, C, S, LON, NY, DAYN, GAP, ATR, PDH, PDL, AH, AL, TWAP, ema };
}

type Signal = (i: number) => 1 | -1 | 0;
function makeSignal(m: ScalpMarket, r: SRule): Signal {
  const { O, H, L, C, LON, NY, DAYN, ATR, PDH, PDL, AH, AL, TWAP } = m;
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
      const f = m.ema(p[0]), s = m.ema(Math.max(p[1], p[0] + 1));
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
      const e = m.ema(20);
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
  }
  return () => 0;
}
const whenOk = (m: ScalpMarket, w: number, i: number) => {
  const { LON, NY } = m;
  return w === 0
    ? !(NY[i] >= 16 * 60 + 45 && NY[i] < 18 * 60 + 15)
    : w === 1
      ? (LON[i] >= 7 * 60 && LON[i] < 11 * 60 + 30) || (NY[i] >= 8 * 60 && NY[i] < 12 * 60)
      : w === 2
        ? NY[i] >= 8 * 60 && NY[i] < 11 * 60 + 30
        : w === 3
          ? LON[i] >= 7 * 60 && LON[i] < 11 * 60 + 30
          : NY[i] >= 8 * 60 && NY[i] < 12 * 60;
};
function trendOk(m: ScalpMarket, t: number, i: number, d: number) {
  if (t === 0) return true;
  if (t === 1) {
    const e = m.ema(240);
    return d * (m.C[i] - e[i]) > 0 && d * (e[i] - e[Math.max(0, i - 60)]) > 0;
  }
  if (t === 2) return d * (m.C[i] - m.ema(1200)[i]) > 0;
  return false;
}

// Every trade of the rule from bar `from` on, one at a time; the last one may still be open.
export function scalpRun(m: ScalpMarket, r: SRule, from = 1500): ScalpTrade[] {
  if (!runnable(r)) return [];
  const { N, T, O, H, L, C, S, GAP, ATR } = m;
  const sig = makeSignal(m, r);
  const out: ScalpTrade[] = [];
  for (let i = 1; i < from && i < N; i++) sig(i); // signals with a memory (ranges, levels) warm up
  for (let i = Math.max(1, from); i < N - 1; i++) {
    const d = sig(i);
    if (!d || GAP[i + 1] || S[i] > r.maxSpread || ATR[i] < r.minAtr || !whenOk(m, r.when, i) || !trendOk(m, r.trend, i, d)) continue;
    const stop = r.stopK * ATR[i];
    if (stop < 2 * S[i]) continue;
    const k = i + 1;
    const entry = O[k] + (d * S[i]) / 2;
    let sl = entry - d * stop;
    const tp = entry + d * r.targetR * stop;
    const until = T[k] + r.maxMin * 60;
    const trade: ScalpTrade = { dir: d, t: T[k], entry, stop, exitT: null, r: 0 };
    let exit = -1;
    for (let j = k; j < N; j++) {
      const half = S[j] / 2;
      if (j > k && GAP[j]) {
        trade.r = (d * (C[j - 1] - (d * S[j - 1]) / 2 - entry)) / stop;
        exit = j - 1;
        break;
      }
      if (d * ((d === 1 ? L[j] - half : H[j] + half) - sl) <= 0) {
        trade.r = (d * ((d === 1 ? Math.min(sl, O[j] - half) : Math.max(sl, O[j] + half)) - entry)) / stop;
        exit = j;
        break;
      }
      if (d * ((d === 1 ? H[j] - half : L[j] + half) - tp) >= 0) {
        trade.r = r.targetR;
        exit = j;
        break;
      }
      if (r.beAt > 0 && d * ((d === 1 ? H[j] - half : L[j] + half) - entry) >= r.beAt * stop && d * (sl - entry) < 0) sl = entry;
      if (T[j] >= until) {
        trade.r = (d * (C[j] - (d * S[j]) / 2 - entry)) / stop;
        exit = j;
        break;
      }
    }
    if (exit < 0) {
      trade.r = (d * (C[N - 1] - (d * S[N - 1]) / 2 - entry)) / stop;
      out.push(trade);
      break;
    }
    trade.exitT = T[exit] + 60;
    out.push(trade);
    for (let j = i + 1; j <= exit; j++) sig(j);
    i = exit;
  }
  return out;
}

// The rule in plain French, as the lab's report writes it
const LABELS: Record<string, (p: number[]) => string> = {
  orb: (p) => `cassure de l'ouverture de ${p[0] ? "New York" : "Londres"} ${p[1]} min${p[2] ? " + retest" : ""}`,
  asia: (p) => `range asiatique, ${p[0] ? "fausse cassure" : "cassure"}`,
  pdhl: (p) => `plus haut/bas de la veille, ${p[0] ? "fausse cassure" : "cassure"}`,
  twap: (p) => `retour vers la moyenne de séance depuis ${p[0]} ATR`,
  round: (p) => `rebond sur chiffre rond (${p[0]} $)`,
  pull: (p) => `repli sur la moyenne ${p[1]} min (rapide ${p[0]})`,
  burst: (p) => `élan ×${p[0]}`,
  fade: (p) => `retour depuis ${p[0]} ATR de la moyenne 20 min`,
  sweep: (p) => `chasse aux stops (sommet/creux ${p[0]} min)`,
};
const WHEN = ["toutes heures", "Londres + New York", "chevauchement Londres/New York", "Londres", "New York"];
const TREND = ["sans tendance", "avec la tendance 4 h", "avec la tendance du jour", "avec la position de l'IA 2 h"];
export const describeRule = (r: SRule) =>
  `${(LABELS[r.method] ?? (() => r.method))(r.p)} · ${WHEN[r.when]} · ${TREND[r.trend]} · stop ${r.stopK} ATR · objectif ${r.targetR}R · ${r.maxMin} min max${r.beAt ? ` · stop à l'entrée à ${r.beAt}R` : ""}`;

// The lab's pick: its champion when there is one, else the most robust qualified rule: the worse of
// its two periods (before 2025, and 2025 up to its discovery, in R per year) minus a quarter of its
// worst drawdown per year, so a rule has to be good in both. Only rules runnable here. It changes
// only for one clearly better (10 % more) or when the one followed is no longer qualified.
export interface LabEntry {
  id: string;
  rule: SRule;
  status: string;
  m: { train: { sumR: number; days: number }; valid: { sumR: number; days: number }; live: { sumR: number; days: number }; dd: number };
}
const perYr = (sumR: number, days: number) => sumR / Math.max(0.25, days / 365);
export const robustScore = (e: LabEntry) =>
  Math.min(perYr(e.m.train.sumR, e.m.train.days), perYr(e.m.valid.sumR + e.m.live.sumR, e.m.valid.days + e.m.live.days)) -
  (0.25 * e.m.dd) / Math.max(1, (e.m.train.days + e.m.valid.days + e.m.live.days) / 365);
export function labPick(lab: { champion: string | null; entries: LabEntry[] }, current?: string): LabEntry | null {
  const ok = lab.entries.filter((e) => runnable(e.rule));
  const champ = ok.find((e) => e.id === lab.champion);
  if (champ) return champ;
  const good = (e: LabEntry) => e.status === "qualifiée" || e.status === "confirmée";
  const best = ok.filter(good).sort((a, b) => robustScore(b) - robustScore(a))[0] ?? null;
  const cur = ok.find((e) => e.id === current);
  if (cur && good(cur) && best && robustScore(best) < robustScore(cur) + 0.1 * Math.abs(robustScore(cur))) return cur;
  return best;
}
