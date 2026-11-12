// Real-money execution. The AI keeps trading its demo account exactly as before; this step copies
// its decisions onto a broker account (Capital.com: demo first, live only after an explicit
// confirmation):
//
// - a new entry is sent right after the candle that decided it, sized on the real account
//   (risk % of NAV, converted to the account currency). With a partial first target the position
//   is split in two legs like the demo account (leg a at 1R, leg b at the final target); with a
//   single target it is one position. Stops and targets are held by the broker, so
//   they work between server runs.
// - every run, the real stops follow the AI's stops (only ever tightened), leg a is closed when
//   the AI takes its first profit, and anything the AI no longer holds is closed.
// - breakers: daily loss, total drawdown (closes everything until reset), stale or mismatched
//   prices, late runs, small account, missing confirmation. When in doubt, nothing is sent.
import { LIVE_CONFIRM, LiveClosed, LiveEvent, LiveLeg, LiveState, runGapMin } from "../src/gold/engine/live";
import { Dir, Plan, Position } from "../src/gold/engine/types";
import { tradingDay } from "../src/gold/engine/context";
import { STRATEGY } from "../src/gold/engine/strategy";

export type BrokerEnv = "practice" | "live";

export interface BrokerAccount {
  currency: string;
  nav: number;
  balance: number;
  unrealized: number;
  marginAvailable: number;
}

export interface BrokerInstrument {
  precision: number; // decimals allowed in prices
  minUnits: number; // smallest position size
  unitsStep: number; // size increment
  marginRate: number;
  valuePerPoint: number; // account-free value of a 1-dollar move for a size of 1 (1 for gold in ounces)
}

export interface BrokerPrice {
  bid: number;
  ask: number;
  tradeable: boolean;
  toHome: number; // converts a loss in USD (quote currency) into the account currency
}

export interface BrokerTrade {
  id: string;
  clientId: string | null;
  units: number; // signed
  price: number;
  openTime: number;
  sl: number | null;
  tp: number | null;
  pl: number;
  closeTime: number | null;
  closePrice: number | null;
}

export interface BrokerConfig {
  enabled: boolean; // false: no new entries (open trades are still managed and closed)
  riskPct: number; // risk per trade, % of NAV (capped by maxRiskPct)
  maxRiskPct: number; // hard ceiling on the risk of one trade, % of NAV
  allowMinSize: boolean; // small account: take the broker's minimum size (1 oz) when the budget is smaller, within maxRiskPct
  marginUse: number; // share of the free margin a new position may use (0..1)
  maxDailyLossPct: number; // NAV down this much since the start of the day: no new entries today
  maxDrawdownPct: number; // NAV down this much since the start (or the last reset): close all, stop
  maxEntryDelayMin: number; // an entry older than this is skipped
  maxUnits: number; // position size, at most
  epic: string; // the broker's name for gold (Capital.com: GOLD)
  maxRunGapMin: number; // live only: no new entries while the server runs less often than this
  liveConfirm: string; // must equal LIVE_CONFIRM for a live account
  reset: number; // bump it to re-arm the breaker after a stop
}

export const DEFAULT_BROKER: BrokerConfig = {
  enabled: true,
  riskPct: 0.5,
  maxRiskPct: 2,
  allowMinSize: false,
  marginUse: 0.5,
  maxDailyLossPct: 2,
  maxDrawdownPct: 10,
  maxEntryDelayMin: 20,
  maxUnits: 20,
  epic: "GOLD",
  maxRunGapMin: 30,
  liveConfirm: "",
  reset: 0,
};

// What the server needs from the broker (the Capital.com client, or a fake one in tests)
export interface BrokerApi {
  labels?: Record<string, string>; // broker deal id -> AURUM leg id, for brokers without client labels
  instrument(): Promise<BrokerInstrument>;
  account(): Promise<BrokerAccount>;
  price(): Promise<BrokerPrice>;
  openTrades(): Promise<BrokerTrade[]>;
  closedTrades(count?: number): Promise<BrokerTrade[]>;
  marketOrder(o: { units: number; sl: number; tp: number; clientId: string; comment: string }): Promise<{ tradeId: string; price: number }>;
  setStopLoss(t: BrokerTrade, price: number): Promise<void>;
  close(t: BrokerTrade): Promise<{ price: number; pl: number }>;
}

