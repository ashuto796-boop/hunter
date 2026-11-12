// AURUM 24/7 server. One run = fetch the closed candles, retrain once a day, replay every candle
// since the previous run with exactly the same engine as the phone app, then write state.json.
//
//   npx tsx server/main.ts                         one run (GitHub Actions every 15 min)
//   npx tsx server/main.ts --loop [--port 8787]    always on (VPS, Raspberry Pi, old Android + Termux)
//
// Options: --state <file> (default state.json), --config <file> (default server/config.json).
// Push alerts (optional, environment variables): NTFY_TOPIC, TELEGRAM_TOKEN + TELEGRAM_CHAT_ID.
import { createHash } from "crypto";
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
import { nyTime, sessionAt, tradingDay } from "../src/gold/engine/context";
import { money } from "../src/gold/engine/narrate";
import { MediaState, mediaShocks, moodLabel, moodOf } from "../src/gold/engine/media";
import { updateMedia } from "./media";
import { STRATEGY } from "../src/gold/engine/strategy";
import { tfLabel } from "../src/gold/ui/format";
import { BrokerConfig, DEFAULT_BROKER, syncLive } from "./live";
import { Capital, CapitalError } from "./broker/capital";
import { seal, unseal } from "../src/gold/engine/seal";
import { LiveState } from "../src/gold/engine/live";
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
  pressMs: number; // how often Claude re-reads the press (when a key is set)
  broker: BrokerConfig;
}

function loadConfig(): Config {
  const raw = existsSync(CONFIG)
    ? (JSON.parse(readFileSync(CONFIG, "utf8")) as Partial<Settings> & { retrainHours?: number; pressHours?: number; broker?: Partial<BrokerConfig> })
    : {};
  const { retrainHours = 20, pressHours = 3, broker = {}, ...rest } = raw;
  const settings: Settings = { ...DEFAULT_SETTINGS, ...rest, server: false };
  const source = rest.source && rest.source !== "sim" ? rest.source : "auto";
  return { settings, source, retrainMs: retrainHours * 3_600_000, pressMs: pressHours * 3_600_000, broker: { ...DEFAULT_BROKER, ...broker } };
}

