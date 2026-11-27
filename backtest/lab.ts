// AURUM strategy lab: searches and refines strategies every night on real gold prices.
//
// Each night, several machines each try new rule sets for a fixed time: half are random (to
// explore), half are small changes of the best ones found so far (to refine). Every rule set is
// traded walk-forward exactly like the server (backtest/research.ts), spread and financing
// included. The lab is built against luck:
//   - rule sets are ranked on 2021-2024 only ("apprentissage");
//   - a rule set is "qualifiée" only if 2025 onwards also makes money with a sound profit factor
//     and a limited worst run ("validation");
//   - it is "confirmée" only after it kept making money on days that did not exist yet when it
//     was found ("en direct"), at least 30 of them, and with a spread 50 % wider.
// The leaderboard and a report in French are kept on the aurum-lab branch (lab.json, lab.md,
// champion.json). Nothing here touches the bot: the champion is a proposal.
//
//   worker: npx tsx backtest/lab.ts --wf --data backtest/data --state lab.json --worker 0 --workers 8 --minutes 40 --out part-0.jsonl
//   merge:  npx tsx backtest/lab.ts --merge parts --data backtest/data --state lab.json --report lab.md --champion champion.json
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { evaluate, Idea } from "./research";
import { AURUM_2H, AURUM_30M, Strategy } from "../src/gold/engine/strategy";
import { ModuleId, Regime, Session, Trade } from "../src/gold/engine/types";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const DAY = 864e5;
const TRAIN_END = Date.UTC(2025, 0, 1);
const NOW = Date.now();

// ---------------------------------------------------------------------------------------------------
// What a rule set is
// ---------------------------------------------------------------------------------------------------
export interface Spec {
  tf: 15 | 30 | 60 | 120 | 240;
  threshold: number;
  trainDays: number;
  maxTradesDay: number;
  rules: Partial<Strategy>;
}
interface Period {
  n: number;
  sumR: number;
  pf: number;
  win: number;
  days: number;
}
interface Metrics {
  train: Period;
  valid: Period;
  live: Period; // after foundAt
  years: Record<string, number>;
  dd: number;
  perYear: number;
  stress?: number; // total R with a 50 % wider spread
  score: number; // ranking, on 2021-2024 only
}
interface Entry {
  id: string;
  spec: Spec;
  foundAt: number;
  origin: string; // "hasard", "affinage de <id>", "référence"
  m: Metrics;
  status: "rejetée" | "candidate" | "qualifiée" | "confirmée";
  checkedAt: number;
}
interface LabState {
  version: 1;
  updatedAt: number;
  nights: number;
  tried: number;
  dataFrom: number;
  dataTo: number;
  entries: Entry[];
  champion: string | null;
  history: { t: number; tried: number; qualified: number; champion: string | null }[];
}

