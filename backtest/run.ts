// AURUM 5-year backtest on real gold prices (Dukascopy, see dukascopy.py), with the exact engine
// the app and the 24/7 server use. Three things are measured:
//
//  1. "Comme en vrai": walk-forward exactly like the server. Every N days the AI retrains on the
//     previous 60 days (same calibration, same memory), then trades the next N days it has never
//     seen. Spread = the median spread measured on the real bid/ask prices.
//  2. The same with a pessimistic spread (90th percentile of the measured spreads).
//  3. Fixed thresholds without retraining, to see how sensitive the result is to that one setting.
//
//   npx tsx backtest/run.ts --data backtest/data --out backtest/out [--retrain 5]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { buildMarket, Peers } from "../src/gold/engine/features";
import { newTraderState, simulate, warmupIndex } from "../src/gold/engine/trader";
import { train } from "../src/gold/engine/training";
import { computeStats } from "../src/gold/engine/stats";
import { sessionAt } from "../src/gold/engine/context";
import { DEFAULT_SETTINGS } from "../src/gold/engine/defaults";
import { Candle, Settings, Trade, TraderState } from "../src/gold/engine/types";

const DAY = 864e5;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const DATA = opt("data", "backtest/data");
const OUT = opt("out", "backtest/out");
const RETRAIN = Number(opt("retrain", "5")); // days between retrainings
const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);

type Bar = Candle & { s?: number };
const load = (f: string): Bar[] => JSON.parse(readFileSync(`${DATA}/${f}.json`, "utf8"));
const gold = load("xau_m15");
const peers: Peers = { xag: load("xag_h1"), eur: load("eur_h1") };

const server = JSON.parse(readFileSync(new URL("../server/config.json", import.meta.url), "utf8"));
const { broker: _b, retrainHours: _r, pressHours: _p, ...cfg } = server;
const base: Settings = { ...DEFAULT_SETTINGS, ...cfg, server: false };

// --- measured trading costs -------------------------------------------------------------------
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const spreads = gold.map((b) => b.s ?? NaN).filter((x) => Number.isFinite(x) && x > 0);
const spreadMed = q(spreads, 0.5);
const spreadP90 = q(spreads, 0.9);
const bySession: Record<string, number[]> = {};
for (const b of gold) if (b.s) (bySession[sessionAt(b.t)] ??= []).push(b.s);
const sessionSpread = Object.fromEntries(Object.entries(bySession).map(([k, v]) => [k, { median: q(v, 0.5), p90: q(v, 0.9), n: v.length }]));
log(`${gold.length} bougies M15 du ${new Date(gold[0].t).toISOString().slice(0, 10)} au ${new Date(gold[gold.length - 1].t).toISOString().slice(0, 10)}`);
log(`spread mesuré : médiane ${spreadMed.toFixed(3)} $, 90e centile ${spreadP90.toFixed(3)} $`);

