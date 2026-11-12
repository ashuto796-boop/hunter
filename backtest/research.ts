// Strategy research on 5 years of real gold prices. Each idea is a set of rule changes
// (src/gold/engine/strategy.ts). It is judged on 2022-2024 (where ideas are tuned) and, separately,
// on 2025-2026 (never used to choose): an idea is kept only if it helps in both periods.
//
//   npx tsx backtest/research.ts --data backtest/data [--only name,name] [--wf]
import { readFileSync, writeFileSync } from "fs";
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
      const w = c.slice(idx(T - (settings.trainDays + 10) * DAY), idx(T));
      if (w.length < 400) continue;
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
    if (args.includes("--detail")) {
      const by = (k: (t: Trade) => string) => {
        const g: Record<string, Trade[]> = {};
        for (const t of r.trades) (g[k(t)] ??= []).push(t);
        return Object.entries(g)
          .sort()
          .map(([n, v]) => `${n} ${v.length}tr ${v.reduce((a, t) => a + t.r, 0) >= 0 ? "+" : ""}${v.reduce((a, t) => a + t.r, 0).toFixed(1)}R`)
          .join(" · ");
      };
      console.log("   années :", by((t) => String(new Date(t.openTime).getUTCFullYear())));
      console.log("   sens   :", by((t) => `${t.dir === 1 ? "achat" : "vente"}-${t.openTime < SPLIT ? "22/24" : "25/26"}`));
      console.log("   spécialiste :", by((t) => t.primary));
    }
  }
}

const FIN = { financingPctYear: 5 };
// AURUM Swing: 4-hour candles, trades held for days. Specialists kept = positive on 2022-2024
// only (backtest/edges.ts, 4 h, 5-day holds): divergence, momentum, squeeze, sweep with the trend.
const SWING_BASE = { base: { pullback: 0, london: 0, reversion: 0 } };
const swingRules = (extra: Partial<Strategy> = {}): Partial<Strategy> => ({
  ...FIN,
  ...SWING_BASE,
  sweepMinBias: 0,
  sessionWeight: false,
  timeStopMin: 5 * 1440,
  weekendFlat: false,
  ...extra,
});
const PURE = { tp1Fraction: 0, beAfterTp1: false, trailAtr: 0 };
const sw = (name: string, threshold: number, extra: Partial<Strategy> = {}, settings: Partial<Settings> = {}): Idea => ({
  name,
  tf: 240,
  threshold,
  rules: swingRules(extra),
  settings: { trainDays: 365, maxTradesDay: 2, ...settings },
});
// Systematic search: every combination below (256 strategies), judged on 2022-2024 only.
function grid(): Idea[] {
  const out: Idea[] = [];
  for (const tf of [30, 60, 120, 240])
    for (const threshold of [30, 40, 50, 61])
      for (const shorts of [-1, 0.5])
        for (const exits of ["mixte", "simple"] as const)
          for (const hold of ["journée", "plusieurs jours"] as const)
            for (const team of ["4 spécialistes", "7 spécialistes"] as const)
              out.push({
                name: `M${tf} s${threshold} ventes${shorts < 0 ? "=libres" : ">0.5"} ${exits} ${hold} ${team}`,
                tf,
                threshold,
                rules: {
                  ...FIN,
                  ...(team === "4 spécialistes" ? { ...SWING_BASE, sweepMinBias: 0 } : {}),
                  ...(exits === "simple" ? PURE : {}),
                  minBiasShort: shorts,
                  sessionWeight: tf <= 60,
                  ...(hold === "journée" ? { timeStopMin: 480, weekendFlat: true } : { timeStopMin: 5 * 1440, weekendFlat: false }),
                },
                settings: { trainDays: tf >= 120 ? 365 : 120, maxTradesDay: 4 },
              });
  return out;
}

const CHAMPION: Idea = {
  name: "champion M120",
  tf: 120,
  threshold: 30,
  rules: { ...FIN, ...SWING_BASE, sweepMinBias: 0, ...PURE, minBiasShort: 0.5, sessionWeight: false, timeStopMin: 480, weekendFlat: true },
  settings: { trainDays: 365, maxTradesDay: 4 },
};
const IDEAS: Idea[] = [
  CHAMPION,
  { ...CHAMPION, name: "champion, écart de prix ×2", settings: { ...CHAMPION.settings, spread: 0.8 } },
  { ...CHAMPION, name: "champion, financement 8 %", rules: { ...CHAMPION.rules, financingPctYear: 8 } },
  { ...CHAMPION, name: "champion, entraînement 120 j", settings: { ...CHAMPION.settings, trainDays: 120 } },
  sw("swing s30", 30),
  sw("swing s30 ventes si tendance > 0.3", 30, { minBiasShort: 0.3 }),
  sw("swing s30 ventes si tendance > 0.5", 30, { minBiasShort: 0.5 }),
  sw("swing s30 ventes si tendance > 0.7", 30, { minBiasShort: 0.7 }),
  sw("swing s30 achats seulement", 30, { minBiasShort: 2 }),
  sw("swing s50 simples, ventes > 0.5", 50, { ...PURE, minBiasShort: 0.5 }),
];
async function searchGrid(file: string) {
  const ideas = grid();
  const rows: { name: string; is: ReturnType<typeof period>; oos: ReturnType<typeof period>; dd: number }[] = [];
  const t0 = Date.now();
  for (const [k, idea] of ideas.entries()) {
    const r = await evaluate(idea);
    rows.push({ name: r.name, is: r.is, oos: r.oos, dd: r.dd });
    if ((k + 1) % 32 === 0) console.log(`${k + 1}/${ideas.length} stratégies (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  writeFileSync(file, JSON.stringify(rows, null, 1));
  console.log(`résultats : ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (args.includes("--grid")) searchGrid(opt("save", "grid.json"));
  else runAll(IDEAS);
}
