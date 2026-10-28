// The trader's memory. Every signal of every specialist becomes a "shadow trade", traded or not,
// and is resolved later on real candles (stop or target first, worst case inside a candle).
// This gives the brain hundreds of lessons instead of a few dozen real trades, and lets it recall
// how situations like the current one played out ("déjà vu"), nearest neighbours in feature space.
// Only shadows already resolved at decision time are ever used: no look-ahead.
import { Candle, Dir, ModuleId, ModuleStats, Regime } from "./types";

export interface Shadow {
  t: number; // decision time
  dir: Dir;
  regime: Regime;
  f: number[]; // situation features, normalised for the signal's direction
  entry: number;
  sl: number;
  tp: number;
  bars: number;
  r: number; // outcome in R (spread included) once resolved
  done: number; // resolution time, 0 while pending
}

export interface Memory {
  pending: (Shadow & { id: ModuleId })[];
  done: Partial<Record<ModuleId, Shadow[]>>;
  stats: Record<string, ModuleStats>; // decayed outcome stats per module and per module:regime
  total: number;
}

export interface DejaVu {
  n: number; // neighbours used
  win: number; // weighted share of winners
  expR: number; // shrunk expectancy in R
}

const MAX_PER_MODULE = 900;
const MAX_BARS = 48; // unresolved after 12 h on M15: marked to market
const DECAY = 0.997; // recent lessons count more (half-life ≈ 230 shadows)
const K = 30;

export const emptyMemory = (): Memory => ({ pending: [], done: {}, stats: {}, total: 0 });

const statKey = (id: ModuleId, r?: Regime) => (r ? `${id}:${r === "TREND_UP" || r === "TREND_DOWN" ? "TREND" : r}` : id);

function learn(mem: Memory, key: string, r: number) {
  const s = (mem.stats[key] ??= { n: 0, wins: 0, sumR: 0 });
  s.n = s.n * DECAY + 1;
  s.sumR = s.sumR * DECAY + r;
  s.wins = s.wins * DECAY + (r > 0 ? 1 : 0);
}

// Settle pending shadows against a closed candle
export function resolveShadows(mem: Memory, k: Candle, tClose: number, spread: number) {
  const keep: Memory["pending"] = [];
  for (const p of mem.pending) {
    p.bars++;
    const d = p.dir;
    const risk = d * (p.entry - p.sl);
    const exit = (mid: number) => mid - (d * spread) / 2;
    let r: number | null = null;
    if (d * (exit(d === 1 ? k.l : k.h) - p.sl) <= 0) r = (d * (p.sl - p.entry) - 0.05) / risk;
    else if (d * (exit(d === 1 ? k.h : k.l) - p.tp) >= 0) r = (d * (p.tp - p.entry)) / risk;
    else if (p.bars >= MAX_BARS) r = (d * (exit(k.c) - p.entry)) / risk;
    if (r === null) {
      keep.push(p);
      continue;
    }
    const { id, ...shadow } = p;
    shadow.r = Math.round(r * 100) / 100;
    shadow.done = tClose;
    const list = (mem.done[id] ??= []);
    list.push(shadow);
    if (list.length > MAX_PER_MODULE) list.splice(0, list.length - MAX_PER_MODULE);
    learn(mem, statKey(id), shadow.r);
    learn(mem, statKey(id, shadow.regime), shadow.r);
  }
  mem.pending = keep;
}

export interface ShadowVote {
  id: ModuleId;
  dir: Dir;
  sl: number;
  tp: number;
  f: number[];
}

// New signals become shadows (one live shadow per module and direction at a time)
export function recordShadows(mem: Memory, votes: ShadowVote[], t: number, regime: Regime, mid: number, spread: number) {
  for (const v of votes) {
    if (mem.pending.some((p) => p.id === v.id && p.dir === v.dir && p.bars < 4)) continue;
    const entry = mid + (v.dir * spread) / 2;
    if (v.dir * (entry - v.sl) <= 0 || v.dir * (v.tp - entry) <= 0) continue;
    mem.pending.push({ id: v.id, t, dir: v.dir, regime, f: v.f.map((x) => Math.round(x * 100) / 100), entry, sl: v.sl, tp: v.tp, bars: 0, r: 0, done: 0 });
    mem.total++;
  }
}

// Nearest past situations of the same specialist, weighted by similarity, shrunk toward its record
export function recall(mem: Memory, id: ModuleId, f: number[], t: number): DejaVu | null {
  const list = mem.done[id];
  if (!list || list.length < 12) return null;
  const near: { d: number; r: number }[] = [];
  for (const s of list) {
    if (s.done > t) continue;
    let d = 0;
    for (let j = 0; j < f.length; j++) d += (f[j] - (s.f[j] ?? 0)) ** 2;
    near.push({ d: Math.sqrt(d), r: s.r });
  }
  if (near.length < 12) return null;
  near.sort((a, b) => a.d - b.d);
  const top = near.slice(0, K);
  const ws = top.map((x) => 1 / (0.15 + x.d));
  const mean = ws.reduce((a, b) => a + b, 0) / ws.length;
  let sumR = 0;
  let wins = 0;
  top.forEach((x, j) => {
    const w = ws[j] / mean;
    sumR += w * x.r;
    if (x.r > 0) wins += w;
  });
  const st = mem.stats[statKey(id)];
  const prior = st && st.n > 0 ? st.sumR / st.n : 0;
  const M = 6;
  return { n: top.length, win: wins / top.length, expR: (sumR + M * prior) / (top.length + M) };
}

export function memoryStats(mem: Memory | undefined, id: ModuleId, r?: Regime): ModuleStats | undefined {
  return mem?.stats[statKey(id, r)];
}
