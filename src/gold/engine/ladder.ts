// The owner's 1-minute scalp (second demo account). Rules asked by the owner:
//   - a position stays in only while it is not yet positive: at the first 1-minute close where it
//     is in profit (spread paid), it is closed;
//   - a position in loss never loses more than 5 € (stop at about 5.40 $ on 0.01 lot);
//   - no limit on trades per day; up to 10 positions of 0.01 lot open at the same time.
// Entries: a 1-minute pullback to the 20-minute average in the direction of the 200-minute average,
// 07:00-17:00 UTC (8 h-18 h in Paris in winter).
//
// Demo only: this module has no broker in it. The server replays it minute by minute on real
// 1-minute prices with a broker-like spread. On four years this rule wins 75-87 % of its trades but
// loses overall (many wins of well under 1 $, losses of 5.40 $): see backtest/scalp_basket.ts.

export interface LadderRule {
  maxOpen: number; // positions open at the same time, at most
  stop: number; // $ lost per position at most (1 oz = 0.01 lot: 1 $ of move = 1 $)
  minWin: number; // $ of profit (spread paid) needed to close at a minute close
  maxMin: number; // a position still open after this many minutes is closed
  fromH: number; // UTC hours when new positions may open
  toH: number;
  spread: number; // $ paid per position, half at entry and half at exit
  oz: number; // ounces per position (0.01 lot = 1 oz)
}
// 5 € ≈ 5.40 $ at about 1.08 $ per €
export const AURUM_SCALP1: LadderRule = { maxOpen: 10, stop: 5.4, minWin: 0, maxMin: 480, fromH: 7, toH: 17, spread: 0.6, oz: 1 };

export interface Bar {
  t: number; // open time, ms UTC
  o: number;
  h: number;
  l: number;
  c: number;
}
export interface OpenPos {
  dir: 1 | -1;
  entry: number;
  t: number; // ms
}
// kept for older published states; always null now
export interface LadderSeries {
  dir: 1 | -1;
  start: number;
  open: number[];
  added: number;
  won: number;
  pnl: number;
  worst: number;
}
export interface LadderClosed {
  dir: 1 | -1;
  start: number;
  end: number;
  added: number; // 1 per position
  won: number; // 1 if closed in profit
  pnl: number;
  worst: number;
  how: "objectifs" | "coupée" | "temps" | "trou" | "règles";
}
export interface LadderState {
  version: 1 | 2;
  startedAt: number;
  startBalance: number;
  balance: number;
  lastT: number; // open time of the last minute processed
  lastC: number;
  e20: number;
  e200: number;
  warm: number; // minutes seen (no trade before the averages are warm)
  pending: 0 | 1 | -1; // signal on the last minute: a position opens at the next minute's open
  series: LadderSeries | null;
  open?: OpenPos[];
  closed: LadderClosed[]; // most recent last (capped)
  stats: { series: number; won: number; pnl: number; positions: number; worst: number };
}

export function newLadder(balance: number, now: number): LadderState {
  return {
    version: 2,
    startedAt: now,
    startBalance: balance,
    balance,
    lastT: 0,
    lastC: 0,
    e20: 0,
    e200: 0,
    warm: 0,
    pending: 0,
    series: null,
    open: [],
    closed: [],
    stats: { series: 0, won: 0, pnl: 0, positions: 0, worst: 0 },
  };
}

const record = (st: LadderState, p: OpenPos, end: number, pnl: number, how: LadderClosed["how"]): LadderClosed => {
  const c: LadderClosed = { dir: p.dir, start: p.t, end, added: 1, won: pnl > 0 ? 1 : 0, pnl, worst: Math.min(0, pnl), how };
  st.balance += pnl;
  st.stats.series++;
  if (pnl > 0) st.stats.won++;
  st.stats.pnl += pnl;
  st.stats.positions++;
  st.stats.worst = Math.min(st.stats.worst, pnl);
  st.closed.push(c);
  st.closed = st.closed.slice(-200);
  return c;
};