const MODULES: ModuleId[] = ["sweep", "pullback", "london", "squeeze", "momentum", "reversion", "divergence"];
const TFS: Spec["tf"][] = [15, 30, 60, 120, 240];
const pick = <T>(rnd: () => number, xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const CHOICES = {
  threshold: [5, 10, 15, 20, 25, 30, 35, 40, 50, 61, 70],
  trainDays: [60, 120, 365],
  maxTradesDay: [2, 4, 6, 10],
  weight: [0, 0, 0.5, 1, 1, 1.5],
  sweepMinBias: [-1, 0, 0.3],
  minBias: [-1, -1, 0, 0.2, 0.4],
  minBiasShort: [-1, 0, 0.3, 0.5, 0.7],
  tp1Fraction: [0, 0, 0.33, 0.5],
  trailAtr: [0, 0, 1.5, 2.5, 4],
  timeStopMin: [120, 240, 480, 1440, 4320, 7200],
  cooldownMin: [15, 60, 120],
};

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSpec(rnd: () => number): Spec {
  const tf = pick(rnd, TFS);
  const base: Partial<Record<ModuleId, number>> = {};
  for (const id of MODULES) {
    const w = pick(rnd, CHOICES.weight);
    if (w !== 1) base[id] = w;
  }
  if (MODULES.every((id) => base[id] === 0)) delete base.momentum;
  const blockRegimes = (["VOLATILE", "RANGE", "SQUEEZE"] as Regime[]).filter(() => rnd() < 0.2);
  const blockSessions = (["ASIE"] as Session[]).filter(() => rnd() < 0.3);
  return {
    tf,
    threshold: pick(rnd, CHOICES.threshold),
    trainDays: tf === 15 ? pick(rnd, [60, 120]) : pick(rnd, CHOICES.trainDays),
    maxTradesDay: pick(rnd, CHOICES.maxTradesDay),
    rules: {
      base,
      sweepKillzoneOnly: rnd() < 0.3,
      sweepMinBias: pick(rnd, CHOICES.sweepMinBias),
      sweepNeedFvg: rnd() < 0.2,
      minBias: pick(rnd, CHOICES.minBias),
      minBiasShort: pick(rnd, CHOICES.minBiasShort),
      blockRegimes,
      blockSessions,
      tp1Fraction: pick(rnd, CHOICES.tp1Fraction),
      beAfterTp1: rnd() < 0.5,
      trailAtr: pick(rnd, CHOICES.trailAtr),
      timeStopMin: pick(rnd, CHOICES.timeStopMin),
      weekendFlat: rnd() < 0.6,
      sessionWeight: tf <= 60 ? rnd() < 0.6 : false,
      cooldownMin: pick(rnd, CHOICES.cooldownMin),
    },
  };
}

// A small change: one to three knobs of a good rule set
function mutate(rnd: () => number, s: Spec): Spec {
  const out: Spec = structuredClone(s);
  const r = out.rules;
  const knobs = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < knobs; k++) {
    switch (Math.floor(rnd() * 14)) {
      case 0: {
        const i = TFS.indexOf(out.tf) + (rnd() < 0.5 ? -1 : 1);
        out.tf = TFS[Math.max(0, Math.min(TFS.length - 1, i))];
        if (out.tf === 15 && out.trainDays > 120) out.trainDays = 120;
        break;
      }
      case 1:
      case 2: {
        const i = CHOICES.threshold.indexOf(out.threshold) + (rnd() < 0.5 ? -1 : 1);
        out.threshold = CHOICES.threshold[Math.max(0, Math.min(CHOICES.threshold.length - 1, i))];
        break;
      }
      case 3: {
        const id = pick(rnd, MODULES);
        const w = pick(rnd, CHOICES.weight);
        r.base = { ...r.base };
        if (w === 1) delete r.base[id];
        else r.base[id] = w;
        break;
      }
      case 4:
        r.minBiasShort = pick(rnd, CHOICES.minBiasShort);
        break;
      case 5:
        r.minBias = pick(rnd, CHOICES.minBias);
        break;
      case 6:
        r.tp1Fraction = pick(rnd, CHOICES.tp1Fraction);
        r.beAfterTp1 = rnd() < 0.5;
        break;
      case 7:
        r.trailAtr = pick(rnd, CHOICES.trailAtr);
        break;
      case 8:
        r.timeStopMin = pick(rnd, CHOICES.timeStopMin);
        r.weekendFlat = r.timeStopMin <= 1440 ? rnd() < 0.8 : rnd() < 0.3;
        break;
      case 9:
        r.sweepKillzoneOnly = !r.sweepKillzoneOnly;
        r.sweepMinBias = pick(rnd, CHOICES.sweepMinBias);
        break;
      case 10:
        r.blockRegimes = (["VOLATILE", "RANGE", "SQUEEZE"] as Regime[]).filter(() => rnd() < 0.2);
        break;
      case 11:
        r.blockSessions = rnd() < 0.5 ? [] : ["ASIE"];
        break;
      case 12:
        out.maxTradesDay = pick(rnd, CHOICES.maxTradesDay);
        r.cooldownMin = pick(rnd, CHOICES.cooldownMin);
        break;
      default:
        out.trainDays = out.tf === 15 ? pick(rnd, [60, 120]) : pick(rnd, CHOICES.trainDays);
    }
  }
  if (out.tf > 60) r.sessionWeight = false;
  return out;
}

