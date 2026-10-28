// AURUM 24/7 server. One run = fetch the closed candles, retrain once a day, replay every candle
// since the previous run with exactly the same engine as the phone app, then write state.json.
//
//   npx tsx server/main.ts                         one run (GitHub Actions every 15 min)
//   npx tsx server/main.ts --loop [--port 8787]    always on (VPS, Raspberry Pi, old Android + Termux)
//
// Options: --state <file> (default state.json), --config <file> (default server/config.json).
// Push alerts (optional, environment variables): NTFY_TOPIC, TELEGRAM_TOKEN + TELEGRAM_CHAT_ID.
import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { createServer } from "http";
import { fileURLToPath, pathToFileURL } from "url";
import { buildMarket } from "../src/gold/engine/features";
import { REGIME_LABEL, THRESHOLDS, analyse } from "../src/gold/engine/brain";
import { closePosition, newTraderState, simulate, warmupIndex } from "../src/gold/engine/trader";
import { Market } from "../src/gold/engine/features";
import { MODULE_IDS, MODULE_INFO } from "../src/gold/engine/modules";
import { train } from "../src/gold/engine/training";
import { Thought, closeAlert, closeText, lossText, openAlert, openText, scanText, trainingTexts } from "../src/gold/engine/narrate";
import { DEFAULT_SETTINGS } from "../src/gold/engine/defaults";
import { SERVER_STATE_VERSION, ServerState, isServerState } from "../src/gold/engine/serverState";
import { Decision, NewsEvent, Settings } from "../src/gold/engine/types";
import { Memory, emptyMemory } from "../src/gold/engine/memory";
import { nyTime, tradingDay } from "../src/gold/engine/context";
import { money } from "../src/gold/engine/narrate";
import { SOURCES, Source, SourceId, fetchHistory, fetchNews, fetchPeers, probe } from "../src/gold/data/feed";

const DAY = 864e5;
const MAX_THOUGHTS = 150;

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const STATE = opt("state", "state.json");
// next to state.json: the full memory (too big for the phone) and a tiny stamp the phone polls
const sibling = (name: string) => STATE.replace(/[^/\\]*$/, name);
const MEMORY = sibling("memory.json");
const STAMP = sibling("stamp.json");
const CONFIG = opt("config", fileURLToPath(new URL("./config.json", import.meta.url)));
const HOST = process.env.GITHUB_ACTIONS ? "github-actions" : opt("host", "serveur");

const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);

interface Config {
  settings: Settings;
  source: SourceId | "auto";
  retrainMs: number;
}

function loadConfig(): Config {
  const raw = existsSync(CONFIG) ? (JSON.parse(readFileSync(CONFIG, "utf8")) as Partial<Settings> & { retrainHours?: number }) : {};
  const { retrainHours = 20, ...rest } = raw;
  const settings: Settings = { ...DEFAULT_SETTINGS, ...rest, server: false };
  const source = rest.source && rest.source !== "sim" ? rest.source : "auto";
  return { settings, source, retrainMs: retrainHours * 3_600_000 };
}

// Entries, exits and lessons outlive routine analyses when the journal is trimmed
function trimThoughts(list: Thought[]): Thought[] {
  const out = list.sort((a, b) => a.t - b.t);
  for (let k = 0; out.length > MAX_THOUGHTS && k < out.length; ) {
    if (out[k].kind === "scan") out.splice(k, 1);
    else k++;
  }
  return out.slice(-MAX_THOUGHTS);
}

function loadState(): ServerState | null {
  if (!existsSync(STATE)) return null;
  try {
    const s = JSON.parse(readFileSync(STATE, "utf8"));
    if (!isServerState(s)) return null;
    let mem: Memory = emptyMemory();
    try {
      if (existsSync(MEMORY)) mem = JSON.parse(readFileSync(MEMORY, "utf8")) as Memory;
    } catch {
      log("memory.json illisible : mémoire repartie de zéro, le compte est conservé");
    }
    s.st.mem = { ...emptyMemory(), ...mem, stats: s.st.mem?.stats ?? mem.stats };
    return s;
  } catch {
    return null;
  }
}

const writeAtomic = (file: string, data: string) => {
  writeFileSync(`${file}.tmp`, data);
  renameSync(`${file}.tmp`, file); // the HTTP endpoint never serves half a file
};

// state.json only carries the memory's small statistics; the shadow trades go to memory.json
function saveState(s: ServerState) {
  const mem = s.st.mem ?? emptyMemory();
  writeAtomic(MEMORY, JSON.stringify(mem));
  writeAtomic(STATE, JSON.stringify({ ...s, st: { ...s.st, mem: { stats: mem.stats, total: mem.total, pending: [], done: {} } } }));
  writeAtomic(STAMP, JSON.stringify({ updatedAt: s.updatedAt, runs: s.runs }));
}