// A state published by the earlier ladder rules: its open ladder is settled at the last price,
// then the account carries on with the new rules.
export function upgradeLadder(st: LadderState, rule: LadderRule): LadderClosed[] {
  const out: LadderClosed[] = [];
  if (st.version !== 2) {
    const s = st.series;
    if (s) {
      const pnl = s.pnl + s.open.reduce((a, e) => a + s.dir * (st.lastC - s.dir * (rule.spread / 2) - e) * rule.oz, 0);
      const c: LadderClosed = { dir: s.dir, start: s.start, end: st.lastT + 60000, added: s.added, won: s.won, pnl, worst: Math.min(s.worst, pnl), how: "règles" };
      st.balance += pnl;
      st.stats.series++;
      if (pnl > 0) st.stats.won++;
      st.stats.pnl += pnl;
      st.stats.positions += s.added;
      st.stats.worst = Math.min(st.stats.worst, pnl);
      st.closed.push(c);
      out.push(c);
    }
    st.series = null;
    st.open = [];
    st.version = 2;
  }
  st.open ??= [];
  return out;
}

// One closed 1-minute bar (bars must come in time order). Returns the positions it closed.
// canTrade false: only warms the averages (first run: no trade on past minutes).
export function ladderMinute(st: LadderState, rule: LadderRule, b: Bar, canTrade = true): LadderClosed[] {
  const done: LadderClosed[] = [];
  if (b.t <= st.lastT) return done;
  const open = (st.open ??= []);
  const half = rule.spread / 2, oz = rule.oz;
  // a hole in the prices (market closed): open positions are closed at the last price seen
  if (st.lastT && b.t - st.lastT > 5 * 60000) {
    st.pending = 0;
    for (const p of open.splice(0)) done.push(record(st, p, st.lastT + 60000, p.dir * (st.lastC - p.dir * half - p.entry) * oz, "trou"));
  }
  if (st.pending && open.length < rule.maxOpen) open.push({ dir: st.pending, entry: b.o + st.pending * half, t: b.t });
  st.pending = 0;
  const end = b.t + 60000;
  for (let k = open.length - 1; k >= 0; k--) {
    const p = open[k];
    const worst = p.dir * ((p.dir === 1 ? b.l - half : b.h + half) - p.entry);
    const atClose = p.dir * (b.c - p.dir * half - p.entry);
    let pnl: number | null = null, how: LadderClosed["how"] = "objectifs";
    if (worst <= -rule.stop) (pnl = -rule.stop), (how = "coupée"); // never more than the stop
    else if (atClose > rule.minWin) pnl = atClose; // positive at the minute close: out
    else if (end - p.t >= rule.maxMin * 60000) (pnl = atClose), (how = "temps");
    if (pnl !== null) {
      open.splice(k, 1);
      done.push(record(st, p, end, pnl * oz, how));
    }
  }
  if (!st.warm) st.e20 = st.e200 = b.c;
  st.e20 += (2 / 21) * (b.c - st.e20);
  st.e200 += (2 / 201) * (b.c - st.e200);
  st.warm++;
  st.lastT = b.t;
  st.lastC = b.c;
  const hour = new Date(b.t).getUTCHours();
  if (canTrade && st.balance > 0 && open.length < rule.maxOpen && st.warm >= 400 && hour >= rule.fromH && hour < rule.toH) {
    if (st.e20 > st.e200 && b.l <= st.e20 && b.c > st.e20) st.pending = 1;
    else if (st.e20 < st.e200 && b.h >= st.e20 && b.c < st.e20) st.pending = -1;
  }
  return done;
}

// Floating result of the open positions at a price
export const ladderFloating = (st: LadderState, rule: LadderRule, price: number) =>
  (st.open ?? []).reduce((sum, p) => sum + p.dir * (price - p.dir * (rule.spread / 2) - p.entry) * rule.oz, 0);