const candles: Candle[] = gold.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }));
const full = buildMarket(candles, 15, peers);
const idxAt = (t: number) => {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
const slicePeers = (a: number, b: number): Peers => ({
  xag: peers.xag?.filter((k) => k.t >= a - 30 * DAY && k.t < b),
  eur: peers.eur?.filter((k) => k.t >= a - 30 * DAY && k.t < b),
});

// --- 1 & 2: walk-forward like the server ------------------------------------------------------
async function walkForward(spread: number, label: string) {
  const settings = { ...base, spread };
  const st = newTraderState(settings.capital);
  const t0 = candles[0].t + (settings.trainDays + 12) * DAY;
  const tEnd = candles[candles.length - 1].t;
  const thresholds: { t: number; th: number }[] = [];
  let T = t0;
  let k = 0;
  const started = Date.now();
  while (T < tEnd) {
    const next = Math.min(tEnd + 1, T + RETRAIN * DAY);
    const w0 = idxAt(T - (settings.trainDays + 10) * DAY);
    const w1 = idxAt(T);
    const window = candles.slice(w0, w1);
    if (window.length > 1000) {
      const mw = buildMarket(window, 15, slicePeers(window[0].t, T));
      const tr = await train({ m: mw, settings, news: [] }, "dukascopy");
      st.brain = tr.st.brain;
      st.ctx = tr.st.ctx;
      st.mem = tr.st.mem;
      thresholds.push({ t: T, th: tr.threshold });
      const from = Math.max(w1, warmupIndex(full));
      const to = idxAt(next) - 1;
      if (to >= from) simulate({ m: full, settings, news: [], threshold: tr.threshold }, st, from, to, { replay: false });
    }
    T = next;
    if (++k % 26 === 0) log(`${label} : ${new Date(T).toISOString().slice(0, 10)}, ${st.trades.length} trades, solde ${st.balance.toFixed(0)} $ (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
  return { st, thresholds, settings };
}

// --- 3: fixed threshold, no retraining (the brain keeps learning as it goes) --------------------
function fixed(th: number, spread: number) {
  const settings = { ...base, spread };
  const st = newTraderState(settings.capital);
  simulate({ m: full, settings, news: [], threshold: th }, st, warmupIndex(full), candles.length - 1, { replay: false });
  return { st, settings };
}

// --- report -----------------------------------------------------------------------------------
const yearOf = (t: number) => new Date(t).getUTCFullYear();
const monthOf = (t: number) => new Date(t).toISOString().slice(0, 7);

function group<T extends string>(trades: Trade[], key: (t: Trade) => T | undefined) {
  const g: Record<string, Trade[]> = {};
  for (const t of trades) (g[key(t) ?? "?"] ??= []).push(t);
  return Object.fromEntries(
    Object.entries(g).map(([k, v]) => {
      const wins = v.filter((t) => t.pnl > 0);
      const gp = wins.reduce((a, t) => a + t.pnl, 0);
      const gl = -v.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
      return [k, { n: v.length, winRate: wins.length / v.length, sumR: v.reduce((a, t) => a + t.r, 0), pnl: gp - gl, pf: gl ? gp / gl : Infinity }];
    })
  );
}

function summarize(st: TraderState, capital: number) {
  const trades = [...st.trades].sort((a, b) => a.closeTime - b.closeTime);
  const stats = computeStats(trades, capital);
  // equity by month and return by calendar year
  const monthly: { m: string; eq: number }[] = [];
  const years: Record<string, { start: number; end: number; n: number; sumR: number; maxDD: number }> = {};
  let eq = capital;
  let peak = capital;
  for (const t of trades) {
    const y = String(yearOf(t.closeTime));
    const yr = (years[y] ??= { start: eq, end: eq, n: 0, sumR: 0, maxDD: 0 });
    eq += t.pnl;
    peak = Math.max(peak, eq);
    yr.end = eq;
    yr.n++;
    yr.sumR += t.r;
    yr.maxDD = Math.max(yr.maxDD, 1 - eq / peak);
    const m = monthOf(t.closeTime);
    if (monthly.length && monthly[monthly.length - 1].m === m) monthly[monthly.length - 1].eq = eq;
    else monthly.push({ m, eq });
  }
  const months = monthly.length;
  const posMonths = monthly.filter((x, i) => x.eq >= (i ? monthly[i - 1].eq : capital)).length;
  return {
    final: eq,
    stats,
    perYear: Object.fromEntries(Object.entries(years).map(([y, v]) => [y, { ...v, ret: v.end / v.start - 1 }])),
    monthly,
    positiveMonths: months ? posMonths / months : 0,
    bySession: group(trades, (t) => t.session),
    bySpecialist: group(trades, (t) => t.primary),
    byRegime: group(trades, (t) => t.regime),
    byExit: group(trades, (t) => t.reason),
  };
}

const pct = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)} %`;
const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "∞");

function table(title: string, rows: Record<string, { n: number; winRate: number; sumR: number; pf: number }>) {
  const lines = Object.entries(rows)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([k, v]) => `| ${k} | ${v.n} | ${(v.winRate * 100).toFixed(0)} % | ${v.sumR >= 0 ? "+" : ""}${v.sumR.toFixed(1)}R | ${num(v.pf)} |`);
  return [`#### ${title}`, "", "| | Trades | Réussite | Total | Gains/pertes |", "|---|---:|---:|---:|---:|", ...lines, ""].join("\n");
}

function missingNote(): string {
  if (!existsSync(`${DATA}/missing.json`)) return "";
  const m = JSON.parse(readFileSync(`${DATA}/missing.json`, "utf8")) as { missing: number; requested: number };
  return m.missing ? `Données : ${m.missing} fichiers journaliers sur ${m.requested} n'ont pas pu être téléchargés (${((m.missing / m.requested) * 100).toFixed(1)} %), ce qui laisse quelques jours vides.\n` : "";
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const wf = await walkForward(spreadMed, "comme en vrai");
  const wfStress = await walkForward(spreadP90, "spread élevé");
  const fixedRuns = [57, 61, 65].map((th) => ({ th, ...fixed(th, spreadMed) }));
  log(`calculs terminés en ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  const capital = base.capital;
  const main = summarize(wf.st, capital);
  const stress = summarize(wfStress.st, capital);
  const fixedSum = fixedRuns.map((r) => ({ th: r.th, ...summarize(r.st, capital) }));
  const first = candles[0];
  const last = candles[candles.length - 1];
  const tradeStart = wf.thresholds[0]?.t ?? first.t;
  const holdFrom = candles[idxAt(tradeStart)].o;
  const report = {
    generatedAt: new Date().toISOString(),
    data: { source: "Dukascopy XAU/USD (bid + ask, M1 → M15)", from: first.t, to: last.t, candles: candles.length, tradeFrom: tradeStart },
    costs: { spreadMedian: spreadMed, spreadP90, bySession: sessionSpread },
    settings: { ...base, spread: spreadMed },
    retrainDays: RETRAIN,
    thresholds: wf.thresholds,
    goldBuyHold: last.c / holdFrom - 1,
    walkForward: main,
    walkForwardHighSpread: stress,
    fixedThresholds: fixedSum.map(({ th, final, stats, perYear }) => ({ th, final, stats, perYear })),
  };
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  writeFileSync(
    `${OUT}/trades.csv`,
    ["ouverture,fermeture,sens,entrée,sortie,R,pnl,raison,spécialiste,régime,session"]
      .concat(
        [...wf.st.trades]
          .sort((a, b) => a.openTime - b.openTime)
          .map((t) => [new Date(t.openTime).toISOString(), new Date(t.closeTime).toISOString(), t.dir === 1 ? "achat" : "vente", t.entry.toFixed(2), t.exit.toFixed(2), t.r.toFixed(2), t.pnl.toFixed(2), t.reason, t.primary, t.regime ?? "", t.session ?? ""].join(","))
      )
      .join("\n")
  );

  const s = main.stats;
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const ths = wf.thresholds.map((x) => x.th);
  const md = [
    "# AURUM — test sur données réelles de l'or",
    "",
    `Données : ${report.data.source}, du ${day(first.t)} au ${day(last.t)} (${candles.length.toLocaleString("fr-FR")} bougies de 15 min). L'IA trade à partir du ${day(tradeStart)}, après ses 60 premiers jours d'apprentissage.`,
    `Réglages du serveur : capital ${capital} $, risque ${base.riskPct} % par trade, ${base.maxTradesDay} trades max par jour, perte max ${base.maxDailyLossPct} % par jour, réentraînement tous les ${RETRAIN} jours sur ${base.trainDays} jours.`,
    `Coûts mesurés sur les vrais prix d'achat et de vente : écart médian ${spreadMed.toFixed(2)} $ par once, 90e centile ${spreadP90.toFixed(2)} $.`,
    "",
    "## Comme en vrai (réentraînement régulier, écart médian)",
    "",
    `| Résultat | Trades | Réussite | Gains/pertes | Pire repli | Moyenne | Mois positifs |`,
    `|---:|---:|---:|---:|---:|---:|---:|`,
    `| ${pct(main.final / capital - 1)} (${main.final.toFixed(0)} $) | ${s.n} | ${(s.winRate * 100).toFixed(0)} % | ${num(s.pf)} | ${(s.maxDD * 100).toFixed(1)} % | ${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R | ${(main.positiveMonths * 100).toFixed(0)} % |`,
    "",
    `Pour comparaison, l'or lui-même a fait ${pct(report.goldBuyHold)} sur la même période (acheter et garder, sans effet de levier).`,
    `Seuil choisi par l'IA à chaque réentraînement : de ${Math.min(...ths)} à ${Math.max(...ths)}, médiane ${q(ths, 0.5)}.`,
    "",
    "### Année par année",
    "",
    "| Année | Résultat | Trades | Total | Pire repli |",
    "|---|---:|---:|---:|---:|",
    ...Object.entries(main.perYear).map(([y, v]) => `| ${y} | ${pct(v.ret)} | ${v.n} | ${v.sumR >= 0 ? "+" : ""}${v.sumR.toFixed(1)}R | ${(v.maxDD * 100).toFixed(1)} % |`),
    "",
    "### Écart de prix élevé (90e centile)",
    "",
    `${pct(stress.final / capital - 1)}, ${stress.stats.n} trades, gains/pertes ${num(stress.stats.pf)}, pire repli ${(stress.stats.maxDD * 100).toFixed(1)} %.`,
    "",
    "### Seuil fixe, sans réentraînement",
    "",
    "| Seuil | Résultat | Trades | Gains/pertes | Pire repli |",
    "|---:|---:|---:|---:|---:|",
    ...fixedSum.map((r) => `| ${r.th} | ${pct(r.final / capital - 1)} | ${r.stats.n} | ${num(r.stats.pf)} | ${(r.stats.maxDD * 100).toFixed(1)} % |`),
    "",
    "### Détail (comme en vrai)",
    "",
    table("Par spécialiste", main.bySpecialist),
    table("Par état du marché", main.byRegime),
    table("Par session", main.bySession),
    table("Par type de sortie", main.byExit),
    "### Écart de prix mesuré par session",
    "",
    "| Session | Médiane | 90e centile |",
    "|---|---:|---:|",
    ...Object.entries(sessionSpread).map(([k, v]) => `| ${k} | ${v.median.toFixed(3)} $ | ${v.p90.toFixed(3)} $ |`),
    "",
    missingNote(),
    "Limites : pas de calendrier historique des annonces (Fed, emploi), donc le filtre d'annonces ne joue pas ici ; pas d'humeur de la presse dans le passé ; frais de financement de nuit non comptés (positions de 8 h maximum).",
    "",
  ].join("\n");
  writeFileSync(`${OUT}/report.md`, md);
  log(`rapport : ${OUT}/report.md`);
  console.log(md);
}

if (!existsSync(`${DATA}/xau_m15.json`)) {
  console.error(`pas de données dans ${DATA} : lancer d'abord backtest/dukascopy.py`);
  process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