// After the New York close, one push with the day's result
function dailyRecap(s: ServerState): [string, string] | null {
  const ny = nyTime(Date.now());
  if (ny.wd < 1 || ny.wd > 5 || ny.mins < 17 * 60) return null;
  const day = ny.ymd; // a session is named after the New York date it closes on
  if (s.lastRecap === day) return null;
  s.lastRecap = day;
  const today = s.st.trades.filter((t) => tradingDay(t.closeTime) === day);
  const r = today.reduce((a, t) => a + t.r, 0);
  const pnl = today.reduce((a, t) => a + t.pnl, 0);
  const body = today.length
    ? `${today.length} trade(s), ${r >= 0 ? "+" : ""}${r.toFixed(2)}R (${money(pnl)}). Solde ${s.st.balance.toFixed(2)} $.`
    : `Aucun trade aujourd'hui : pas de setup assez propre. Solde ${s.st.balance.toFixed(2)} $.`;
  return ["AURUM — bilan du jour", body];
}

// Push alert to the phone even when the app is closed
async function push(title: string, body: string) {
  const jobs: Promise<unknown>[] = [];
  const topic = process.env.NTFY_TOPIC;
  if (topic) {
    jobs.push(
      fetch("https://ntfy.sh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, title, message: body, tags: ["moneybag"] }),
      })
    );
  }
  const token = process.env.TELEGRAM_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (token && chat) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: `${title}\n${body}` }),
      })
    );
  }
  const res = await Promise.allSettled(jobs);
  for (const r of res) if (r.status === "rejected") log("alerte non envoyée :", r.reason);
}

// Real gold first (Binance perpetual, then Bitget's, which answers from US servers), PAXG last
const PREFERENCE: SourceId[] = ["xau", "bitget", "paxg"];
const HOUR = 3_600_000;

// The account is denominated in one instrument. It moves to a better source only while flat, and
// leaves an unreachable one only after two hours without a successful run.
async function pickSource(pref: SourceId | "auto", tf: number, prev: ServerState | null): Promise<Source> {
  const order = pref === "auto" ? PREFERENCE : [pref];
  const reachable = async (id: SourceId) => {
    const ok = await probe(SOURCES[id], tf);
    if (!ok) log(`source ${id} injoignable depuis ce serveur`);
    return ok;
  };
  const cur = prev?.source as SourceId | undefined;
  if (cur && SOURCES[cur]) {
    const flat = !prev!.st.position && !prev!.st.pending;
    if (flat) {
      for (const id of order) {
        if (id === cur) break;
        if (await reachable(id)) return SOURCES[id];
      }
    }
    if (await reachable(cur)) return SOURCES[cur];
    if (Date.now() - prev!.updatedAt < 2 * HOUR) throw new Error(`source ${cur} injoignable, nouvel essai au prochain passage`);
  }
  for (const id of order) if (id !== cur && (await reachable(id))) return SOURCES[id];
  throw new Error("aucune source de prix joignable");
}

// Same account, new instrument: close anything open at the last known price and relearn
function switchInstrument(state: ServerState, src: Source, think: (k: Thought["kind"], t: string) => void) {
  const from = SOURCES[state.source as SourceId]?.label ?? state.source;
  const p = state.st.position;
  if (p) {
    const tr = closePosition(state.st, state.price - (p.dir * state.settings.spread) / 2, Date.now(), "MANUEL");
    think("exit", `Position clôturée pour changer d'instrument. ${closeText(tr)}`);
  }
  state.st.pending = null;
  if (state.st.mem) state.st.mem.pending = []; // open lessons were priced on the old instrument
  state.trainedAt = 0;
  state.source = src.id;
  think("warn", `Flux changé : ${from} → ${src.label}. Même compte, nouvel instrument : je me ré-entraîne dessus.`);
}

