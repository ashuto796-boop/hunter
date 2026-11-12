// Edge map: every signal of every specialist over 5 years, traded alone with its own stop and
// target (spread included, 8 h at most, first touch wins). Shows where each specialist has a
// real edge (by direction, market state, session, H1/H4 agreement), on 2022-2024 and 2025-2026.
//
//   npx tsx backtest/edges.ts --data backtest/data [--tf 15]
import { readFileSync } from "fs";
import { aggregate, buildMarket } from "../src/gold/engine/features";
import { computeBias, computeRegime } from "../src/gold/engine/brain";
import { runModules } from "../src/gold/engine/modules";
import { killzone, sessionAt } from "../src/gold/engine/context";
import { warmupIndex } from "../src/gold/engine/trader";
import { Candle } from "../src/gold/engine/types";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const DATA = opt("data", "backtest/data");
const TF = Number(opt("tf", "15"));
const SPREAD = 0.4;
const SPLIT = Date.UTC(2025, 0, 1);
const load = (f: string) => JSON.parse(readFileSync(`${DATA}/${f}.json`, "utf8")) as Candle[];
const raw = load("xau_m15").map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }));
const c = TF === 15 ? raw : aggregate(raw, TF);
const m = buildMarket(c, TF, { xag: load("xag_h1"), eur: load("eur_h1") });
const s = m.ltf;
const HOLD_H = Number(opt("hold", "8")); // hours a signal may run
const maxBars = Math.max(1, Math.round((HOLD_H * 60) / TF));

type Row = { id: string; dir: number; regime: string; session: string; kz: boolean; withBias: boolean; t: number; r: number; strength: number };
const rows: Row[] = [];
let last: Record<string, number> = {};
for (let i = warmupIndex(m); i < c.length - maxBars - 1; i++) {
  const t = c[i].t + TF * 60000;
  const session = sessionAt(t);
  if (session === "FERME" || session === "ROLLOVER") continue;
  const regime = computeRegime(m, i);
  const bias = computeBias(m, i);
  const kz = !!killzone(t);
  for (const v of runModules(m, i, (d) => ({ bias: d * bias, regime, session, killzone: killzone(t) }))) {
    const key = `${v.id}:${v.dir}`;
    if (last[key] !== undefined && i - last[key] < Math.max(1, Math.round(60 / TF))) continue; // one signal per hour per specialist and side
    last[key] = i;
    const d = v.dir;
    const entry = c[i + 1].o + (d * SPREAD) / 2;
    const risk = d * (entry - v.sl);
    if (!(risk > 0.3 * s.atr[i])) continue;
    let r = 0;
    let done = false;
    for (let j = i + 1; j <= i + maxBars && !done; j++) {
      const k = c[j];
      const adverse = (d === 1 ? k.l : k.h) - (d * SPREAD) / 2;
      const favor = (d === 1 ? k.h : k.l) - (d * SPREAD) / 2;
      if (d * (adverse - v.sl) <= 0) {
        r = -1;
        done = true;
      } else if (d * (favor - v.tp) >= 0) {
        r = (d * (v.tp - entry)) / risk;
        done = true;
      }
    }
    if (!done) r = (d * (c[i + maxBars].c - (d * SPREAD) / 2 - entry)) / risk;
    rows.push({ id: v.id, dir: d, regime, session, kz, withBias: d * bias > 0, t, r, strength: v.strength });
  }
}

const groups = (key: (x: Row) => string) => {
  const g = new Map<string, { is: number[]; oos: number[] }>();
  for (const x of rows) {
    const k = key(x);
    if (!g.has(k)) g.set(k, { is: [], oos: [] });
    (x.t < SPLIT ? g.get(k)!.is : g.get(k)!.oos).push(x.r);
  }
  return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};
const st = (xs: number[]) => (xs.length ? `${String(xs.length).padStart(5)} ${(xs.reduce((a, b) => a + b, 0) / xs.length >= 0 ? "+" : "") + (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)}` : "    0     —");
const show = (title: string, key: (x: Row) => string, minN = 30) => {
  console.log(`\n== ${title} (signaux · R moyen)   2022-24 | 2025-26`);
  for (const [k, v] of groups(key)) if (v.is.length + v.oos.length >= minN) console.log(`${k.padEnd(40)} ${st(v.is)} | ${st(v.oos)}`);
};
console.log(`${rows.length} signaux, M${TF}, ${HOLD_H} h max`);
show("spécialiste", (x) => x.id);
show("spécialiste × sens", (x) => `${x.id} ${x.dir === 1 ? "achat" : "vente"}`);
show("spécialiste × avec H1/H4", (x) => `${x.id} ${x.withBias ? "avec" : "contre"}`);
show("spécialiste × état", (x) => `${x.id} ${x.regime}`);
show("spécialiste × session", (x) => `${x.id} ${x.session}`);
show("spécialiste × killzone", (x) => `${x.id} ${x.kz ? "killzone" : "hors"}`);
show("spécialiste × force", (x) => `${x.id} ${x.strength >= 0.75 ? "fort" : "faible"}`);
