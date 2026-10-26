// Vectorised technical indicators. Every output value at index i only uses data <= i,
// so the arrays are safe to read inside a walk-forward backtest.
import { Candle } from "./types";

const NaNs = (n: number) => new Array<number>(n).fill(NaN);

export function sma(src: number[], n: number): number[] {
  const out = NaNs(src.length);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= n) sum -= src[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(src: number[], n: number): number[] {
  const out = NaNs(src.length);
  const k = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (Number.isNaN(v)) continue;
    prev = Number.isNaN(prev) ? v : v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder smoothing
export function rma(src: number[], n: number): number[] {
  const out = NaNs(src.length);
  let prev = NaN;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(prev)) {
      seed += v;
      count++;
      if (count === n) {
        prev = seed / n;
        out[i] = prev;
      }
    } else {
      prev = (prev * (n - 1) + v) / n;
      out[i] = prev;
    }
  }
  return out;
}

export function stdev(src: number[], n: number): number[] {
  const out = NaNs(src.length);
  for (let i = n - 1; i < src.length; i++) {
    let m = 0;
    for (let j = i - n + 1; j <= i; j++) m += src[j];
    m /= n;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (src[j] - m) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
}

export function trueRange(c: Candle[]): number[] {
  return c.map((k, i) =>
    i === 0 ? k.h - k.l : Math.max(k.h - k.l, Math.abs(k.h - c[i - 1].c), Math.abs(k.l - c[i - 1].c))
  );
}

export function atr(c: Candle[], n = 14): number[] {
  return rma(trueRange(c), n);
}

export function rsi(src: number[], n = 14): number[] {
  const up = src.map((v, i) => (i === 0 ? NaN : Math.max(v - src[i - 1], 0)));
  const dn = src.map((v, i) => (i === 0 ? NaN : Math.max(src[i - 1] - v, 0)));
  const au = rma(up, n);
  const ad = rma(dn, n);
  return au.map((u, i) => {
    const d = ad[i];
    if (Number.isNaN(u) || Number.isNaN(d)) return NaN;
    if (d === 0) return 100;
    return 100 - 100 / (1 + u / d);
  });
}

export function macd(src: number[], fast = 12, slow = 26, sig = 9) {
  const f = ema(src, fast);
  const s = ema(src, slow);
  const line = f.map((v, i) => v - s[i]);
  const signal = ema(line, sig);
  const hist = line.map((v, i) => v - signal[i]);
  return { line, signal, hist };
}

export function adx(c: Candle[], n = 14) {
  const pdm = NaNs(c.length);
  const mdm = NaNs(c.length);
  for (let i = 1; i < c.length; i++) {
    const up = c[i].h - c[i - 1].h;
    const dn = c[i - 1].l - c[i].l;
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
  }
  const tr = trueRange(c).map((v, i) => (i === 0 ? NaN : v));
  const atrW = rma(tr, n);
  const pS = rma(pdm, n);
  const mS = rma(mdm, n);
  const pdi = pS.map((v, i) => (100 * v) / atrW[i]);
  const mdi = mS.map((v, i) => (100 * v) / atrW[i]);
  const dx = pdi.map((p, i) => {
    const m = mdi[i];
    const s = p + m;
    return Number.isNaN(s) ? NaN : s === 0 ? 0 : (100 * Math.abs(p - m)) / s;
  });
  return { adx: rma(dx, n), pdi, mdi };
}

export function bollinger(src: number[], n = 20, k = 2) {
  const mid = sma(src, n);
  const sd = stdev(src, n);
  const up = mid.map((m, i) => m + k * sd[i]);
  const lo = mid.map((m, i) => m - k * sd[i]);
  const width = mid.map((m, i) => (up[i] - lo[i]) / m);
  return { mid, up, lo, width };
}

export function keltner(c: Candle[], n = 20, k = 1.5) {
  const mid = ema(
    c.map((x) => x.c),
    n
  );
  const a = atr(c, n);
  return { mid, up: mid.map((m, i) => m + k * a[i]), lo: mid.map((m, i) => m - k * a[i]) };
}

export function supertrend(c: Candle[], n = 10, mult = 3) {
  const a = atr(c, n);
  const line = NaNs(c.length);
  const dir = new Array<number>(c.length).fill(0);
  let fu = NaN;
  let fl = NaN;
  let d = 1;
  for (let i = 0; i < c.length; i++) {
    if (Number.isNaN(a[i])) continue;
    const hl2 = (c[i].h + c[i].l) / 2;
    const bu = hl2 + mult * a[i];
    const bl = hl2 - mult * a[i];
    const pc = i > 0 ? c[i - 1].c : c[i].c;
    fu = Number.isNaN(fu) || bu < fu || pc > fu ? bu : fu;
    fl = Number.isNaN(fl) || bl > fl || pc < fl ? bl : fl;
    if (d === 1 && c[i].c < fl) d = -1;
    else if (d === -1 && c[i].c > fu) d = 1;
    dir[i] = d;
    line[i] = d === 1 ? fl : fu;
  }
  return { line, dir };
}

// Kaufman efficiency ratio: 1 = straight line, 0 = pure noise
export function efficiency(src: number[], n = 20): number[] {
  const out = NaNs(src.length);
  for (let i = n; i < src.length; i++) {
    let path = 0;
    for (let j = i - n + 1; j <= i; j++) path += Math.abs(src[j] - src[j - 1]);
    out[i] = path === 0 ? 0 : Math.abs(src[i] - src[i - n]) / path;
  }
  return out;
}

// Highest high / lowest low of the n bars BEFORE i (excludes the current bar)
export function donchianPrev(c: Candle[], n = 20) {
  const hi = NaNs(c.length);
  const lo = NaNs(c.length);
  for (let i = n; i < c.length; i++) {
    let h = -Infinity;
    let l = Infinity;
    for (let j = i - n; j < i; j++) {
      if (c[j].h > h) h = c[j].h;
      if (c[j].l < l) l = c[j].l;
    }
    hi[i] = h;
    lo[i] = l;
  }
  return { hi, lo };
}

// Linear-regression value of the last point over n bars (TTM squeeze momentum)
export function linreg(src: number[], n: number): number[] {
  const out = NaNs(src.length);
  const sx = (n * (n - 1)) / 2;
  const sxx = ((n - 1) * n * (2 * n - 1)) / 6;
  for (let i = n - 1; i < src.length; i++) {
    let sy = 0;
    let sxy = 0;
    let bad = false;
    for (let j = 0; j < n; j++) {
      const y = src[i - n + 1 + j];
      if (Number.isNaN(y)) {
        bad = true;
        break;
      }
      sy += y;
      sxy += j * y;
    }
    if (bad) continue;
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const icpt = (sy - slope * sx) / n;
    out[i] = icpt + slope * (n - 1);
  }
  return out;
}

export interface Pivot {
  i: number; // bar index of the swing point
  at: number; // bar index at which the pivot becomes known (confirmed)
  price: number;
}

// Fractal swing points: a pivot at i is only "known" at i + right.
export function pivots(c: Candle[], left = 3, right = 2) {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  for (let i = left; i < c.length - right; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (c[j].h >= c[i].h && (j > i || c[j].h > c[i].h)) isH = false;
      if (c[j].l <= c[i].l && (j > i || c[j].l < c[i].l)) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) highs.push({ i, at: i + right, price: c[i].h });
    if (isL) lows.push({ i, at: i + right, price: c[i].l });
  }
  return { highs, lows };
}

// Percentile rank of src[i] among the previous n values (0..1)
export function pctRank(src: number[], i: number, n: number): number {
  const v = src[i];
  if (Number.isNaN(v)) return 0.5;
  let below = 0;
  let total = 0;
  for (let j = Math.max(0, i - n); j < i; j++) {
    const x = src[j];
    if (Number.isNaN(x)) continue;
    total++;
    if (x < v) below++;
  }
  return total === 0 ? 0.5 : below / total;
}
