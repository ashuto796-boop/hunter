// Paper broker + trade management. Fills include the spread, stops are checked before targets
// inside a candle (worst case), and every closed trade feeds the brain's memory.
import { Candle, Decision, Dir, ExitReason, Plan, Position, Settings, Trade, TraderState } from "./types";
import { AnalyseEnv, analyse, ctxKey, emptyBrain } from "./brain";
import { Market } from "./features";
import { tradingDay, weekendRisk } from "./context";
import { emptyMemory, recordShadows, resolveShadows } from "./memory";

const SLIPPAGE = 0.05; // $ per oz on stop exits

export function newTraderState(capital: number): TraderState {
  return {
    balance: capital,
    peak: capital,
    position: null,
    trades: [],
    brain: emptyBrain(),
    ctx: {},
    mem: emptyMemory(),
    day: { key: "", pnl: 0, trades: 0, startBalance: capital },
    lossStreak: 0,
    cooldownUntil: 0,
    lastLoss: null,
    pending: null,
    seq: 0,
  };
}

export function rollDay(st: TraderState, t: number) {
  const key = tradingDay(t);
  if (st.day.key !== key) st.day = { key, pnl: 0, trades: 0, startBalance: st.balance };
}

function drawdownMult(st: TraderState): number {
  const dd = 1 - st.balance / st.peak;
  return dd > 0.08 ? 0.5 : dd > 0.04 ? 0.75 : 1;
}

export function openPosition(st: TraderState, plan: Plan, mid: number, t: number, settings: Settings, atr: number, replay: boolean): Position | null {
  const d = plan.dir;
  const entry = mid + (d * settings.spread) / 2;
  const slDist = d * (entry - plan.sl);
  if (slDist < 0.3 * atr) return null; // price already ran to the stop: setup invalidated
  let tp2 = plan.tp2;
  if (d * (tp2 - entry) < 1.3 * slDist) tp2 = entry + d * 2 * slDist;
  const riskPct = settings.riskPct * plan.riskMult * drawdownMult(st);
  const riskAmt = (st.balance * riskPct) / 100;
  const oz = Math.max(1, Math.floor(riskAmt / (slDist + SLIPPAGE)));
  const p: Position = {
    id: `T${++st.seq}`,
    dir: d,
    openTime: t,
    entry,
    sl: plan.sl,
    sl0: plan.sl,
    tp1: entry + d * slDist,
    tp2,
    oz,
    oz0: oz,
    riskAmt: oz * (slDist + SLIPPAGE),
    realized: 0,
    tp1Done: false,
    bestPrice: mid,
    barsHeld: 0,
    score: plan.score,
    primary: plan.primary,
    contributors: plan.contributors,
    reasons: plan.reasons,
    replay,
    regime: plan.regime,
    session: plan.session,
  };
  st.position = p;
  st.day.trades++;
  return p;
}

function learn(st: TraderState, tr: Trade) {
  for (const id of tr.contributors) {
    const w = id === tr.primary ? 1 : 0.5;
    const stats = [st.brain[id]];
    if (tr.regime) stats.push((st.ctx[ctxKey(id, tr.regime)] ??= { n: 0, wins: 0, sumR: 0 }));
    for (const s of stats) {
      s.n += w;
      s.sumR += tr.r * w;
      if (tr.r > 0) s.wins += w;
    }
  }
}

export function closePosition(st: TraderState, exitFill: number, t: number, reason: ExitReason): Trade {
  const p = st.position!;
  const d = p.dir;
  const pnl = p.realized + d * (exitFill - p.entry) * p.oz;
  const avgExit = p.entry + (d * pnl) / p.oz0;
  const tr: Trade = {
    id: p.id,
    dir: d,
    openTime: p.openTime,
    closeTime: t,
    entry: p.entry,
    exit: avgExit,
    sl0: p.sl0,
    tp1: p.tp1,
    tp2: p.tp2,
    oz: p.oz0,
    pnl,
    r: pnl / p.riskAmt,
    reason,
    score: p.score,
    primary: p.primary,
    contributors: p.contributors,
    reasons: p.reasons,
    replay: p.replay,
    regime: p.regime,
    session: p.session,
  };
  st.position = null;
  st.balance += pnl;
  st.peak = Math.max(st.peak, st.balance);
  st.day.pnl += pnl;
  st.trades.push(tr);
  if (tr.r < -0.1) {
    st.lossStreak++;
    st.lastLoss = { dir: d, t };
    if (st.lossStreak >= 2) {
      st.cooldownUntil = t + 2 * 3_600_000;
      st.lossStreak = 0;
    }
  } else if (tr.r > 0.1) st.lossStreak = 0;
  learn(st, tr);
  return tr;
}