// What Claude gets to write the evening log: facts only, no instructions
function sessionFacts(state: ServerState, m: Market, news: NewsEvent[], src: Source) {
  const s = m.ltf;
  const last = s.c.length - 1;
  let i0 = last;
  while (i0 > 0 && s.day[i0 - 1] === s.day[last]) i0--;
  const bars = s.c.slice(i0);
  const open = bars[0].o;
  const close = s.close[last];
  const dayStart = bars[0].t;
  const d = state.decision;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    instrument: src.label,
    seance: {
      ouverture: r2(open),
      cloture: r2(close),
      plusHaut: r2(Math.max(...bars.map((k) => k.h))),
      plusBas: r2(Math.min(...bars.map((k) => k.l))),
      variationPct: r2(((close - open) / open) * 100),
    },
    contexte: d && {
      regime: REGIME_LABEL[d.regime],
      biaisH1H4Pct: Math.round(d.bias * 100),
      intermarche: d.intermarket && { argent: d.intermarket.silver, dollarFaible: d.intermarket.usd, score: d.intermarket.score },
      verdict: d.verdict,
      score: d.score,
      seuil: d.threshold,
    },
    compte: {
      solde: r2(state.st.balance),
      capitalDepart: state.settings.capital,
      tradesSeance: state.st.trades
        .filter((t) => t.closeTime >= dayStart)
        .map((t) => ({ sens: t.dir === 1 ? "achat" : "vente", entree: r2(t.entry), sortie: r2(t.exit), resultatR: r2(t.r), sortiePar: t.reason, module: MODULE_INFO[t.primary].name, pourquoi: t.reasons.slice(0, 3) })),
      positionOuverte: state.st.position && { sens: state.st.position.dir === 1 ? "achat" : "vente", entree: r2(state.st.position.entry), stop: r2(state.st.position.sl), objectif: r2(state.st.position.tp2) },
    },
    journal: state.thoughts.filter((t) => t.t >= dayStart && t.kind !== "scan").map((t) => t.text),
    dernieresAnalyses: state.thoughts.filter((t) => t.t >= dayStart && t.kind === "scan").slice(-6).map((t) => t.text),
    memoire: MODULE_IDS.flatMap((id) => {
      const x = state.st.mem?.stats[id];
      return x && x.n >= 1 ? [{ strategie: MODULE_INFO[id].name, lecons: Math.round(x.n), reussitePct: Math.round((x.wins / x.n) * 100), moyenneR: r2(x.sumR / x.n) }] : [];
    }),
    entrainement: state.training && {
      trades: state.training.stats.n,
      reussitePct: Math.round(state.training.stats.winRate * 100),
      facteurProfit: Number.isFinite(state.training.stats.pf) ? r2(state.training.stats.pf) : null,
      seuil: state.autoThreshold,
    },
    annonces24h: news.filter((e) => e.t > Date.now() && e.t < Date.now() + 24 * HOUR).map((e) => ({ titre: e.title, heureUTC: new Date(e.t).toISOString().slice(11, 16) })),
  };
}

// After the New York close, once per session
function noteDue(state: ServerState): string | null {
  const ny = nyTime(Date.now());
  if (ny.wd < 1 || ny.wd > 5 || ny.mins < 17 * 60 || state.note?.day === ny.ymd) return null;
  return ny.ymd;
}

function freshState(settings: Settings, source: string): ServerState {
  return {
    version: SERVER_STATE_VERSION,
    host: HOST,
    startedAt: Date.now(),
    updatedAt: 0,
    runs: 0,
    source,
    settings,
    st: newTraderState(settings.capital),
    lastProcessedT: 0,
    autoThreshold: THRESHOLDS.auto,
    trainedAt: 0,
    training: null,
    decision: null,
    thoughts: [],
    price: 0,
  };
}

