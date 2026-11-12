// Strategy research on 5 years of real gold prices. Each idea is a set of rule changes
// (src/gold/engine/strategy.ts). It is judged on 2022-2024 (where ideas are tuned) and, separately,
// on 2025-2026 (never used to choose): an idea is kept only if it helps in both periods.
//
//   npx tsx backtest/research.ts --data backtest/data [--only name,name] [--wf]
import { readFileSync } from "fs";
import { aggregate, buildMarket, Peers } from "../src/gold/engine/features";
import { newTraderState, simulate, warmupIndex } from "../src/gold/engine/trader";
import { train } from "../src/gold/engine/training";
import { DEFAULT_SETTINGS } from "../src/gold/engine/defaults";
import { Strategy, useStrategy } from "../src/gold/engine/strategy";
import { Candle, Settings, Trade } from "../src/gold/engine/types";

const DAY = 864e5;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const DATA = opt("data", "backtest/data");
const ONLY = opt("only", "").split(",").filter(Boolean);
const WF = args.includes("--wf");
const SPLIT = Date.UTC(2025, 0, 1);

const load = (f: string) => JSON.parse(readFileSync(`${DATA}/${f}.json`, "utf8")) as (Candle & { s?: number })[];
const m15: Candle[] = load("xau_m15").map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }));
const peers: Peers = { xag: load("xag_h1"), eur: load("eur_h1") };
const markets = new Map<number, { c: Candle[]; m: ReturnType<typeof buildMarket> }>();
const market = (tf: number) => {
  if (!markets.has(tf)) {
    const c = tf === 15 ? m15 : aggregate(m15, tf);
    markets.set(tf, { c, m: buildMarket(c, tf, peers) });
  }
  return markets.get(tf)!;
};

export interface Idea {
  name: string;
  rules?: Partial<Strategy>;
  tf?: number;
  threshold?: number;
  settings?: Partial<Settings>;
}

function period(trades: Trade[]) {
  const n = trades.length;
  let gp = 0;
  let gl = 0;
  let sumR = 0;
  let wins = 0;
  for (const t of trades) {
    sumR += t.r;
    if (t.r > 0) {
      gp += t.r;
      wins++;
    } else gl -= t.r;
  }
  return { n, sumR, pf: gl ? gp / gl : gp ? Infinity : 0, win: n ? wins / n : 0 };
}

function maxDDR(trades: Trade[]) {
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of [...trades].sort((a, b) => a.closeTime - b.closeTime)) {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  return dd;
}

export async function evaluate(idea: Idea) {
  useStrategy(idea.rules ?? {});
  const tf = idea.tf ?? 15;
  const { c, m } = market(tf);
  const settings: Settings = { ...DEFAULT_SETTINGS, server: false, tf: tf as Settings["tf"], spread: 0.4, ...idea.settings };
  let trades: Trade[];
  if (!WF) {
    const st = newTraderState(settings.capital);
    simulate({ m, settings, news: [], threshold: idea.threshold ?? 61 }, st, warmupIndex(m), c.length - 1, { replay: false });
    trades = st.trades;
  } else {
    // walk-forward exactly like the server: retrain every 5 days on the previous 60
    const st = newTraderState(settings.capital);
    const idx = (t: number) => {
      let lo = 0;
      let hi = c.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (c[mid].t < t) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    for (let T = c[0].t + 72 * DAY; T < c[c.length - 1].t; T += 5 * DAY) {
      const w = c.slice(idx(T - 70 * DAY), idx(T));
      if (w.length < (1000 * 15) / tf) continue;
      const tr = await train({ m: buildMarket(w, tf, { xag: peers.xag?.filter((k) => k.t >= T - 100 * DAY && k.t < T), eur: peers.eur?.filter((k) => k.t >= T - 100 * DAY && k.t < T) }), settings, news: [] }, "dukascopy");
      st.brain = tr.st.brain;
      st.ctx = tr.st.ctx;
      st.mem = tr.st.mem;
      const from = Math.max(idx(T), warmupIndex(m));
      const to = idx(T + 5 * DAY) - 1;
      if (to >= from) simulate({ m, settings, news: [], threshold: idea.threshold ?? tr.threshold }, st, from, to, { replay: false });
    }
    trades = st.trades;
  }
  const is = period(trades.filter((t) => t.openTime < SPLIT));
  const oos = period(trades.filter((t) => t.openTime >= SPLIT));
  return { name: idea.name, is, oos, dd: maxDDR(trades), trades };
}

const fmt = (p: ReturnType<typeof period>) => `${String(p.n).padStart(4)} tr ${(p.sumR >= 0 ? "+" : "") + p.sumR.toFixed(1).padStart(6)}R pf ${Number.isFinite(p.pf) ? p.pf.toFixed(2) : "∞"} ${(p.win * 100).toFixed(0)}%`;

export function line(r: Awaited<ReturnType<typeof evaluate>>) {
  return `${r.name.padEnd(34)} | 2022-24 ${fmt(r.is)} | 2025-26 ${fmt(r.oos)} | creux ${r.dd.toFixed(1)}R`;
}

export async function runAll(ideas: Idea[]) {
  for (const idea of ideas) {
    if (ONLY.length && !ONLY.includes(idea.name)) continue;
    const t0 = Date.now();
    const r = await evaluate(idea);
    console.log(line(r), `(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
}

const FIN = { financingPctYear: 5 };
const H4 = (name: string, extra: Partial<Strategy>, threshold = 55, tf = 240): Idea => ({
  name,
  tf,
  threshold,
  rules: { ...FIN, timeStopMin: 5 * 1440, weekendFlat: false, sessionWeight: false, ...extra },
  settings: { trainDays: 365, maxTradesDay: 2 },
});
const PICK = { base: { london: 0, reversion: 0 } };
const IDEAS: Idea[] = [
  H4("H4 sans poids de session s55", {}),
  H4("H4 sens tendance s55", { minBias: 0 }),
  H4("H4 sens tendance s45", { minBias: 0 }, 45),
  H4("H4 sens tendance s65", { minBias: 0 }, 65),
  H4("H4 tendance + sélection s50", { minBias: 0, ...PICK }, 50),
  H4("H4 tendance + sélection s45", { minBias: 0, ...PICK }, 45),
  H4("H4 tendance + sélection sans BE s50", { minBias: 0, ...PICK, beAfterTp1: false }, 50),
  H4("H4 tendance + sélection trail 3.5", { minBias: 0, ...PICK, trailAtr: 3.5 }, 50),
  H4("H2 tendance + sélection s50", { minBias: 0, ...PICK }, 50, 120),
  H4("H1 tendance + sélection s50", { minBias: 0, ...PICK }, 50, 60),
];
if (import.meta.url === `file://${process.argv[1]}`) runAll(IDEAS);