// Intrabar management on a candle (or a tick when o = h = l = c). Returns the closed trade, if any.
export function manageBar(st: TraderState, k: Candle, t: number, spread: number): Trade | null {
  const p = st.position;
  if (!p) return null;
  const d: Dir = p.dir;
  const half = spread / 2;
  const exitAt = (mid: number) => mid - d * half; // longs exit on the bid, shorts on the ask
  const adverse = exitAt(d === 1 ? k.l : k.h);
  const favor = exitAt(d === 1 ? k.h : k.l);
  const atOpen = exitAt(k.o);
  if (d * (adverse - p.sl) <= 0) {
    const fill = (d * (atOpen - p.sl) < 0 ? atOpen : p.sl) - d * SLIPPAGE;
    const reason: ExitReason = !p.tp1Done ? "SL" : d * (p.sl - p.entry) > 0.05 ? "TRAIL" : "BE";
    return closePosition(st, fill, t, reason);
  }
  if (!p.tp1Done && d * (favor - p.tp1) >= 0) {
    const half1 = Math.max(1, Math.floor(p.oz / 2));
    if (half1 < p.oz) {
      p.realized += d * (p.tp1 - p.entry) * half1;
      p.oz -= half1;
    }
    p.tp1Done = true;
    p.sl = p.entry; // break-even on the runner
  }
  if (p.tp1Done && d * (favor - p.tp2) >= 0) return closePosition(st, p.tp2, t, "TP2");
  p.bestPrice = d === 1 ? Math.max(p.bestPrice, k.h) : Math.min(p.bestPrice, k.l);
  return null;
}

// End-of-candle housekeeping: trailing stop, time stop, weekend flat.
export function endOfBar(st: TraderState, m: Market, i: number, spread: number): Trade | null {
  const p = st.position;
  if (!p) return null;
  const s = m.ltf;
  const t = s.c[i].t + s.tf * 60000;
  const d = p.dir;
  const a = s.atr[i];
  const close = s.close[i];
  const exitMid = close - (d * spread) / 2;
  p.barsHeld++;
  if (weekendRisk(t) === "flatten") return closePosition(st, exitMid, t, "WEEKEND");
  const risk = d * (p.entry - p.sl0);
  if (!p.tp1Done && p.barsHeld >= Math.round(480 / s.tf) && d * (exitMid - p.entry) < 0.3 * risk) {
    return closePosition(st, exitMid, t, "TEMPS");
  }
  if (p.tp1Done) {
    const trail = p.bestPrice - d * 2.5 * a;
    if (d * (trail - p.sl) > 0 && d * (close - trail) > 0) p.sl = trail;
  }
  return null;
}

export interface SimEvent {
  kind: "open" | "close";
  t: number;
  trade?: Trade;
  position?: Position;
}

export interface SimOptions {
  replay: boolean;
  allowEntries?: boolean; // false = only manage the open position (autopilot off)
  onDecision?: (d: Decision, i: number) => void;
  onEvent?: (e: SimEvent) => void;
}

// Walk-forward simulation over closed candles [from, to]. Entries fill at the next candle's open.
export function simulate(env: AnalyseEnv, st: TraderState, from: number, to: number, opts: SimOptions) {
  const s = env.m.ltf;
  const tfMs = s.tf * 60000;
  const spread = env.settings.spread;
  for (let i = from; i <= to; i++) {
    const k = s.c[i];
    const tClose = k.t + tfMs;
    if (st.pending) {
      const plan = st.pending;
      st.pending = null;
      const p = openPosition(st, plan, k.o, k.t, env.settings, s.atr[i - 1], opts.replay);
      if (p) opts.onEvent?.({ kind: "open", t: k.t, position: { ...p } });
    }
    if (st.position) {
      const tr = manageBar(st, k, tClose, spread) ?? endOfBar(st, env.m, i, spread);
      if (tr) opts.onEvent?.({ kind: "close", t: tClose, trade: tr });
    }
    rollDay(st, tClose);
    // every candle teaches, position or not: settle old signals, then file the new ones
    const mem = (st.mem ??= emptyMemory());
    resolveShadows(mem, k, tClose, spread);
    const dec = analyse(env, st, i);
    rememberDecision(st, dec, spread);
    if (!st.position) {
      opts.onDecision?.(dec, i);
      if (dec.plan && opts.allowEntries !== false) st.pending = dec.plan;
    }
  }
}

export function rememberDecision(st: TraderState, dec: Decision, spread: number) {
  if (dec.session === "FERME" || dec.session === "ROLLOVER") return;
  recordShadows((st.mem ??= emptyMemory()), dec.votes, dec.t, dec.regime, dec.price, spread);
}

export function warmupIndex(m: Market): number {
  for (let i = 210; i < m.ltf.c.length; i++) {
    const j4 = m.m4[i];
    if (j4 >= 50 && !Number.isNaN(m.ltf.atr[i])) return i;
  }
  return m.ltf.c.length;
}
