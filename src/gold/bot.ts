// The autonomous trader. Two ways to run:
// - server mode (default when the 24/7 server publishes): the phone mirrors the server's account,
//   decisions and journal, and only streams prices for the chart and the live P&L;
// - local mode: the phone loads history, trains the brain walk-forward, replays what happened while
//   it was asleep, then trades the live stream itself on a paper account with real prices.
import { Candle, Decision, Position, Settings, Trade, TraderState } from "./engine/types";
import { Market, Peers, buildMarket } from "./engine/features";
import { AnalyseEnv, THRESHOLDS, analyse } from "./engine/brain";
import { closePosition, endOfBar, manageBar, newTraderState, openPosition, rememberDecision, rollDay, simulate, warmupIndex } from "./engine/trader";
import { emptyMemory, resolveShadows } from "./engine/memory";
import { train } from "./engine/training";
import { Thought, closeAlert, closeText, lossText, openAlert, openText, scanText, sideFr, trainingTexts } from "./engine/narrate";
import { GoldSimulator } from "./engine/sim";
import { ServerState } from "./engine/serverState";
import { BinanceFeed, Feed, SOURCES, Source, SourceId, SimFeed, fetchHistory, fetchKlines, fetchNews, fetchPeers, probe, refreshPeers } from "./data/feed";
import { fetchServerStamp, fetchServerState } from "./data/remote";
import { DEFAULT_SETTINGS, GoldState, useGold } from "./store";
import { beep, keepAwake, notify, vibrate } from "./device";

const KEY = "aurum.v1";
const DAY = 864e5;
const MAX_THOUGHTS = 120;
const REMOTE_POLL_MS = 60_000;
const REMOTE_MAX_AGE = 6 * 3_600_000; // older than this, the phone trades by itself again

interface Saved {
  settings: Settings;
  st: TraderState;
  thoughts: Thought[];
  lastProcessedT: number;
  autopilot: boolean;
  source: SourceId | null;
  autoThreshold: number;
}

function load(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Saved>;
  } catch {
    return {};
  }
}

const ago = (t: number) => {
  const min = Math.round((Date.now() - t) / 60000);
  return min < 90 ? `${min} min` : `${Math.round(min / 60)} h`;
};

class Bot {
  settings: Settings;
  st: TraderState;
  thoughts: Thought[];
  lastProcessedT: number;
  autopilot: boolean;
  savedSource: SourceId | null;
  autoThreshold: number;

  src: Source = SOURCES.sim;
  candles: Candle[] = [];
  forming: Candle | null = null;
  peers: Peers = {};
  market: Market | null = null;
  decision: Decision | null = null;
  remote: ServerState | null = null;
  private remoteFetchedAt = 0;
  private remoteError: string | null = null;
  private pollTimer: number | undefined;
  private feed: Feed | null = null;
  private news: AnalyseEnv["news"] = [];
  private sim: GoldSimulator | null = null;
  private booting = false;
  private resyncing = false;
  private polling = false;
  private peersBusy = false;
  private lastTickPublish = 0;
  private candleVersion = 0;
  private tickVersion = 0;

  constructor() {
    const s = load();
    this.settings = { ...DEFAULT_SETTINGS, ...s.settings };
    this.st = s.st ?? newTraderState(this.settings.capital);
    this.st.ctx ??= {}; // saved by an older version
    this.thoughts = s.thoughts ?? [];
    this.lastProcessedT = s.lastProcessedT ?? 0;
    this.autopilot = s.autopilot ?? true;
    this.savedSource = s.source ?? null;
    this.autoThreshold = s.autoThreshold ?? THRESHOLDS.auto;
    this.publish();
  }

