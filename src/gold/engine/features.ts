// Precomputes every feature the brain reads, for the entry timeframe and two higher timeframes
// built by aggregating the entry candles (one data stream, identical in live and backtest).
import { Candle, Session } from "./types";
import * as ind from "./indicators";
import { sessionAt, tradingDay } from "./context";

export interface Series {
  tf: number; // minutes
  c: Candle[];
  close: number[];
  ema20: number[];
  ema50: number[];
  ema200: number[];
  rsi: number[];
  atr: number[];
  adx: number[];
  pdi: number[];
  mdi: number[];
  macdHist: number[];
  bbUp: number[];
  bbLo: number[];
  bbMid: number[];
  bbW: number[];
  sqz: boolean[];
  stLine: number[];
  stDir: number[];
  er: number[];
  volSma: number[];
  donHi: number[];
  donLo: number[];
  mom: number[];
  highs: ind.Pivot[];
  lows: ind.Pivot[];
}

export interface EntrySeries extends Series {
  session: Session[];
  day: string[];
  asiaHi: number[];
  asiaLo: number[];
  asiaDone: boolean[];
  pdh: number[];
  pdl: number[];
  vwap: number[];
}

export interface Market {
  ltf: EntrySeries;
  h1: Series;
  h4: Series;
  m1: number[]; // entry index -> last closed H1 index (-1 if none)
  m4: number[];
}

export function computeSeries(c: Candle[], tf: number): Series {
  const close = c.map((k) => k.c);
  const bb = ind.bollinger(close, 20, 2);
  const kc = ind.keltner(c, 20, 1.5);
  const st = ind.supertrend(c, 10, 3);
  const dx = ind.adx(c, 14);
  const dc = ind.donchianPrev(c, 20);
  const ema20 = ind.ema(close, 20);
  const sma20 = ind.sma(close, 20);
  // TTM-style momentum: distance of price from the average of the Donchian mid and the SMA
  const momSrc = close.map((v, i) => v - ((dc.hi[i] + dc.lo[i]) / 2 + sma20[i]) / 2);
  const piv = ind.pivots(c, 3, 2);
  return {
    tf,
    c,
    close,
    ema20,
    ema50: ind.ema(close, 50),
    ema200: ind.ema(close, 200),
    rsi: ind.rsi(close, 14),
    atr: ind.atr(c, 14),
    adx: dx.adx,
    pdi: dx.pdi,
    mdi: dx.mdi,
    macdHist: ind.macd(close).hist,
    bbUp: bb.up,
    bbLo: bb.lo,
    bbMid: bb.mid,
    bbW: bb.width,
    sqz: bb.up.map((u, i) => u < kc.up[i] && bb.lo[i] > kc.lo[i]),
    stLine: st.line,
    stDir: st.dir,
    er: ind.efficiency(close, 20),
    volSma: ind.sma(
      c.map((k) => k.v),
      20
    ),
    donHi: dc.hi,
    donLo: dc.lo,
    mom: ind.linreg(momSrc, 20),
    highs: piv.highs,
    lows: piv.lows,
  };
}

export function aggregate(c: Candle[], tfMin: number): Candle[] {
  const ms = tfMin * 60000;
  const out: Candle[] = [];
  for (const k of c) {
    const b = Math.floor(k.t / ms) * ms;
    const last = out[out.length - 1];
    if (last && last.t === b) {
      last.h = Math.max(last.h, k.h);
      last.l = Math.min(last.l, k.l);
      last.c = k.c;
      last.v += k.v;
    } else {
      out.push({ t: b, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v });
    }
  }
  return out;
}

function mapHtf(c: Candle[], tf: number, h: Candle[], htf: number): number[] {
  const out = new Array<number>(c.length).fill(-1);
  let j = -1;
  for (let i = 0; i < c.length; i++) {
    const closeT = c[i].t + tf * 60000;
    while (j + 1 < h.length && h[j + 1].t + htf * 60000 <= closeT) j++;
    out[i] = j;
  }
  return out;
}

export function buildMarket(c: Candle[], tf: number): Market {
  const base = computeSeries(c, tf);
  const n = c.length;
  const session: Session[] = new Array(n);
  const day: string[] = new Array(n);
  const asiaHi = new Array<number>(n).fill(NaN);
  const asiaLo = new Array<number>(n).fill(NaN);
  const asiaDone = new Array<boolean>(n).fill(false);
  const pdh = new Array<number>(n).fill(NaN);
  const pdl = new Array<number>(n).fill(NaN);
  const vwap = new Array<number>(n).fill(NaN);

  let curDay = "";
  let dHi = -Infinity;
  let dLo = Infinity;
  let traded = false;
  let aHi = NaN;
  let aLo = NaN;
  let aDone = false;
  let prevHi = NaN;
  let prevLo = NaN;
  let pv = 0;
  let vv = 0;
  for (let i = 0; i < n; i++) {
    const k = c[i];
    const s = sessionAt(k.t);
    const d = tradingDay(k.t);
    session[i] = s;
    day[i] = d;
    if (d !== curDay) {
      if (traded) {
        prevHi = dHi;
        prevLo = dLo;
      }
      curDay = d;
      dHi = -Infinity;
      dLo = Infinity;
      traded = false;
      aHi = NaN;
      aLo = NaN;
      aDone = false;
      pv = 0;
      vv = 0;
    }
    const tradable = s !== "FERME" && s !== "ROLLOVER";
    if (tradable) {
      traded = true;
      dHi = Math.max(dHi, k.h);
      dLo = Math.min(dLo, k.l);
      const vol = k.v > 0 ? k.v : 1;
      pv += ((k.h + k.l + k.c) / 3) * vol;
      vv += vol;
      if (s === "ASIE" && !aDone) {
        aHi = Number.isNaN(aHi) ? k.h : Math.max(aHi, k.h);
        aLo = Number.isNaN(aLo) ? k.l : Math.min(aLo, k.l);
      } else if (!Number.isNaN(aHi)) {
        aDone = true;
      }
    }
    asiaHi[i] = aHi;
    asiaLo[i] = aLo;
    asiaDone[i] = aDone;
    pdh[i] = prevHi;
    pdl[i] = prevLo;
    vwap[i] = vv > 0 ? pv / vv : k.c;
  }

  const h1c = aggregate(c, 60);
  const h4c = aggregate(c, 240);
  return {
    ltf: { ...base, session, day, asiaHi, asiaLo, asiaDone, pdh, pdl, vwap },
    h1: computeSeries(h1c, 60),
    h4: computeSeries(h4c, 240),
    m1: mapHtf(c, tf, h1c, 60),
    m4: mapHtf(c, tf, h4c, 240),
  };
}

// Most recent swing points already confirmed at bar i (newest first)
export function knownPivots(list: ind.Pivot[], i: number, count: number, maxAge = Infinity): ind.Pivot[] {
  // pivots are ordered by i (and therefore by at): binary search the last one known at bar i
  let lo = 0;
  let hi = list.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].at <= i) {
      last = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const out: ind.Pivot[] = [];
  for (let k = last; k >= 0 && out.length < count; k--) {
    if (i - list[k].i > maxAge) break;
    out.push(list[k]);
  }
  return out;
}
