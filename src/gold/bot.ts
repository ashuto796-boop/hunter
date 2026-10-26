// The autonomous trader: loads history, trains the brain walk-forward, replays what happened while
// the phone was asleep, then trades the live stream on a paper account with real prices.
import { Candle, Decision, Position, Settings, Trade, TraderState } from "./engine/types";
import { Market, buildMarket } from "./engine/features";
import { AnalyseEnv, REGIME_LABEL, analyse } from "./engine/brain";
import { closePosition, endOfBar, manageBar, newTraderState, openPosition, rollDay, simulate, warmupIndex } from "./engine/trader";
import { computeStats, equityCurve } from "./engine/stats";
import { GoldSimulator } from "./engine/sim";
import { MODULE_INFO } from "./engine/modules";
import { BinanceFeed, Feed, SOURCES, Source, SourceId, SimFeed, fetchHistory, fetchKlines, fetchNews, probe } from "./data/feed";
import { DEFAULT_SETTINGS, GoldState, Thought, useGold } from "./store";
import { beep, keepAwake, notify, vibrate } from "./device";

const KEY = "aurum.v1";
const DAY = 864e5;
const MAX_THOUGHTS = 120;

interface Saved {
  settings: Settings;
  st: TraderState;
  thoughts: Thought[];
  lastProcessedT: number;
  autopilot: boolean;
  source: SourceId | null;
}

function load(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Saved>;
  } catch {
    return {};
  }
}