export async function runOnce(): Promise<ServerState> {
  const { settings, source: pref, retrainMs } = loadConfig();
  const prev = loadState();
  const tf = settings.tf;
  const tfMs = tf * 60000;
  const src = await pickSource(pref, tf, prev);
  const thoughts: Thought[] = prev?.thoughts ?? [];
  const think = (kind: Thought["kind"], text: string, t = Date.now()) => thoughts.push({ t, kind, text });
  // routine analyses are only worth a line when the verdict changes
  const scan = (d: Decision) => {
    const prevScan = [...thoughts].reverse().find((x) => x.kind === "scan");
    if (!prevScan?.text.endsWith(d.verdict) && !thoughts.some((x) => x.kind === "scan" && x.t === d.t)) think("scan", scanText(d), d.t);
  };

  let state = prev ?? freshState(settings, src.id);
  if (!prev) think("info", `Serveur 24/7 démarré sur ${HOST}. Flux : ${src.label}.`);
  if (prev && prev.source !== src.id) switchInstrument(state, src, think);
  if (prev && prev.settings.tf !== tf) {
    state = freshState(settings, src.id);
    think("warn", `Unité de temps changée (M${prev.settings.tf} → M${tf}) : nouveau compte démo.`);
  }

  const days = settings.trainDays + 10;
  log(`chargement ${days} j de ${src.symbol} M${tf}…`);
  const [all, peers, news] = await Promise.all([fetchHistory(src, tf, days), fetchPeers(days), fetchNews()]);
  const now = Date.now();
  const closed = all.filter((k) => k.t + tfMs <= now);
  if (closed.length < 400) throw new Error(`historique insuffisant (${closed.length} bougies)`);
  const m = buildMarket(closed, tf, peers);
  const last = closed.length - 1;
  log(`${closed.length} bougies, argent ${peers.xag?.length ?? 0} h, dollar ${peers.eur?.length ?? 0} h, ${news.length} annonces`);

  const needTrain =
    !state.trainedAt ||
    !state.st.mem?.total || // no lessons yet (first run of a version with memory): learn them from history now
    now - state.trainedAt > retrainMs ||
    state.settings.mode !== settings.mode ||
    state.settings.trainDays !== settings.trainDays;
  if (needTrain) {
    const t0 = Date.now();
    const tr = await train({ m, settings, news }, src.id);
    state.st.brain = tr.st.brain;
    state.st.ctx = tr.st.ctx;
    state.st.mem = tr.st.mem;
    state.autoThreshold = tr.threshold;
    state.trainedAt = now;
    state.training = { ...tr.result, trades: tr.result.trades.slice(0, 80) };
    for (const text of trainingTexts(tr.result)) think("learn", text);
    log(`entraînement : ${tr.result.stats.n} trades, seuil ${tr.threshold}, ${Date.now() - t0} ms`);
  }
  state.settings = settings;

  const threshold = settings.mode === "auto" ? state.autoThreshold : THRESHOLDS[settings.mode];
  const env = { m, settings, news, threshold };
  const alerts: [string, string][] = [];
  if (!state.lastProcessedT) {
    state.lastProcessedT = closed[last].t + tfMs; // first run: trade from now on, no retroactive trades
  } else {
    let from = closed.findIndex((k) => k.t + tfMs > state.lastProcessedT);
    if (from >= 0) {
      from = Math.max(from, warmupIndex(m), last - Math.round((7 * DAY) / tfMs));
      let lastNotable: Decision | null = null;
      simulate(env, state.st, from, last, {
        replay: false,
        onDecision: (d) => {
          if (d.plan || d.score >= d.threshold - 12) lastNotable = d;
        },
        onEvent: (e) => {
          if (e.kind === "open" && e.position) {
            think("entry", openText(e.position), e.t);
            alerts.push(openAlert(e.position));
          }
          if (e.kind === "close" && e.trade) {
            think("exit", closeText(e.trade), e.t);
            const l = lossText(e.trade);
            if (l) think("learn", l, e.t);
            alerts.push(closeAlert(e.trade));
          }
        },
      });
      const notable = lastNotable as Decision | null;
      if (notable && notable.t !== closed[last].t + tfMs) scan(notable);
      log(`${last - from + 1} bougies traitées`);
      state.lastProcessedT = closed[last].t + tfMs;
    }
  }

  // what the brain thinks right now (an entry decided on the last candle waits in st.pending
  // and fills at the next candle's open on the next run, as it would in real time)
  state.decision = analyse(env, state.st, last);
  scan(state.decision);
  state.thoughts = trimThoughts(thoughts);
  state.st.trades = state.st.trades.slice(-500);
  state.price = closed[last].c;
  state.runs++;
  state.host = HOST;
  state.updatedAt = Date.now();
  const recap = state.runs > 1 ? dailyRecap(state) : null;
  if (recap) alerts.push(recap);
  const noteDay = process.env.ANTHROPIC_API_KEY ? noteDue(state) : null;
  if (noteDay) {
    const { writeNote } = await import("./analyst"); // the SDK is only installed when the key is set
    const note = await writeNote(noteDay, sessionFacts(state, m, news, src), log);
    if (note) {
      state.note = note;
      alerts.push(["AURUM — carnet du soir", note.text.slice(0, 3500)]);
    }
  }
  saveState(state);
  log(`solde ${state.st.balance.toFixed(2)} $, position ${state.st.position ? "ouverte" : "aucune"}, ${state.st.trades.length} trades`);

  for (const [title, body] of alerts) await push(title, body);
  return state;
}

async function loop(port: number | null) {
  const { settings } = loadConfig();
  const tfMs = settings.tf * 60000;
  let busy = false;
  let lastBucket = 0;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await runOnce();
    } catch (e) {
      log("échec :", (e as Error).message);
    } finally {
      busy = false;
    }
  };
  await run();
  // run 20 s after every candle close
  setInterval(() => {
    const bucket = Math.floor(Date.now() / tfMs) * tfMs;
    if (bucket !== lastBucket && Date.now() - bucket >= 20000) {
      lastBucket = bucket;
      run();
    }
  }, 5000);
  if (port) {
    createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      if (req.url?.startsWith("/state.json") && existsSync(STATE)) {
        res.setHeader("Content-Type", "application/json");
        res.end(readFileSync(STATE));
      } else {
        res.statusCode = 404;
        res.end("AURUM : GET /state.json");
      }
    }).listen(port, () => log(`état servi sur http://0.0.0.0:${port}/state.json`));
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isMain) {
  // imported (tests): the caller drives runOnce()
} else if (args.includes("--loop")) {
  const p = opt("port", "");
  loop(p ? Number(p) : null);
} else {
  runOnce().catch((e) => {
    console.error("AURUM serveur — échec :", (e as Error).message);
    process.exit(1);
  });
}