const canon = (s: Spec) => JSON.stringify(s, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
function idOf(s: Spec) {
  let h = 2166136261;
  for (const ch of canon(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `S${(h >>> 0).toString(36).toUpperCase()}`;
}

// ---------------------------------------------------------------------------------------------------
// Judging a rule set
// ---------------------------------------------------------------------------------------------------
function period(ts: Trade[], from: number, to: number): Period {
  let gp = 0, gl = 0, sumR = 0, wins = 0;
  for (const t of ts) {
    sumR += t.r;
    if (t.r > 0) (gp += t.r), wins++;
    else gl -= t.r;
  }
  return { n: ts.length, sumR, pf: gl ? gp / gl : gp ? 9.99 : 0, win: ts.length ? wins / ts.length : 0, days: Math.max(0, (to - from) / DAY) };
}
function maxDD(ts: Trade[]) {
  let eq = 0, pk = 0, dd = 0;
  for (const t of [...ts].sort((a, b) => a.closeTime - b.closeTime)) {
    eq += t.r;
    pk = Math.max(pk, eq);
    dd = Math.max(dd, pk - eq);
  }
  return dd;
}
function ideaOf(spec: Spec, spread?: number): Idea {
  return {
    name: idOf(spec),
    tf: spec.tf,
    threshold: spec.threshold,
    rules: { financingPctYear: 5, ...spec.rules, fixedThreshold: spec.threshold, realMoney: false },
    settings: { trainDays: spec.trainDays, maxTradesDay: spec.maxTradesDay, ...(spread ? { spread } : {}) },
  };
}
async function judge(spec: Spec, foundAt: number, dataFrom: number, dataTo: number, withStress: boolean): Promise<Metrics> {
  const r = await evaluate(ideaOf(spec));
  const ts = r.trades;
  const train = period(ts.filter((t) => t.openTime < TRAIN_END), dataFrom, TRAIN_END);
  const valid = period(ts.filter((t) => t.openTime >= TRAIN_END && t.openTime < foundAt), TRAIN_END, Math.min(foundAt, dataTo));
  const live = period(ts.filter((t) => t.openTime >= foundAt), foundAt, Math.max(foundAt, dataTo));
  const years: Record<string, number> = {};
  for (const t of ts) {
    const y = String(new Date(t.openTime).getUTCFullYear());
    years[y] = (years[y] ?? 0) + t.r;
  }
  const dd = maxDD(ts);
  const trainYears = Math.max(0.5, train.days / 365);
  const score = (train.sumR - 0.5 * maxDD(ts.filter((t) => t.openTime < TRAIN_END))) / trainYears;
  const m: Metrics = { train, valid, live, years, dd, perYear: ts.length / Math.max(0.5, (dataTo - dataFrom) / DAY / 365), score };
  if (withStress) m.stress = (await evaluate(ideaOf(spec, 0.6))).trades.reduce((s, t) => s + t.r, 0);
  return m;
}
function statusOf(m: Metrics): Entry["status"] {
  const yearsTrain = Object.entries(m.years).filter(([y]) => Number(y) < 2025);
  const losingTrainYears = yearsTrain.filter(([, v]) => v < 0).length;
  const qualified =
    m.score > 0 &&
    m.train.pf >= 1.1 &&
    m.train.n >= 30 * (m.train.days / 365) &&
    losingTrainYears <= 1 &&
    m.valid.sumR > 0 &&
    m.valid.pf >= 1.1 &&
    m.dd <= 25;
  if (!qualified) return m.score > 0 ? "candidate" : "rejetée";
  // on prices that did not exist when it was found: failing there takes it off the board (the
  // demo bot then leaves it), and confirming needs a few real trades, not just 30 quiet days
  if (m.live.sumR <= -6 || (m.live.days >= 30 && m.live.n >= 3 && m.live.sumR <= -3)) return "rejetée";
  const confirmed = m.live.days >= 30 && m.live.n >= 3 && m.live.sumR > 0 && (m.stress ?? -1) > 0;
  return confirmed ? "confirmée" : "qualifiée";
}

// ---------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------
const emptyState = (): LabState => ({ version: 1, updatedAt: 0, nights: 0, tried: 0, dataFrom: 0, dataTo: 0, entries: [], champion: null, history: [] });
const loadState = (f: string): LabState => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as LabState) : emptyState());
function dataRange(dir: string) {
  const c = JSON.parse(readFileSync(join(dir, "xau_m15.json"), "utf8")) as { t: number }[];
  return { from: c[0].t, to: c[c.length - 1].t };
}
// References kept on the board so every new rule set is compared with what the bot already knows
const REFERENCES: { name: string; spec: Spec; foundAt: number }[] = [
  {
    name: "AURUM 2 h",
    foundAt: Date.UTC(2026, 10, 12),
    spec: { tf: 120, threshold: 30, trainDays: 365, maxTradesDay: 4, rules: strip(AURUM_2H) },
  },
  {
    name: "AURUM 30 min",
    foundAt: Date.UTC(2026, 10, 12),
    spec: { tf: 30, threshold: 20, trainDays: 60, maxTradesDay: 10, rules: strip(AURUM_30M) },
  },
];
function strip(s: Strategy): Partial<Strategy> {
  const { fit: _fit, fixedThreshold: _t, realMoney: _r, financingPctYear: _f, ...rest } = s;
  return rest;
}

// ---------------------------------------------------------------------------------------------------
// Worker: refresh some known rule sets, then search until the time is up
// ---------------------------------------------------------------------------------------------------
async function worker() {
  const state = loadState(opt("state", "lab.json"));
  const out = opt("out", "part.jsonl");
  const k = Number(opt("worker", "0"));
  const W = Number(opt("workers", "1"));
  const deadline = NOW + Number(opt("minutes", "30")) * 60000;
  const { from, to } = dataRange(opt("data", "backtest/data"));
  const write = (e: Entry) => appendFileSync(out, JSON.stringify(e) + "\n");
  writeFileSync(out, "");

  // 1. re-judge on today's data the references and every qualified rule set (their live days grow),
  // once a day: with three rounds a day, the day rounds keep their whole time for the search
  const known = state.entries.filter((e) => (e.status === "qualifiée" || e.status === "confirmée" || e.origin === "référence") && NOW - (e.checkedAt ?? 0) > 18 * 3_600_000);
  const refs = REFERENCES.filter((r) => !state.entries.some((e) => e.id === idOf(r.spec)));
  const todo: { spec: Spec; foundAt: number; origin: string }[] = [
    ...known.map((e) => ({ spec: e.spec, foundAt: e.foundAt, origin: e.origin })),
    ...refs.map((r) => ({ spec: r.spec, foundAt: r.foundAt, origin: "référence" })),
  ].filter((_x, i) => i % W === k);
  for (const x of todo) {
    const m = await judge(x.spec, x.foundAt, from, to, true);
    write({ id: idOf(x.spec), spec: x.spec, foundAt: x.foundAt, origin: x.origin, m, status: statusOf(m), checkedAt: NOW });
    console.log(`revu ${idOf(x.spec)} : ${statusOf(m)}`);
  }

  // 2. search: half random, half refinements of the best rule sets so far
  const seen = new Set(state.entries.map((e) => e.id));
  const parents = state.entries
    .filter((e) => e.status !== "rejetée")
    .sort((a, b) => b.m.score - a.m.score)
    .slice(0, 30);
  const rnd = mulberry(Math.floor(NOW / DAY) * 1000 + k);
  let tried = 0;
  while (Date.now() < deadline) {
    const refine = parents.length > 0 && rnd() < 0.5;
    const parent = refine ? parents[Math.floor(Math.pow(rnd(), 2) * parents.length)] : null;
    const spec = parent ? mutate(rnd, parent.spec) : randomSpec(rnd);
    const id = idOf(spec);
    if (seen.has(id)) continue;
    seen.add(id);
    const t0 = Date.now();
    const m = await judge(spec, NOW, from, to, false);
    let status = statusOf(m);
    if (status === "qualifiée") {
      m.stress = (await evaluate(ideaOf(spec, 0.6))).trades.reduce((s, t) => s + t.r, 0);
      status = statusOf(m);
    }
    write({ id, spec, foundAt: NOW, origin: parent ? `affinage de ${parent.id}` : "hasard", m, status, checkedAt: NOW });
    tried++;
    console.log(`${id} M${spec.tf} s${spec.threshold} · ${status} · apprentissage ${m.train.sumR.toFixed(1)}R pf ${m.train.pf.toFixed(2)} · validation ${m.valid.sumR.toFixed(1)}R · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  console.log(`${tried} nouvelles règles essayées`);
}

// ---------------------------------------------------------------------------------------------------
// Merge: fold the night's results into the leaderboard, pick the champion, write the report
// ---------------------------------------------------------------------------------------------------
const fR = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}R`;
function describe(s: Spec) {
  const r = s.rules;
  const team = MODULES.filter((id) => (r.base?.[id] ?? 1) > 0)
    .map((id) => `${id}${r.base?.[id] !== undefined && r.base[id] !== 1 ? `×${r.base[id]}` : ""}`)
    .join(", ");
  const exits = (r.tp1Fraction ?? 0) > 0 ? `${Math.round((r.tp1Fraction ?? 0) * 100)} % à 1R${r.beAfterTp1 ? " puis stop à l'entrée" : ""}${r.trailAtr ? `, suivi ${r.trailAtr} ATR` : ""}` : `objectif unique${r.trailAtr ? `, suivi ${r.trailAtr} ATR` : ""}`;
  return `bougies ${s.tf >= 60 ? `${s.tf / 60} h` : `${s.tf} min`}, score ${s.threshold}, ${team}; ${exits}; sortie après ${r.timeStopMin! >= 1440 ? `${r.timeStopMin! / 1440} j` : `${r.timeStopMin! / 60} h`}${r.minBiasShort !== undefined && r.minBiasShort >= 0 ? `; ventes si tendance ≤ −${r.minBiasShort}` : ""}${r.blockSessions?.length ? "; pas d'Asie" : ""}${r.blockRegimes?.length ? `; évite ${r.blockRegimes.join("/")}` : ""}${r.sweepKillzoneOnly ? "; balayages en killzone" : ""}`;
}
function merge() {
  const stateFile = opt("state", "lab.json");
  const state = loadState(stateFile);
  const dir = opt("merge", "parts");
  const { from, to } = dataRange(opt("data", "backtest/data"));
  const byId = new Map(state.entries.map((e) => [e.id, e]));
  let tried = 0;
  // --restore <older lab.json>: qualified entries it holds and the board lost come back (re-judged
  // on today's data at the next round, their discovery date intact)
  const restore = opt("restore", "");
  if (restore && existsSync(restore)) {
    let back = 0;
    for (const e of (JSON.parse(readFileSync(restore, "utf8")) as LabState).entries)
      if ((e.status === "qualifiée" || e.status === "confirmée") && !byId.has(e.id)) byId.set(e.id, { ...e, checkedAt: 0 }), back++;
    console.log(`${back} stratégies qualifiées récupérées de ${restore}`);
  }
  for (const f of readdirSync(dir, { recursive: true }) as string[]) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const e = JSON.parse(line) as Entry;
      const old = byId.get(e.id);
      if (old) e.foundAt = Math.min(old.foundAt, e.foundAt);
      else tried++;
      if (old && old.origin === "référence") e.origin = "référence";
      byId.set(e.id, e);
    }
  }
  // behavioural twins (same trades: same counts and results in every period) are one strategy:
  // keep the one found first, whose record on new prices is the longest
  const twin = (e: Entry) => [e.spec.tf, e.m.train.n, e.m.train.sumR.toFixed(3), e.m.valid.n, e.m.valid.sumR.toFixed(3), e.m.live.n, e.m.live.sumR.toFixed(3)].join("|");
  const firstOf = new Map<string, Entry>();
  for (const e of [...byId.values()].sort((a, b) => a.foundAt - b.foundAt)) if (e.origin !== "référence" && !firstOf.has(twin(e))) firstOf.set(twin(e), e);
  const twins = [...byId.values()].filter((e) => e.origin !== "référence" && firstOf.get(twin(e)) !== e);
  for (const e of twins) byId.delete(e.id);
  // keep every confirmed one and reference, the 800 most robust qualified ones (the worse of their two
  // periods in R per year, minus a quarter of their worst drawdown per year: the demo bot's own
  // pick), plus the 400 best by score
  const all = [...byId.values()];
  const perYr = (r: number, days: number) => r / Math.max(0.25, days / 365);
  const robust = (e: Entry) => Math.min(perYr(e.m.train.sumR, e.m.train.days), perYr(e.m.valid.sumR + e.m.live.sumR, e.m.valid.days + e.m.live.days)) - (0.25 * e.m.dd) / Math.max(1, (e.m.train.days + e.m.valid.days + e.m.live.days) / 365);
  const keep = new Set(all.filter((e) => e.status === "confirmée" || e.origin === "référence").map((e) => e.id));
  all.filter((e) => e.status === "qualifiée").sort((a, b) => robust(b) - robust(a)).slice(0, 800).forEach((e) => keep.add(e.id));
  // ...and every qualified one already a week into its new prices without losing: the closest to
  // being confirmed, whatever its rank (dropping them would restart their 30 days from zero)
  all.filter((e) => e.status === "qualifiée" && e.m.live.days >= 7 && e.m.live.sumR >= 0).forEach((e) => keep.add(e.id));
  console.log(`${twins.length} doublons retirés ; ${all.filter((e) => e.status === "qualifiée").length} qualifiées, 800 gardées au plus`);
  all.filter((e) => e.status !== "rejetée").sort((a, b) => b.m.score - a.m.score).slice(0, 400).forEach((e) => keep.add(e.id));
  state.entries = all.filter((e) => keep.has(e.id)).sort((a, b) => b.m.score - a.m.score);
  state.nights++;
  state.tried += tried;
  state.updatedAt = Date.now();
  state.dataFrom = from;
  state.dataTo = to;
  // champion: the confirmed rule set that did best on everything it never chose on (validation + live)
  const yearly = (e: Entry) => (e.m.valid.sumR + e.m.live.sumR) / Math.max(0.25, (e.m.valid.days + e.m.live.days) / 365);
  const confirmed = state.entries.filter((e) => e.status === "confirmée").sort((a, b) => yearly(b) - yearly(a));
  state.champion = confirmed[0]?.id ?? null;
  const qualified = state.entries.filter((e) => e.status === "qualifiée" || e.status === "confirmée");
  state.history.push({ t: state.updatedAt, tried, qualified: qualified.length, champion: state.champion });
  state.history = state.history.slice(-120);
  writeFileSync(stateFile, JSON.stringify(state));

  const champ = state.entries.find((e) => e.id === state.champion) ?? null;
  writeFileSync(opt("champion", "champion.json"), JSON.stringify(champ ? { id: champ.id, spec: champ.spec, metrics: champ.m, describe: describe(champ.spec), at: state.updatedAt } : null, null, 1));

  const d = (t: number) => new Date(t).toISOString().slice(0, 10);
  const row = (e: Entry) =>
    `| ${e.id}${e.origin === "référence" ? ` (${REFERENCES.find((r) => idOf(r.spec) === e.id)?.name ?? "référence"})` : ""} | ${e.status} | ${e.m.perYear.toFixed(0)} | ${fR(e.m.train.sumR)} (pf ${e.m.train.pf.toFixed(2)}) | ${fR(e.m.valid.sumR)} (pf ${e.m.valid.pf.toFixed(2)}) | ${e.m.live.days >= 1 ? `${fR(e.m.live.sumR)} sur ${e.m.live.days.toFixed(0)} j` : "—"} | ${e.m.dd.toFixed(0)}R | ${e.m.stress !== undefined ? fR(e.m.stress) : "—"} | ${describe(e.spec)} |`;
  const head = "| Règle | Statut | Trades/an | 2021-2024 | 2025 → découverte | En direct | Pire repli | Écart ×1,5 | Réglages |\n|---|---|---|---|---|---|---|---|---|";
  const refsRows = state.entries.filter((e) => e.origin === "référence");
  const bands: [string, (e: Entry) => boolean][] = [
    ["moins d'un trade par jour", (e) => e.m.perYear < 260],
    ["1 à 3 trades par jour", (e) => e.m.perYear >= 260 && e.m.perYear < 780],
    ["3 trades par jour ou plus", (e) => e.m.perYear >= 780],
  ];
  const md = [
    `# Labo AURUM : nuit ${state.nights}`,
    "",
    `Mis à jour le ${new Date(state.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC. Données : or du ${d(from)} au ${d(to)} (bougies de 15 min, écart réel et financement compris).`,
    "",
    `Cette nuit : ${tried} nouvelles règles essayées. Depuis le début : ${state.tried}. Qualifiées aujourd'hui : ${qualified.length}. Confirmées : ${confirmed.length}.`,
    "",
    "Méthode : classement sur 2021-2024 seulement ; qualifiée si 2025 → jour de découverte gagne aussi (facteur de profit ≥ 1,1, pire repli ≤ 25R) ; confirmée après au moins 30 jours et 3 trades gagnants sur des prix qui n'existaient pas quand elle a été trouvée, et un écart de prix 50 % plus large encore gagnant ; retirée si elle perd 3R sur ces 30 jours, ou 6R à tout moment.",
    "",
    "## Champion",
    "",
    champ ? `${champ.id} : ${describe(champ.spec)}.` : "Aucun pour l'instant : une règle doit d'abord tenir au moins 30 jours en direct.",
    "",
    "## Références (stratégies déjà connues du bot)",
    "",
    head,
    ...refsRows.map(row),
    "",
    ...bands.flatMap(([title, f]) => {
      const xs = qualified.filter(f).sort((a, b) => yearly(b) - yearly(a)).slice(0, 10);
      return [`## Qualifiées, ${title}`, "", xs.length ? head : "Aucune pour l'instant.", ...xs.map(row), ""];
    }),
    "## Meilleures sur 2021-2024 (pas encore validées)",
    "",
    head,
    ...state.entries.filter((e) => e.status === "candidate").slice(0, 10).map(row),
    "",
  ].join("\n");
  writeFileSync(opt("report", "lab.md"), md);
  console.log(md);
}

if (args.includes("--merge")) merge();
else worker();