const money = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)} $`;
const px = (x: number) => x.toFixed(2);
const lots = (oz: number) => (oz / 100).toFixed(2);
const sideFr = (d: number) => (d === 1 ? "ACHAT" : "VENTE");

class Bot {
  settings: Settings;
  st: TraderState;
  thoughts: Thought[];
  lastProcessedT: number;
  autopilot: boolean;
  savedSource: SourceId | null;

  src: Source = SOURCES.sim;
  candles: Candle[] = [];
  forming: Candle | null = null;
  market: Market | null = null;
  decision: Decision | null = null;
  private feed: Feed | null = null;
  private news: AnalyseEnv["news"] = [];
  private sim: GoldSimulator | null = null;
  private booting = false;
  private resyncing = false;
  private lastTickPublish = 0;
  private candleVersion = 0;
  private tickVersion = 0;

  constructor() {
    const s = load();
    this.settings = { ...DEFAULT_SETTINGS, ...s.settings };
    this.st = s.st ?? newTraderState(this.settings.capital);
    this.thoughts = s.thoughts ?? [];
    this.lastProcessedT = s.lastProcessedT ?? 0;
    this.autopilot = s.autopilot ?? true;
    this.savedSource = s.source ?? null;
    this.publish();
  }

  private save() {
    const data: Saved = {
      settings: this.settings,
      st: { ...this.st, trades: this.st.trades.slice(-500) },
      thoughts: this.thoughts.slice(-MAX_THOUGHTS),
      lastProcessedT: this.lastProcessedT,
      autopilot: this.autopilot,
      source: this.src.id,
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

  private env(): AnalyseEnv {
    return { m: this.market!, settings: this.settings, news: this.news };
  }

  private livePrice(): number {
    return this.forming?.c ?? this.candles[this.candles.length - 1]?.c ?? 0;
  }

  private unrealized(p: Position | null): number {
    if (!p) return 0;
    const exitMid = this.livePrice() - (p.dir * this.settings.spread) / 2;
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
    const unreal = this.unrealized(this.st.position);
    const base: Partial<GoldState> = {
      price: this.livePrice(),
      position: this.st.position ? { ...this.st.position } : null,
      unrealized: unreal,
      equity: this.st.balance + unreal,
      tickVersion: ++this.tickVersion,
    };
    if (kind === "tick") {
      useGold.setState(base);
      return;
    }
    useGold.setState({
      ...base,
      source: this.market ? this.src.id : null,
      dayOpen: this.dayOpen(),
      candleVersion: this.candleVersion,
      decision: this.decision,
      balance: this.st.balance,
      trades: this.st.trades.slice(),
      thoughts: this.thoughts.slice(),
      day: { ...this.st.day },
      brain: JSON.parse(JSON.stringify(this.st.brain)),
      settings: { ...this.settings },
      autopilot: this.autopilot,
      cooldownUntil: this.st.cooldownUntil,
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
    try {
      useGold.setState({ phase: "loading", progress: 0, bootMsg: "Connexion au marché de l'or…", feed: "off" });
      this.src = await this.chooseSource();
      const tf = this.settings.tf;
      const days = this.settings.trainDays + 10;
      useGold.setState({ bootMsg: `Chargement de ${days} jours d'historique ${this.src.short}…` });
      const newsP = this.src.id === "sim" ? Promise.resolve([]) : fetchNews();
      let all: Candle[];
      if (this.src.id === "sim") {
        this.sim = new GoldSimulator(Math.floor(Date.now() / DAY), 4000);
        all = this.sim.history(Date.now(), Math.round((days * 1440) / tf), tf);
      } else {
        all = await fetchHistory(this.src, tf, days, (p) => useGold.setState({ progress: p }));
      }
      this.news = await newsP;
      const now = Date.now();
      const closed = all.filter((k) => k.t + tf * 60000 <= now);
      this.forming = all.find((k) => k.t + tf * 60000 > now) ?? null;
      if (closed.length < 400) throw new Error("Historique insuffisant");
      this.candles = closed;
      this.market = buildMarket(closed, tf);
      this.candleVersion++;
      this.think("info", `Flux : ${this.src.label}. ${closed.length} bougies M${tf} chargées.`);
      if (this.news.length) this.think("info", `${this.news.length} annonces US à fort impact cette semaine : je me mettrai à l'écart autour.`);

      useGold.setState({ phase: "training", bootMsg: `Entraînement sur ${this.settings.trainDays} jours d'or…` });
      await new Promise((r) => setTimeout(r, 60));
      this.train();
      this.catchUp();
      this.startFeed();
      useGold.setState({ phase: "ready" });
      this.publish();
      this.save();
      if (this.autopilot && this.settings.keepAwake) keepAwake(true);
    } catch (e) {
      useGold.setState({ phase: "error", bootMsg: `Impossible de démarrer : ${(e as Error).message}` });
    } finally {
      this.booting = false;
    }
  }

  // Walk-forward training: the brain lives through the whole history candle by candle,
  // trading it on a separate account, and keeps the per-module memory it built.
  train() {
    const m = this.market!;
    const st = newTraderState(this.settings.capital);
    const from = warmupIndex(m);
    const to = m.ltf.c.length - 1;
    simulate(this.env(), st, from, to, { replay: false });
    this.st.brain = st.brain;
    const stats = computeStats(st.trades, this.settings.capital);
    const tfMs = this.settings.tf * 60000;
    const t0 = m.ltf.c[Math.min(from, to)].t;
    useGold.setState({
      training: {
        at: Date.now(),
        source: this.src.id,
        mode: this.settings.mode,
        from: t0,
        to: m.ltf.c[to].t + tfMs,
        days: (m.ltf.c[to].t - t0) / DAY,
        candles: to - from + 1,
        stats,
        curve: equityCurve(st.trades, this.settings.capital, t0),
        trades: st.trades.slice().reverse(),
      },
    });
    this.think(
      "learn",
      `Entraînement terminé : ${stats.n} trades simulés en ${((m.ltf.c[to].t - t0) / DAY).toFixed(0)} jours — ` +
        `réussite ${(stats.winRate * 100).toFixed(0)} %, facteur de profit ${Number.isFinite(stats.pf) ? stats.pf.toFixed(2) : "∞"}, ` +
        `${stats.sumR >= 0 ? "+" : ""}${stats.sumR.toFixed(1)}R. Poids des modules ajustés.`
    );
  }

  retrain() {
    if (!this.market) return;
    this.train();
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
        if (e.kind === "open" && e.position) this.logOpen(e.position, e.t);
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

  private startFeed() {
    const tf = this.settings.tf;
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
    const tfMs = this.settings.tf * 60000;
    const lastT = this.candles[this.candles.length - 1].t;
    if (k.t <= lastT) return;
    if (k.t > lastT + tfMs) {
      this.resync();
      return;
    }
    const prev = this.forming && this.forming.t === k.t ? this.forming : null;
    this.forming = { ...k };
    if (this.st.position) {
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

  private onClose(k: Candle) {
    if (!this.market) return;
    const tfMs = this.settings.tf * 60000;
    const lastT = this.candles[this.candles.length - 1].t;
    if (k.t <= lastT) return;
    if (k.t > lastT + tfMs) {
      this.resync();
      return;
    }
    const prev = this.forming && this.forming.t === k.t ? this.forming : null;
    this.candles.push(k);
    const maxLen = Math.round(((this.settings.trainDays + 10) * 1440) / this.settings.tf);
    if (this.candles.length > maxLen) this.candles.splice(0, this.candles.length - maxLen);
    this.forming = null;
    this.market = buildMarket(this.candles, this.settings.tf);
    this.candleVersion++;
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
    this.decide(i);
    this.lastProcessedT = tClose;
    this.publish();
    this.save();
  }

  private decide(i: number) {
    const d = analyse(this.env(), this.st, i);
    this.decision = d;
    const bias = `${d.bias >= 0 ? "haussier" : "baissier"} ${Math.abs(d.bias * 100).toFixed(0)} %`;
    this.think("scan", `${REGIME_LABEL[d.regime]} · biais H1/H4 ${bias} · ${d.verdict}`, d.t);
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
    this.logOpen(p, p.openTime);
    if (this.settings.notify) notify(`AURUM — ${sideFr(p.dir)} ${lots(p.oz0)} lot`, `Entrée ${px(p.entry)} · SL ${px(p.sl0)} · TP ${px(p.tp2)} · score ${p.score}`);
    if (this.settings.sound) beep("open");
    vibrate([60, 40, 60]);
  }

  private logOpen(p: Position, t: number) {
    const why = p.reasons.slice(0, 2).join(" · ");
    this.think(
      "entry",
      `${p.replay ? "[rattrapage] " : ""}${sideFr(p.dir)} ${lots(p.oz0)} lot à ${px(p.entry)} — SL ${px(p.sl0)}, TP1 ${px(p.tp1)}, TP2 ${px(p.tp2)}. ` +
        `Module principal : ${MODULE_INFO[p.primary].name}. ${why}`,
      t
    );
  }

  private logClose(tr: Trade, live: boolean) {
    const label: Record<Trade["reason"], string> = {
      SL: "Stop touché",
      TP2: "Objectif final atteint",
      BE: "Sortie à break-even",
      TRAIL: "Stop suiveur touché",
      TEMPS: "Trade sans élan, coupé",
      WEEKEND: "Fermeture avant le week-end",
      MANUEL: "Clôture manuelle",
    };
    this.think("exit", `${tr.replay ? "[rattrapage] " : ""}${label[tr.reason]} : ${tr.r >= 0 ? "+" : ""}${tr.r.toFixed(2)}R (${money(tr.pnl)}).`, tr.closeTime);
    if (tr.r < -0.1) this.think("learn", `Perte enregistrée : ${MODULE_INFO[tr.primary].name} perd un peu de poids dans mes décisions.`, tr.closeTime);
    if (!live) return;
    if (this.settings.notify) notify(`AURUM — ${label[tr.reason]}`, `${tr.r >= 0 ? "+" : ""}${tr.r.toFixed(2)}R · ${money(tr.pnl)}`);
    if (this.settings.sound) beep(tr.pnl >= 0 ? "win" : "loss");
    vibrate(tr.pnl >= 0 ? [40, 30, 40, 30, 120] : [200]);
  }

  // Fetch candles missed after a sleep / network drop and replay them
  async resync() {
    if (this.resyncing || this.booting || !this.market) return;
    this.resyncing = true;
    try {
      const tf = this.settings.tf;
      const tfMs = tf * 60000;
      const lastT = this.candles[this.candles.length - 1].t;
      let fresh: Candle[];
      if (this.src.id === "sim") {
        const n = Math.floor((Date.now() - (lastT + tfMs)) / tfMs);
        fresh = n > 0 ? this.sim!.history(Date.now(), Math.min(n, 2000), tf).filter((k) => k.t > lastT) : [];
      } else if (Date.now() - lastT > 3 * DAY) {
        fresh = await fetchHistory(this.src, tf, (Date.now() - lastT) / DAY + 0.1);
      } else {
        fresh = await fetchKlines(this.src, tf, { start: lastT + tfMs });
      }
      const now = Date.now();
      const closed = fresh.filter((k) => k.t > lastT && k.t + tfMs <= now);
      const forming = fresh.find((k) => k.t + tfMs > now) ?? null;
      if (closed.length) {
        this.candles.push(...closed);
        const maxLen = Math.round(((this.settings.trainDays + 10) * 1440) / tf);
        if (this.candles.length > maxLen) this.candles.splice(0, this.candles.length - maxLen);
        this.market = buildMarket(this.candles, tf);
        this.candleVersion++;
        this.catchUp();
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
    this.resync();
    if (this.autopilot && this.settings.keepAwake) keepAwake(true);
  }

  setAutopilot(on: boolean) {
    this.autopilot = on;
    this.think("info", on ? "Pilote automatique activé : je trade seul." : "Pilote automatique coupé : j'analyse mais je n'ouvre plus rien.");
    keepAwake(on && this.settings.keepAwake);
    this.publish();
    this.save();
  }

  closeNow() {
    const p = this.st.position;
    if (!p) return;
    const fill = this.livePrice() - (p.dir * this.settings.spread) / 2;
    const tr = closePosition(this.st, fill, Date.now(), "MANUEL");
    this.logClose(tr, true);
    this.publish();
    this.save();
  }

  updateSettings(patch: Partial<Settings>) {
    const prev = this.settings;
    this.settings = { ...prev, ...patch };
    const reboot = patch.tf !== undefined && patch.tf !== prev.tf;
    const reload =
      (patch.source !== undefined && patch.source !== prev.source) || (patch.trainDays !== undefined && patch.trainDays !== prev.trainDays);
    if (patch.keepAwake !== undefined) keepAwake(this.autopilot && this.settings.keepAwake);
    if (reboot) {
      // a different timeframe is a different trader: start a clean journal
      if (this.st.position) this.closeNow();
      this.lastProcessedT = 0;
    }
    this.save();
    if (reboot || reload) {
      this.boot();
      return;
    }
    if (patch.mode !== undefined && patch.mode !== prev.mode) this.retrain();
    else this.publish();
  }

  resetAccount() {
    const brain = this.st.brain;
    this.st = newTraderState(this.settings.capital);
    this.st.brain = brain;
    this.thoughts = [];
    if (this.market) this.lastProcessedT = this.market.ltf.c[this.market.ltf.c.length - 1].t + this.settings.tf * 60000;
    this.think("info", `Compte démo remis à ${this.settings.capital.toFixed(0)} $.`);
    this.publish();
    this.save();
  }
}

export const bot = new Bot();