export interface SyncInput {
  api: BrokerApi;
  env: BrokerEnv;
  cfg: BrokerConfig;
  prev: LiveState | null;
  position: Position | null; // the AI's open position after this run
  pending: Plan | null; // an entry the AI decided on the last candle (fills at the next open)
  decidedAt: number; // close time of that candle
  paperPrice: number; // last close on the AI's feed
  realGold: boolean; // the AI's feed is gold itself (not a gold token)
  now: number;
}

const MAX_LOG = 80;
const CLOSED_TEXT = "Marché fermé chez le courtier : les stops et objectifs restent posés, rien d'autre à faire.";
const PRICE_TOLERANCE = 0.006; // the AI's feed and the broker must agree within 0.6 %
const keyOf = (t: number) => `au-${Math.round(t / 1000)}`;
const legOf = (clientId: string | null): "a" | "b" => (clientId?.endsWith("-a") ? "a" : "b");
const p2 = (x: number) => x.toFixed(2);
const floorTo = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;
const sz = (x: number) => String(Number(x.toFixed(4)));
const side = (d: Dir) => (d === 1 ? "achat" : "vente");

export function freshLive(env: BrokerEnv, now: number): LiveState {
  return {
    broker: "capital",
    env,
    status: "en pause",
    reason: null,
    currency: "",
    nav: 0,
    balance: 0,
    unrealized: 0,
    marginAvailable: 0,
    riskPct: 0,
    startNav: 0,
    startedAt: now,
    dayKey: "",
    dayStartNav: 0,
    resetSeen: 0,
    halt: null,
    open: [],
    closed: [],
    log: [],
    handled: [],
    executions: 0,
    errors: 0,
    runTimes: [],
    updatedAt: 0,
  };
}