  // In server mode only the phone's preferences are saved: the local account is left untouched
  private save() {
    const data: Saved = this.remote
      ? { ...(load() as Saved), settings: this.settings }
      : {
          settings: this.settings,
          st: { ...this.st, trades: this.st.trades.slice(-500), mem: undefined }, // memory is rebuilt by training at boot
          thoughts: this.thoughts.slice(-MAX_THOUGHTS),
          lastProcessedT: this.lastProcessedT,
          autopilot: this.autopilot,
          source: this.src.id,
          autoThreshold: this.autoThreshold,
        };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* storage full or unavailable: the session keeps running in memory */
    }
  }

  private think(kind: Thought["kind"], text: string, t = Date.now()) {
    this.thoughts.push({ t, kind, text });
    if (this.thoughts.length > MAX_THOUGHTS) this.thoughts.splice(0, this.thoughts.length - MAX_THOUGHTS);
  }

  private threshold(): number {
    const r = this.remote;
    if (r) return r.settings.mode === "auto" ? r.autoThreshold : THRESHOLDS[r.settings.mode];
    return this.settings.mode === "auto" ? this.autoThreshold : THRESHOLDS[this.settings.mode];
  }

  // timeframe and spread of whoever is trading
  private tf(): number {
    return this.remote?.settings.tf ?? this.settings.tf;
  }

  private spread(): number {
    return this.remote?.settings.spread ?? this.settings.spread;
  }

  private env(): AnalyseEnv {
    return { m: this.market!, settings: this.settings, news: this.news, threshold: this.threshold() };
  }

  // Silver / dollar bars for the intermarket radar; a full reload after a long absence
  private async updatePeers(full = false) {
    if (this.peersBusy || this.src.id === "sim" || this.remote) return;
    this.peersBusy = true;
    try {
      if (full) this.peers = await fetchPeers(this.settings.trainDays + 10);
      else await refreshPeers(this.peers, Math.round((this.settings.trainDays + 10) * 24));
    } finally {
      this.peersBusy = false;
    }
  }

  private rebuild() {
    this.market = buildMarket(this.candles, this.tf(), this.peers);
    this.candleVersion++;
  }

  private livePrice(): number {
    return this.forming?.c ?? this.candles[this.candles.length - 1]?.c ?? this.remote?.price ?? 0;
  }

  private unrealized(p: Position | null): number {
    if (!p) return 0;
    const exitMid = this.livePrice() - (p.dir * this.spread()) / 2;
    return p.realized + p.dir * (exitMid - p.entry) * p.oz;
  }

  private dayOpen(): number {
    const s = this.market?.ltf;
    if (!s || !s.c.length) return 0;
    const last = s.c.length - 1;
    let i = last;
    while (i > 0 && s.day[i - 1] === s.day[last]) i--;
    return s.c[i].o;
  }

  publish(kind: "all" | "tick" = "all") {
    const st = this.remote?.st ?? this.st;
    const unreal = this.unrealized(st.position);
    const base: Partial<GoldState> = {
      price: this.livePrice(),
      position: st.position ? { ...st.position } : null,
      unrealized: unreal,
      equity: st.balance + unreal,
      tickVersion: ++this.tickVersion,
    };
    if (kind === "tick") {
      useGold.setState(base);
      return;
    }
    const r = this.remote;
    useGold.setState({
      ...base,
      source: this.market || r ? this.src.id : null,
      dayOpen: this.dayOpen(),
      candleVersion: this.candleVersion,
      decision: r ? r.decision : this.decision,
      balance: st.balance,
      trades: st.trades.slice(),
      thoughts: (r ? r.thoughts : this.thoughts).slice(),
      day: { ...st.day },
      brain: JSON.parse(JSON.stringify(st.brain)),
      ctx: JSON.parse(JSON.stringify(st.ctx ?? {})),
      memStats: JSON.parse(JSON.stringify(st.mem?.stats ?? {})),
      memTotal: st.mem?.total ?? 0,
      settings: { ...this.settings },
      trader: { ...(r ? r.settings : this.settings) },
      autopilot: this.autopilot,
      cooldownUntil: st.cooldownUntil,
      threshold: this.threshold(),
      remote: r
        ? { updatedAt: r.updatedAt, startedAt: r.startedAt, runs: r.runs, host: r.host, fetchedAt: this.remoteFetchedAt, error: this.remoteError }
        : null,
    });
  }

  private async chooseSource(): Promise<Source> {
    const tf = this.settings.tf;
    const order: SourceId[] = this.settings.source === "auto" ? ["xau", "paxg"] : this.settings.source === "sim" ? [] : [this.settings.source];
    for (const id of order) {
      useGold.setState({ bootMsg: `Connexion à ${SOURCES[id].label}…` });
      if (await probe(SOURCES[id], tf)) return SOURCES[id];
    }
    if (order.length) this.think("warn", "Aucun flux de prix réel joignable depuis ce réseau — je passe sur le marché simulé.");
    return SOURCES.sim;
  }

  async boot() {
    if (this.booting) return;
    this.booting = true;
    this.feed?.stop();
    this.feed = null;
    window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.remote = null;
    this.market = null;
    this.candles = [];
    this.forming = null;
    try {
      useGold.setState({ phase: "loading", progress: 0, bootMsg: "Connexion au marché de l'or…", feed: "off", serverNote: null, remote: null });
      if (this.settings.server) {
        useGold.setState({ bootMsg: "Connexion au serveur 24/7…" });
        try {
          const r = await fetchServerState(this.settings.serverUrl);
          if (Date.now() - r.updatedAt < REMOTE_MAX_AGE) {
            await this.bootRemote(r);
            return;
          }
          useGold.setState({ serverNote: `Le serveur 24/7 n'a plus tourné depuis ${ago(r.updatedAt)} : l'IA du téléphone prend le relais.` });
        } catch (e) {
          useGold.setState({ serverNote: `Serveur 24/7 injoignable (${(e as Error).message}) : l'IA du téléphone trade elle-même.` });
        }
      }
      await this.bootLocal();
    } catch (e) {
      useGold.setState({ phase: "error", bootMsg: `Impossible de démarrer : ${(e as Error).message}` });
    } finally {
      this.booting = false;
    }
  }

  // ---------- server mode ----------

  private async bootRemote(r: ServerState) {
    this.remote = r;
    this.remoteFetchedAt = Date.now();
    this.remoteError = null;
    this.src = SOURCES[(r.source in SOURCES ? r.source : "paxg") as SourceId];
    const tf = r.settings.tf;
    useGold.setState({ bootMsg: `Chargement du graphique ${this.src.short}…`, training: r.training });
    try {
      const all = await fetchHistory(this.src, tf, 6);
      const now = Date.now();
      this.candles = all.filter((k) => k.t + tf * 60000 <= now);
      this.forming = all.find((k) => k.t + tf * 60000 > now) ?? null;
    } catch {
      this.candles = []; // no chart on this network, the account is still mirrored
    }
    if (this.candles.length) {
      this.rebuild();
      this.startFeed();
    }
    this.pollTimer = window.setInterval(() => this.pollRemote(), REMOTE_POLL_MS);
    useGold.setState({ phase: "ready" });
    this.publish();
    this.save();
  }

  private async pollRemote() {
    if (!this.remote || this.polling) return;
    this.polling = true;
    try {
      const stamp = await fetchServerStamp(this.settings.serverUrl);
      if (stamp !== null && stamp <= this.remote.updatedAt) {
        this.remoteFetchedAt = Date.now();
        this.remoteError = null;
        this.publish();
        return;
      }
      const r = await fetchServerState(this.settings.serverUrl);
      this.remoteFetchedAt = Date.now();
      this.remoteError = null;
      if (r.updatedAt > this.remote.updatedAt) this.applyRemote(r);
      else this.publish();
    } catch (e) {
      this.remoteError = (e as Error).message;
      this.publish();
    } finally {
      this.polling = false;
    }
  }

  // New trades and positions on the server become phone notifications while the app is open
  private applyRemote(r: ServerState) {
    const prev = this.remote!;
    this.remote = r;
    const known = new Set(prev.st.trades.map((t) => t.id + t.openTime));
    for (const t of r.st.trades) if (!known.has(t.id + t.openTime)) this.alertClose(t);
    const p = r.st.position;
    if (p && (p.id !== prev.st.position?.id || p.openTime !== prev.st.position?.openTime)) this.alertOpen(p);
    useGold.setState({ training: r.training });
    this.publish();
  }

  // ---------- local mode ----------

  private async bootLocal() {
    this.src = await this.chooseSource();
    const tf = this.settings.tf;
    const days = this.settings.trainDays + 10;
    useGold.setState({ bootMsg: `Chargement de ${days} jours d'historique ${this.src.short}…` });
    const newsP = this.src.id === "sim" ? Promise.resolve([]) : fetchNews();
    const peersP = this.src.id === "sim" ? Promise.resolve({}) : fetchPeers(days);
    let all: Candle[];
    if (this.src.id === "sim") {
      this.sim = new GoldSimulator(Math.floor(Date.now() / DAY), 4000);
      all = this.sim.history(Date.now(), Math.round((days * 1440) / tf), tf);
    } else {
      all = await fetchHistory(this.src, tf, days, (p) => useGold.setState({ progress: p }));
    }
    this.news = await newsP;
    this.peers = await peersP;
    const now = Date.now();
    const closed = all.filter((k) => k.t + tf * 60000 <= now);
    this.forming = all.find((k) => k.t + tf * 60000 > now) ?? null;
    if (closed.length < 400) throw new Error("Historique insuffisant");
    this.candles = closed;
    this.rebuild();
    this.think("info", `Flux : ${this.src.label}. ${closed.length} bougies M${tf} chargées.`);
    const radar = [this.peers.xag?.length ? "argent (XAG)" : "", this.peers.eur?.length ? "dollar (EUR/USD)" : ""].filter(Boolean);
    if (radar.length) this.think("info", `Radar intermarché actif : ${radar.join(" + ")}.`);
    if (this.news.length) this.think("info", `${this.news.length} annonces US à fort impact cette semaine : je me mettrai à l'écart autour.`);

    useGold.setState({ phase: "training", bootMsg: `Entraînement sur ${this.settings.trainDays} jours d'or…` });
    await new Promise((r) => setTimeout(r, 60));
    await this.train();
    this.catchUp();
    this.startFeed();
    useGold.setState({ phase: "ready" });
    this.publish();
    this.save();
    if (this.autopilot && this.settings.keepAwake) keepAwake(true);
  }

  async train() {
    const tr = await train(this.env(), this.src.id, (msg, p) => useGold.setState({ bootMsg: msg, progress: p }));
    this.st.brain = tr.st.brain;
    this.st.ctx = tr.st.ctx;
    this.st.mem = tr.st.mem;
    if (this.settings.mode === "auto") this.autoThreshold = tr.threshold;
    useGold.setState({ training: tr.result });
    for (const text of trainingTexts(tr.result)) this.think("learn", text);
  }

  async retrain() {
    if (!this.market || this.remote) return;
    await this.train();
    this.decision = analyse(this.env(), this.st, this.market.ltf.c.length - 1);
    this.publish();
    this.save();
  }

  // Replays the candles missed while the app was closed, exactly as a 24/7 server would have.
  private catchUp() {
    const m = this.market!;
    const s = m.ltf;
    const tfMs = this.settings.tf * 60000;
    const last = s.c.length - 1;
    const sameSource = this.savedSource === null || this.savedSource === this.src.id;
    this.savedSource = this.src.id;
    if (!this.lastProcessedT || !sameSource) {
      if (!sameSource) this.think("warn", "Source de prix changée : pas de rattrapage sur la période manquée.");
      this.lastProcessedT = s.c[last].t + tfMs;
      this.decision = analyse(this.env(), this.st, last);
      return;
    }
    let from = s.c.findIndex((k) => k.t + tfMs > this.lastProcessedT);
    if (from < 0) {
      this.decision = analyse(this.env(), this.st, last);
      return;
    }
    from = Math.max(from, warmupIndex(m), last - Math.round((7 * DAY) / tfMs));
    const missed = last - from + 1;
    const before = this.st.trades.length;
    simulate(this.env(), this.st, from, last, {
      replay: true,
      allowEntries: this.autopilot,
      onEvent: (e) => {
        if (e.kind === "open" && e.position) this.think("entry", openText(e.position), e.t);
        if (e.kind === "close" && e.trade) this.logClose(e.trade, false);
      },
    });
    this.lastProcessedT = s.c[last].t + tfMs;
    if (this.st.pending) {
      const plan = this.st.pending;
      this.st.pending = null;
      const p = openPosition(this.st, plan, this.livePrice(), Date.now(), this.settings, s.atr[last], false);
      if (p) this.onOpened(p);
    }
    const n = this.st.trades.length - before;
    if (missed > 1) this.think("info", `Rattrapage : ${missed} bougies analysées pendant ton absence${n ? `, ${n} trade(s) clôturé(s)` : ""}.`);
    this.decision = analyse(this.env(), this.st, last);
  }

  // ---------- live stream (both modes) ----------

  private startFeed() {
    const tf = this.tf();
    const handlers = {
      onTick: (k: Candle) => this.onTick(k),
      onClose: (k: Candle) => this.onClose(k),
      onStatus: (f: GoldState["feed"]) => useGold.setState({ feed: f }),
    };
    if (this.src.id === "sim") {
      this.feed = new SimFeed(this.sim!, tf, this.livePrice(), handlers);
    } else {
      const f = new BinanceFeed(this.src, tf, handlers);
      f.setLastClosed(this.candles[this.candles.length - 1].t);
      this.feed = f;
    }
    this.feed.start();
  }

  private onTick(k: Candle) {
    if (!this.market) return;
    const tfMs = this.tf() * 60000;
    const lastT = this.candles[this.candles.length - 1].t;
    if (k.t <= lastT) return;
    if (k.t > lastT + tfMs) {
      this.resync();
      return;
    }
    const prev = this.forming && this.forming.t === k.t ? this.forming : null;
    this.forming = { ...k };
    if (!this.remote && this.st.position) {
      const o = prev ? prev.c : k.o;
      const mini: Candle = {
        t: k.t,
        o,
        h: prev ? (k.h > prev.h ? k.h : Math.max(o, k.c)) : k.h,
        l: prev ? (k.l < prev.l ? k.l : Math.min(o, k.c)) : k.l,
        c: k.c,
        v: 0,
      };
      const tr = manageBar(this.st, mini, Date.now(), this.settings.spread);
      if (tr) {
        this.logClose(tr, true);
        this.publish();
        this.save();
        return;
      }
    }
    const now = Date.now();
    if (now - this.lastTickPublish > 200) {
      this.lastTickPublish = now;
      this.publish("tick");
    }
  }

  private appendClosed(list: Candle[]) {
    this.candles.push(...list);
    const days = this.remote ? 6 : this.settings.trainDays + 10;
    const maxLen = Math.round((days * 1440) / this.tf());
    if (this.candles.length > maxLen) this.candles.splice(0, this.candles.length - maxLen);
  }

  private onClose(k: Candle) {
    if (!this.market) return;
    const tfMs = this.tf() * 60000;
    const lastT = this.candles[this.candles.length - 1].t;
    if (k.t <= lastT) return;
    if (k.t > lastT + tfMs) {
      this.resync();
      return;
    }
    const prev = this.forming && this.forming.t === k.t ? this.forming : null;
    this.appendClosed([k]);
    this.forming = null;
    this.rebuild();
    if (this.remote) {
      this.publish(); // the server does the trading
      return;
    }
    const i = this.candles.length - 1;
    const tClose = k.t + tfMs;
    if (this.st.position) {
      // if ticks covered this candle only the remaining move is new; otherwise use the whole candle
      const o = prev ? prev.c : k.o;
      const bar = prev ? { ...k, o, h: k.h > prev.h ? k.h : Math.max(o, k.c), l: k.l < prev.l ? k.l : Math.min(o, k.c) } : k;
      const tr = manageBar(this.st, bar, tClose, this.settings.spread) ?? endOfBar(this.st, this.market, i, this.settings.spread);
      if (tr) this.logClose(tr, true);
    }
    rollDay(this.st, tClose);
    resolveShadows((this.st.mem ??= emptyMemory()), k, tClose, this.settings.spread);
    this.decide(i);
    this.lastProcessedT = tClose;
    this.publish();
    this.save();
    this.updatePeers();
  }

  private decide(i: number) {
    const d = analyse(this.env(), this.st, i);
    this.decision = d;
    rememberDecision(this.st, d, this.settings.spread);
    this.think("scan", scanText(d), d.t);
    if (!d.plan) return;
    if (!this.autopilot) {
      this.think("warn", `Pilote auto coupé : j'aurais pris ${sideFr(d.plan.dir)} (score ${d.score}).`, d.t);
      if (this.settings.notify) notify("AURUM — signal", `${sideFr(d.plan.dir)} or · score ${d.score} (pilote auto coupé)`);
      return;
    }
    const p = openPosition(this.st, d.plan, this.livePrice(), Date.now(), this.settings, this.market!.ltf.atr[i], false);
    if (p) this.onOpened(p);
  }

  private onOpened(p: Position) {
    this.think("entry", openText(p), p.openTime);
    this.alertOpen(p);
  }

  private alertOpen(p: Position) {
    if (this.settings.notify) notify(...openAlert(p));
    if (this.settings.sound) beep("open");
    vibrate([60, 40, 60]);
  }

  private alertClose(tr: Trade) {
    if (this.settings.notify) notify(...closeAlert(tr));
    if (this.settings.sound) beep(tr.pnl >= 0 ? "win" : "loss");
    vibrate(tr.pnl >= 0 ? [40, 30, 40, 30, 120] : [200]);
  }

  private logClose(tr: Trade, live: boolean) {
    this.think("exit", closeText(tr), tr.closeTime);
    const lesson = lossText(tr);
    if (lesson) this.think("learn", lesson, tr.closeTime);
    if (live) this.alertClose(tr);
  }

  // Fetch candles missed after a sleep / network drop (and replay them in local mode)
  async resync() {
    if (this.resyncing || this.booting || !this.market) return;
    this.resyncing = true;
    try {
      const tf = this.tf();
      const tfMs = tf * 60000;
      const lastT = this.candles[this.candles.length - 1].t;
      let fresh: Candle[];
      if (this.src.id === "sim") {
        const n = Math.floor((Date.now() - (lastT + tfMs)) / tfMs);
        fresh = n > 0 ? this.sim!.history(Date.now(), Math.min(n, 2000), tf).filter((k) => k.t > lastT) : [];
      } else if (Date.now() - lastT > 3 * DAY) {
        fresh = await fetchHistory(this.src, tf, Math.min((Date.now() - lastT) / DAY + 0.1, this.remote ? 6 : 99));
      } else {
        fresh = await fetchKlines(this.src, tf, { start: lastT + tfMs });
      }
      const now = Date.now();
      const closed = fresh.filter((k) => k.t > lastT && k.t + tfMs <= now);
      const forming = fresh.find((k) => k.t + tfMs > now) ?? null;
      if (closed.length) {
        if (!this.remote) await this.updatePeers(now - lastT > 5 * 3_600_000);
        this.appendClosed(closed);
        this.rebuild();
        if (!this.remote) this.catchUp();
      }
      if (forming) this.forming = forming;
      if (this.feed instanceof BinanceFeed) this.feed.setLastClosed(this.candles[this.candles.length - 1].t);
      this.publish();
      this.save();
    } catch {
      useGold.setState({ feed: "reconnecting" });
    } finally {
      this.resyncing = false;
    }
  }

  onVisible() {
    if (useGold.getState().phase !== "ready") return;
    if (this.remote) this.pollRemote();
    this.resync();
    if (!this.remote && this.autopilot && this.settings.keepAwake) keepAwake(true);
  }

  setAutopilot(on: boolean) {
    if (this.remote) return;
    this.autopilot = on;
    this.think("info", on ? "Pilote automatique activé : je trade seul." : "Pilote automatique coupé : j'analyse mais je n'ouvre plus rien.");
    keepAwake(on && this.settings.keepAwake);
    this.publish();
    this.save();
  }

  closeNow() {
    const p = this.st.position;
    if (!p || this.remote) return;
    const fill = this.livePrice() - (p.dir * this.settings.spread) / 2;
    const tr = closePosition(this.st, fill, Date.now(), "MANUEL");
    this.logClose(tr, true);
    this.publish();
    this.save();
  }

  updateSettings(patch: Partial<Settings>) {
    const prev = this.settings;
    this.settings = { ...prev, ...patch };
    const changed = (k: keyof Settings) => patch[k] !== undefined && patch[k] !== prev[k];
    if (patch.keepAwake !== undefined) keepAwake(!this.remote && this.autopilot && this.settings.keepAwake);
    if (changed("server") || changed("serverUrl")) {
      this.save();
      this.boot();
      return;
    }
    if (this.remote) {
      // the server follows server/config.json; these only matter if the phone trades again
      this.save();
      this.publish();
      return;
    }
    const reboot = changed("tf");
    if (reboot) {
      // a different timeframe is a different trader: start a clean journal
      if (this.st.position) this.closeNow();
      this.lastProcessedT = 0;
    }
    this.save();
    if (reboot || changed("source") || changed("trainDays")) {
      this.boot();
      return;
    }
    if (changed("mode")) this.retrain();
    else this.publish();
  }

  resetAccount() {
    if (this.remote) return;
    const brain = this.st.brain;
    const ctx = this.st.ctx;
    const mem = this.st.mem;
    this.st = newTraderState(this.settings.capital);
    this.st.brain = brain;
    this.st.ctx = ctx;
    this.st.mem = mem; // the experience stays, only the account restarts
    this.thoughts = [];
    if (this.market) this.lastProcessedT = this.market.ltf.c[this.market.ltf.c.length - 1].t + this.settings.tf * 60000;
    this.think("info", `Compte démo remis à ${this.settings.capital.toFixed(0)} $.`);
    this.publish();
    this.save();
  }
}

export const bot = new Bot();