// Claude re-reads the press every few hours while gold trades, when new headlines came in
async function readPressIfDue(media: MediaState, now: number, pressMs: number, market: boolean): Promise<string[]> {
  const last = media.reading?.t ?? 0;
  if (!process.env.ANTHROPIC_API_KEY || !market || now - last < pressMs) return [];
  if (media.headlines.length < 5 || !media.headlines.some((h) => h.t > last)) return [];
  const { readPress } = await import("./analyst");
  const res = await readPress(media.headlines, log);
  if (!res) return [];
  const newlyMajor: string[] = [];
  for (const h of media.headlines) {
    const x = res.impacts.get(h.id);
    if (!x) continue;
    if (x.major && !h.major && now - h.t < 2 * HOUR) newlyMajor.push(h.title);
    h.score = x.impact;
    h.major = x.major;
    h.by = "claude";
  }
  media.reading = res.reading;
  const mood = moodOf(media.headlines, now);
  media.history[media.history.length - 1] = { t: now, score: Math.round(mood.score * 1000) / 1000, n: mood.n };
  return newlyMajor;
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
    presse: state.media && {
      humeur: moodLabel(moodOf(state.media.headlines, Date.now()).score),
      resumeClaude: state.media.reading?.summary ?? null,
      titres: state.media.headlines.filter((h) => h.t >= dayStart).slice(0, 10).map((h) => ({ titre: h.title, source: h.source, impact: r2(h.score) })),
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

// Copies the AI's trades onto the Capital.com account when the owner configured one (GitHub
// secrets CAPITAL_API_KEY, CAPITAL_IDENTIFIER, CAPITAL_PASSWORD, CAPITAL_ENV, AURUM_PASSPHRASE).
// Everything about the account is sealed before it is published, and nothing about it is written
// to the (public) run logs.
async function brokerStep(state: ServerState, cfg: BrokerConfig, realGold: boolean): Promise<[string, string][]> {
  const apiKey = process.env.CAPITAL_API_KEY;
  const identifier = process.env.CAPITAL_IDENTIFIER;
  const password = process.env.CAPITAL_PASSWORD;
  const pass = process.env.AURUM_PASSPHRASE ?? "";
  if (!apiKey || !identifier || !password) {
    state.live = { configured: false, sealed: null, note: null };
    return [];
  }
  if (pass.length < 8) {
    state.live = { configured: true, sealed: null, note: "Il manque le secret AURUM_PASSPHRASE (8 caractères au moins) : sans lui, aucun ordre réel n'est passé." };
    return [];
  }
  const live = process.env.CAPITAL_ENV === "live";
  const env = live ? "live" : "practice";
  const prev = await unseal<LiveState>(state.live?.sealed, pass);
  if (state.live?.sealed && !prev) log("compte réel : ancien état illisible (code secret changé ?), il repart de zéro");
  try {
    const res = await syncLive({
      api: new Capital(apiKey, identifier, password, live ? "live" : "demo", cfg.epic),
      env,
      cfg,
      prev,
      position: state.st.position,
      pending: state.st.pending,
      decidedAt: state.lastProcessedT,
      paperPrice: state.price,
      realGold,
      now: Date.now(),
    });
    state.live = { configured: true, sealed: await seal(res.state, pass), note: null };
    log(`compte réel : synchronisé (${res.state.status})`);
    return res.alerts;
  } catch (e) {
    // a broker outage never stops the AI; the last sealed state is kept as it was
    const status = e instanceof CapitalError ? e.status : 0;
    const note =
      status === 401 || status === 400
        ? `${(e as Error).message} (secrets CAPITAL_API_KEY, CAPITAL_IDENTIFIER, CAPITAL_PASSWORD ; CAPITAL_ENV = demo ou live selon la clé).`
        : status === 404
          ? "Capital.com ne trouve pas l'or (GOLD) sur ce compte : vérifie le type de compte (CFD)."
          : status === 429
            ? "Capital.com limite les requêtes : nouvel essai au prochain passage."
            : "Capital.com n'a pas répondu au dernier passage ; nouvel essai au prochain.";
    log(`compte réel : ${note}`);
    const again = state.live?.note === note;
    state.live = { configured: true, sealed: state.live?.sealed ?? null, note };
    return again ? [] : [["AURUM — compte Capital.com", note]];
  }
}

export async function runOnce(): Promise<ServerState> {
  const { settings, source: pref, retrainMs, pressMs, broker } = loadConfig();
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
    think("warn", `Nouvelle stratégie AURUM : bougies de ${tfLabel(tf)} au lieu de ${tfLabel(prev.settings.tf)}. Le compte démo repart à neuf.`);
  }

  const days = settings.trainDays + 10;
  log(`chargement ${days} j de ${src.symbol} M${tf}…`);
  const [all, peers, news, press] = await Promise.all([
    fetchHistory(src, tf, days),
    fetchPeers(days),
    fetchNews(),
    updateMedia(state.media, Date.now(), log).catch((e) => {
      log("presse indisponible :", (e as Error).message);
      return null;
    }),
  ]);
  const now = Date.now();
  if (press) {
    const { fresh: _fresh, ...media } = press;
    // a run every 15 min for 10 days stays far below this; the cap only bounds the file size
    media.history = media.history.slice(-1000);
    state.media = media;
  }
  const media = state.media;
  const newlyMajor = media ? await readPressIfDue(media, now, pressMs, sessionAt(now) !== "FERME") : [];
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

  const threshold = STRATEGY.fixedThreshold ?? (settings.mode === "auto" ? state.autoThreshold : THRESHOLDS[settings.mode]);
  // a breaking story pauses new entries like a scheduled announcement does
  const env = { m, settings, news: [...news, ...(media ? mediaShocks(media.headlines, now) : [])], threshold, media: media?.history };
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
  alerts.push(...(await brokerStep(state, broker, src.id === "xau" || src.id === "bitget")));
  state.runs++;
  state.host = HOST;
  state.updatedAt = Date.now();
  // a newly configured push channel gets a hello, so the owner knows it works right away
  const channels = [process.env.NTFY_TOPIC, process.env.TELEGRAM_CHAT_ID].filter(Boolean).join("|");
  const pushTag = channels ? createHash("sha256").update(channels).digest("hex").slice(0, 12) : undefined;
  if (pushTag && state.pushTag !== pushTag) {
    alerts.push(["AURUM — notifications activées ✅", "Tu recevras ici chaque entrée, chaque sortie et le bilan du soir, même app fermée."]);
  }
  state.pushTag = pushTag;
  for (const title of newlyMajor) alerts.push(["AURUM — actualité majeure sur l'or", title]);
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