export async function syncLive(inp: SyncInput): Promise<{ state: LiveState; alerts: [string, string][] }> {
  const { api, env, cfg, position, now } = inp;
  const s: LiveState = inp.prev && inp.prev.env === env ? structuredClone(inp.prev) : freshLive(env, now);
  const alerts: [string, string][] = [];
  const label = env === "live" ? "RÉEL" : "essai";
  const say = (kind: LiveEvent["kind"], text: string, alert = false) => {
    s.log.push({ t: now, kind, text });
    if (alert) alerts.push([`AURUM ${label} — ${kind}`, text]);
  };
  const fail = (what: string, e: unknown) => {
    s.errors++;
    const text = `${what} : ${(e as Error).message}`;
    // the same failure is pushed once per 6 h, not at every run
    const seen = s.log.some((x) => x.kind === "erreur" && x.text === text && now - x.t < 6 * 3_600_000);
    say("erreur", text, !seen);
  };

  s.runTimes = [...s.runTimes, now].slice(-30);
  if (api.labels) Object.assign(api.labels, s.labels ?? {}); // deal ids this bot opened before
  const inst = await api.instrument();
  const acct = await api.account();
  const px = await api.price();
  if (!s.startNav) {
    s.startNav = acct.nav;
    say("info", `Compte Capital.com ${env === "live" ? "réel" : "démo"} relié : ${p2(acct.nav)} ${acct.currency}.`, true);
  }

  // --- breakers ---------------------------------------------------------------------------------
  const day = tradingDay(now);
  if (cfg.reset !== s.resetSeen) {
    // re-arm everything from the current value of the account
    s.resetSeen = cfg.reset;
    s.startNav = acct.nav;
    s.dayKey = day;
    s.dayStartNav = acct.nav;
    if (s.halt) say("info", "Coupe-circuit réarmé depuis la configuration.", true);
    s.halt = null;
  }
  if (s.dayKey !== day) {
    s.dayKey = day;
    s.dayStartNav = acct.nav;
    if (s.halt?.kind === "jour") s.halt = null;
  }
  if (!s.halt && acct.nav <= s.startNav * (1 - cfg.maxDrawdownPct / 100)) {
    s.halt = { kind: "total", at: now, text: `perte de ${cfg.maxDrawdownPct} % depuis le départ` };
    say("coupure", `Coupe-circuit : le compte a perdu ${cfg.maxDrawdownPct} % depuis le départ. Tout est fermé, plus aucun ordre jusqu'au réarmement.`, true);
  } else if (!s.halt && acct.nav <= s.dayStartNav * (1 - cfg.maxDailyLossPct / 100)) {
    s.halt = { kind: "jour", at: now, text: `perte de ${cfg.maxDailyLossPct} % aujourd'hui` };
    say("coupure", `Perte du jour atteinte (${cfg.maxDailyLossPct} %) : plus de nouvelle entrée aujourd'hui. Les positions gardent leurs stops.`, true);
  }

  // --- what the AI holds versus what the account holds -------------------------------------------
  const key = position ? keyOf(position.openTime) : null;
  const closedHere = new Set<string>();
  const closeLeg = async (t: BrokerTrade, why: string) => {
    try {
      const r = await api.close(t);
      closedHere.add(t.clientId ?? t.id);
      say("clôture", `${why} : ${sz(Math.abs(t.units))} fermé(s) à ${Number.isFinite(r.price) ? p2(r.price) : "?"} (${r.pl >= 0 ? "+" : ""}${p2(r.pl)} ${acct.currency}).`, true);
    } catch (e) {
      fail(`Clôture impossible (${t.clientId ?? t.id})`, e);
    }
  };

  const openAtStart = await api.openTrades();
  const openKeys = new Set(openAtStart.map((t) => t.clientId?.replace(/-[ab]$/, "")));
  if (!px.tradeable) {
    // weekend or daily break: orders would be refused, the broker's stops stay in place
    if (openAtStart.length && s.log[s.log.length - 1]?.text !== CLOSED_TEXT) say("info", CLOSED_TEXT);
  }
  for (const t of px.tradeable ? openAtStart : []) {
    const mine = !!key && !!t.clientId?.startsWith(`${key}-`);
    if (s.halt?.kind === "total") await closeLeg(t, "Coupe-circuit");
    else if (!mine) await closeLeg(t, "L'IA ne tient plus cette position");
    else if (position!.tp1Done && legOf(t.clientId) === "a") await closeLeg(t, "Premier objectif pris par l'IA");
    else {
      // the real stop follows the AI's stop, tighter only; if the market is already through it, exit
      const d = position!.dir;
      const want = position!.sl;
      const through = d === 1 ? px.bid <= want : px.ask >= want;
      if (through) await closeLeg(t, "Stop de l'IA dépassé");
      else if (t.sl === null || d * (want - t.sl) > 10 ** -inst.precision) {
        try {
          await api.setStopLoss(t, want);
          say("stop", `Stop ${t.sl === null ? "posé" : "remonté"} à ${p2(want)} (${t.clientId}).`);
        } catch (e) {
          fail("Stop non modifié", e);
        }
      }
    }
  }

  // --- new entries --------------------------------------------------------------------------------
  const recent = await api.closedTrades(50);
  const sentBefore = (k: string) => recent.some((t) => t.clientId?.startsWith(`${k}-`));
  const gap = runGapMin(s.runTimes);
  const gate = (): string | null => {
    if (!cfg.enabled) return "trading réel en pause (réglage « enabled »)";
    if (env === "live" && cfg.liveConfirm !== LIVE_CONFIRM) return "argent réel pas encore confirmé dans la configuration";
    if (env === "live" && !STRATEGY.realMoney) return "la stratégie actuelle est réservée au compte démo";
    if (s.halt) return `coupe-circuit : ${s.halt.text}`;
    if (!inp.realGold) return "le flux de l'IA n'est pas l'or lui-même";
    if (env === "live" && gap !== null && gap > cfg.maxRunGapMin) return `le serveur passe trop rarement (toutes les ${Math.round(gap)} min)`;
    return null;
  };
  const blocked = gate();
  s.status = s.halt?.kind === "total" ? "coupé" : blocked ? "en pause" : "actif";
  s.reason = blocked;

  // the entry to copy: decided on the last candle, or already filled on the demo account
  const entry: { t: number; dir: Dir; ref: number; sl: number; tp2: number } | null = inp.pending
    ? { t: inp.decidedAt, dir: inp.pending.dir, ref: inp.pending.entry, sl: inp.pending.sl, tp2: inp.pending.tp2 }
    : position && !position.tp1Done
      ? { t: position.openTime, dir: position.dir, ref: position.entry, sl: position.sl, tp2: position.tp2 }
      : null;
  if (entry && !s.handled.includes(entry.t) && !sentBefore(keyOf(entry.t)) && !openKeys.has(keyOf(entry.t))) {
    s.handled = [...s.handled, entry.t].slice(-60); // recorded first: an uncertain order is never sent twice
    const k = keyOf(entry.t);
    const d = entry.dir;
    const mid = (px.bid + px.ask) / 2;
    const fill = d === 1 ? px.ask : px.bid;
    const risk = Math.abs(entry.ref - entry.sl);
    const progress = (d * (mid - entry.ref)) / risk;
    const stopDist = d * (fill - entry.sl);
    const toHome = Number.isFinite(px.toHome) && px.toHome > 0 ? px.toHome : acct.currency === "USD" ? 1 : NaN;
    const riskPct = Math.min(cfg.riskPct, cfg.maxRiskPct);
    const riskAmt = (acct.nav * riskPct) / 100;
    const ozRisk = stopDist * toHome * (inst.valuePerPoint || 1); // what a size of 1 loses if the stop is hit
    const minRiskPct = (ozRisk * inst.minUnits * 100) / acct.nav;
    const step = inst.unitsStep > 0 ? inst.unitsStep : 1;
    let units = floorTo(riskAmt / ozRisk, step);
    // small account: the broker's minimum size, when the owner allows it and it stays under the ceiling
    if (units < inst.minUnits && cfg.allowMinSize && minRiskPct <= cfg.maxRiskPct) units = inst.minUnits;
    units = Math.min(units, floorTo(cfg.maxUnits, step));
    // margin: keep a cushion so a normal move never triggers a margin closeout
    const marginPerOz = fill * toHome * (inst.valuePerPoint || 1) * inst.marginRate;
    const marginCap = floorTo((acct.marginAvailable * Math.min(1, cfg.marginUse)) / marginPerOz, step);
    units = Math.min(units, marginCap);
    const ageMin = (now - entry.t) / 60000;
    const skip =
      blocked ??
      (ageMin > cfg.maxEntryDelayMin
        ? `signal vieux de ${Math.round(ageMin)} min`
        : !px.tradeable
          ? "le courtier ne cote pas l'or en ce moment"
          : Math.abs(mid - inp.paperPrice) / inp.paperPrice > PRICE_TOLERANCE
            ? `prix du courtier (${p2(mid)}) trop loin de celui de l'IA (${p2(inp.paperPrice)})`
            : progress > 0.35 || progress < -0.5 || stopDist <= 0
              ? "le prix a déjà trop bougé depuis la décision"
              : !Number.isFinite(toHome)
                ? `conversion USD → ${acct.currency} indisponible`
                : units < inst.minUnits && marginCap < inst.minUnits
                  ? `marge insuffisante (la plus petite position, ${sz(inst.minUnits)}, demande ${p2(marginPerOz * inst.minUnits)} ${acct.currency} de marge, le compte en a ${p2(acct.marginAvailable)})`
                  : units < inst.minUnits
                    ? `compte trop petit pour ce stop (la plus petite position risquerait ${p2(ozRisk * inst.minUnits)} ${acct.currency}, soit ${minRiskPct.toFixed(1)} % du compte ; plafond ${cfg.maxRiskPct} %)`
                  : null);
    if (skip) say("ignoré", `Signal ${side(d)} ignoré : ${skip}.`, env === "live" || !blocked);
    else {
      s.riskPct = Math.max(riskPct, (units * ozRisk * 100) / acct.nav);
      const tp1 = fill + d * stopDist;
      const tp2 = d * (entry.tp2 - fill) >= 1.3 * stopDist ? entry.tp2 : fill + d * 2 * stopDist;
      // two legs only when the strategy takes a partial profit at 1R (a single target is one position)
      const a = STRATEGY.tp1Fraction > 0 && units >= 2 * inst.minUnits ? Math.max(inst.minUnits, floorTo(units * STRATEGY.tp1Fraction, step)) : 0;
      const legs: ["a" | "b", number, number][] = a && units - a >= inst.minUnits ? [["a", a, tp1], ["b", Number((units - a).toFixed(6)), tp2]] : [["b", units, tp2]];
      for (const [leg, n, tp] of legs) {
        try {
          const r = await api.marketOrder({ units: d * n, sl: entry.sl, tp, clientId: `${k}-${leg}`, comment: `AURUM ${side(d)} ${leg === "a" ? "1R" : "TP2"}` });
          s.executions++;
          say("ordre", `${side(d) === "achat" ? "Achat" : "Vente"} de ${sz(n)} à ${p2(r.price)} · stop ${p2(entry.sl)} · objectif ${p2(tp)}.`, true);
        } catch (e) {
          fail(`Ordre ${side(d)} refusé`, e);
        }
      }
    }
  }

  // --- snapshot for the app -----------------------------------------------------------------------
  const after = await api.account();
  s.currency = after.currency;
  s.nav = after.nav;
  s.balance = after.balance;
  s.unrealized = after.unrealized;
  s.marginAvailable = after.marginAvailable;
  const before = s.open;
  s.open = (await api.openTrades()).map(
    (t): LiveLeg => ({ clientId: t.clientId ?? t.id, leg: legOf(t.clientId), units: t.units, price: t.price, openTime: t.openTime, sl: t.sl, tp: t.tp, pl: t.pl })
  );
  // positions the broker closed on its own since the last run (stop or target hit between runs):
  // they were open last time and are gone now, without the bot closing them
  const stillOpen = new Set(s.open.map((l) => l.clientId));
  const gone: LiveClosed[] = before
    .filter((l) => !stillOpen.has(l.clientId))
    .map((l) => ({ clientId: l.clientId, units: l.units, open: l.price, close: null, pl: l.pl, openTime: l.openTime, t: now }));
  for (const c of gone)
    if (!closedHere.has(c.clientId))
      say("clôture", `Stop ou objectif touché chez le courtier : ${sz(Math.abs(c.units))} fermé(s) (environ ${c.pl >= 0 ? "+" : ""}${p2(c.pl)} ${after.currency} au dernier passage).`, true);
  const fromBroker = (await api.closedTrades(50)).map(
    (t): LiveClosed => ({ clientId: t.clientId ?? t.id, units: t.units, open: t.price, close: t.closePrice, pl: t.pl, openTime: t.openTime, t: t.closeTime ?? now })
  );
  s.closed = [...gone, ...fromBroker.filter((c) => !gone.some((g) => g.clientId === c.clientId)), ...s.closed.filter((c) => !gone.some((g) => g.clientId === c.clientId))]
    .filter((c, i, all) => all.findIndex((x) => x.clientId === c.clientId) === i)
    .sort((x, y) => y.t - x.t)
    .slice(0, 50);
  // the deal ids to remember are those still open
  if (api.labels) s.labels = Object.fromEntries(Object.entries(api.labels).filter(([, leg]) => stillOpen.has(leg)));
  s.log = s.log.slice(-MAX_LOG);
  s.updatedAt = now;
  return { state: s, alerts };
}
