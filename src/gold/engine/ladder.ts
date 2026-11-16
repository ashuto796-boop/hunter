// The owner's 1-minute scalp, "l'échelle": up to ten small positions (0.01 lot each) on one
// signal. One position on a 1-minute pullback to the 20-minute average in the direction of the
// 200-minute average (07:00-17:00 UTC); one more each time price goes `step` $ against the last
// one, up to `n`; each closes at its own small profit (`target` $, about 4-5 € at 0.01 lot); the
// whole ladder is cut when price goes one more step against the last position, or after `maxMin`.
//
// Demo only: this module has no broker in it. The server replays it minute by minute on real
// 1-minute prices with a broker-like spread, exactly as backtest/scalp_basket.ts tests it on four
// years (where every variant lost money in the end: many small wins, rare large losses).

export interface LadderRule {
  n: number; // positions at most
  step: number; // $ against the last position before adding one
  target: number; // $ of profit per position (1 oz = 0.01 lot: 1 $ of move = 1 $)
  maxMin: number; // the whole ladder is closed after this many minutes
  fromH: number; // UTC hours when a new ladder may start
  toH: number;
  spread: number; // $ paid per position, half at entry and half at exit
  oz: number; // ounces per position (0.01 lot = 1 oz)
}
export const AURUM_ECHELLE: LadderRule = { n: 10, step: 5, target: 5, maxMin: 480, fromH: 7, toH: 17, spread: 0.6, oz: 1 };

export interface Bar {
  t: number; // open time, ms UTC
  o: number;
  h: number;
  l: number;
  c: number;
}
export interface LadderSeries {
  dir: 1 | -1;
  start: number; // ms
  open: number[]; // entry prices of the positions still open
  added: number; // positions opened in this ladder
  won: number; // positions closed at their target
  pnl: number; // $ realised in this ladder
  worst: number; // $ lowest point (realised + floating)
}
export interface LadderClosed {
  dir: 1 | -1;
  start: number;
  end: number;
  added: number;
  won: number;
  pnl: number;
  worst: number;
  how: "objectifs" | "coupée" | "temps" | "trou";
}
export interface LadderState {
  version: 1;
  startedAt: number;
  startBalance: number;
  balance: number;
  lastT: number; // open time of the last minute processed
  lastC: number;
  e20: number;
  e200: number;
  warm: number; // minutes seen (no ladder before the averages are warm)
  pending: 0 | 1 | -1; // signal on the last minute: the ladder opens at the next minute's open
  series: LadderSeries | null;
  closed: LadderClosed[]; // most recent last (capped)
  stats: { series: number; won: number; pnl: number; positions: number; worst: number };
}

export function newLadder(balance: number, now: number): LadderState {
  return {
    version: 1,
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
    closed: [],
    stats: { series: 0, won: 0, pnl: 0, positions: 0, worst: 0 },
  };
}

const finish = (st: LadderState, s: LadderSeries, end: number, extra: number, how: LadderClosed["how"]): LadderClosed => {
  const c: LadderClosed = { dir: s.dir, start: s.start, end, added: s.added, won: s.won, pnl: s.pnl + extra, worst: Math.min(s.worst, s.pnl + extra), how };
  st.balance += c.pnl;
  st.stats.series++;
  if (c.pnl > 0) st.stats.won++;
  st.stats.pnl += c.pnl;
  st.stats.positions += c.added;
  st.stats.worst = Math.min(st.stats.worst, c.pnl);
  st.closed.push(c);
  st.closed = st.closed.slice(-200);
  st.series = null;
  return c;
};

// One closed 1-minute bar (bars must come in time order). Returns the ladder it closed, if any.
// canTrade false: only warms the averages (first run: no ladder on past minutes)
export function ladderMinute(st: LadderState, rule: LadderRule, b: Bar, canTrade = true): LadderClosed | null {
  if (b.t <= st.lastT) return null;
  const half = rule.spread / 2, oz = rule.oz;
  let done: LadderClosed | null = null;
  // a hole in the prices (market closed): an open ladder is closed at the last price seen
  if (st.lastT && b.t - st.lastT > 5 * 60000) {
    st.pending = 0;
    if (st.series) {
      const s = st.series;
      done = finish(st, s, st.lastT + 60000, s.open.reduce((sum, e) => sum + s.dir * (st.lastC - s.dir * half - e) * oz, 0), "trou");
    }
  }
  if (st.pending && !st.series) {
    st.series = { dir: st.pending, start: b.t, open: [b.o + st.pending * half], added: 1, won: 0, pnl: 0, worst: 0 };
  }
  st.pending = 0;
  const s = st.series;
  if (s && !done) {
    const d = s.dir;
    const worstPx = d === 1 ? b.l - half : b.h + half; // worst exit price this minute
    const bestPx = d === 1 ? b.h - half : b.l + half; // best exit price this minute
    for (let p = s.open.length - 1; p >= 0; p--)
      if (d * (bestPx - s.open[p]) >= rule.target) {
        s.pnl += rule.target * oz;
        s.won++;
        s.open.splice(p, 1);
      }
    const lastIn = s.open.length ? s.open[s.open.length - 1] : null;
    if (lastIn !== null && s.added < rule.n && d * (worstPx - lastIn) <= -rule.step) {
      s.open.push(lastIn - d * rule.step + d * half);
      s.added++;
    }
    const exitPx = b.c - d * half;
    s.worst = Math.min(s.worst, s.pnl + s.open.reduce((sum, e) => sum + d * (exitPx - e) * oz, 0));
    if (s.added >= rule.n && s.open.length && d * (worstPx - s.open[s.open.length - 1]) <= -rule.step) {
      const cut = s.open[s.open.length - 1] - d * rule.step;
      done = finish(st, s, b.t + 60000, s.open.reduce((sum, e) => sum + d * (cut - e) * oz, 0), "coupée");
    } else if (!s.open.length) done = finish(st, s, b.t + 60000, 0, "objectifs");
    else if (b.t + 60000 - s.start >= rule.maxMin * 60000) done = finish(st, s, b.t + 60000, s.open.reduce((sum, e) => sum + d * (exitPx - e) * oz, 0), "temps");
  }
  // averages, then the signal for the next minute (none on the minute a ladder ends)
  if (!st.warm) st.e20 = st.e200 = b.c;
  st.e20 += (2 / 21) * (b.c - st.e20);
  st.e200 += (2 / 201) * (b.c - st.e200);
  st.warm++;
  st.lastT = b.t;
  st.lastC = b.c;
  const hour = new Date(b.t).getUTCHours();
  if (canTrade && !st.series && !done && st.warm >= 400 && hour >= rule.fromH && hour < rule.toH) {
    if (st.e20 > st.e200 && b.l <= st.e20 && b.c > st.e20) st.pending = 1;
    else if (st.e20 < st.e200 && b.h >= st.e20 && b.c < st.e20) st.pending = -1;
  }
  return done;
}

// Floating result of the open ladder at a price
export const ladderFloating = (st: LadderState, rule: LadderRule, price: number) =>
  st.series ? st.series.open.reduce((sum, e) => sum + st.series!.dir * (price - st.series!.dir * (rule.spread / 2) - e) * rule.oz, 0) : 0;
