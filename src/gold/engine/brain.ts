// The meta-brain: reads the regime and the higher-timeframe bias, weighs the seven specialists
// by how well they fit the current market and by what they have learned from their own results,
// then applies the professional risk guards before producing a decision.
import { BrainMemory, Decision, Dir, ModuleId, ModuleStats, Mode, NewsEvent, Plan, Regime, Settings, TraderState, WeightedVote } from "./types";
import { Market, knownPivots } from "./features";
import { pctRank } from "./indicators";
import { MODULE_IDS, MODULE_INFO, runModules } from "./modules";
import { SESSION_LABEL, SESSION_QUALITY, killzone, newsBlock, sessionAt, weekendRisk } from "./context";

export const THRESHOLDS: Record<Mode, number> = { prudent: 70, equilibre: 61, agressif: 53 };

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function emptyBrain(): BrainMemory {
  const b = {} as BrainMemory;
  for (const id of MODULE_IDS) b[id] = { n: 0, wins: 0, sumR: 0 };
  return b;
}

// Bayesian-shrunk expectancy -> weight multiplier. Few trades = stays close to the expert prior.
export function learnedMult(s: ModuleStats): number {
  const PRIOR_N = 10;
  const PRIOR_R = 0.15;
  const exp = (s.sumR + PRIOR_N * PRIOR_R) / (s.n + PRIOR_N);
  return clamp(1 + (exp - PRIOR_R), 0.35, 1.6);
}

export function computeBias(m: Market, i: number): number {
  let b = 0;
  const j4 = m.m4[i];
  if (j4 >= 0 && !Number.isNaN(m.h4.ema50[j4])) {
    const s = m.h4;
    b += s.close[j4] > s.ema50[j4] ? 0.2 : -0.2;
    b += s.ema20[j4] > s.ema50[j4] ? 0.15 : -0.15;
    b += 0.1 * s.stDir[j4];
  }
  const j1 = m.m1[i];
  if (j1 >= 0 && !Number.isNaN(m.h1.ema50[j1])) {
    const s = m.h1;
    b += s.close[j1] > s.ema50[j1] ? 0.15 : -0.15;
    b += s.ema20[j1] > s.ema50[j1] ? 0.1 : -0.1;
    b += 0.1 * s.stDir[j1];
    if (!Number.isNaN(s.ema200[j1])) b += s.close[j1] > s.ema200[j1] ? 0.1 : -0.1;
    const hs = knownPivots(s.highs, j1, 2, 150);
    const ls = knownPivots(s.lows, j1, 2, 150);
    if (hs.length === 2 && ls.length === 2) {
      if (hs[0].price > hs[1].price && ls[0].price > ls[1].price) b += 0.1;
      else if (hs[0].price < hs[1].price && ls[0].price < ls[1].price) b -= 0.1;
    }
  }
  return clamp(b, -1, 1);
}

export function computeRegime(m: Market, i: number): Regime {
  const s = m.ltf;
  const a = s.atr[i];
  const k = s.c[i];
  if (pctRank(s.atr, i, 300) > 0.97 || k.h - k.l > 3 * a) return "VOLATILE";
  if (pctRank(s.bbW, i, 200) < 0.15 && s.adx[i] < 22) return "SQUEEZE";
  if (s.adx[i] > 23 && s.er[i] > 0.28) {
    if (s.pdi[i] > s.mdi[i] && s.ema20[i] > s.ema50[i]) return "TREND_UP";
    if (s.mdi[i] > s.pdi[i] && s.ema20[i] < s.ema50[i]) return "TREND_DOWN";
  }
  return "RANGE";
}

export const REGIME_LABEL: Record<Regime, string> = {
  TREND_UP: "Tendance haussière",
  TREND_DOWN: "Tendance baissière",
  RANGE: "Range",
  SQUEEZE: "Compression",
  VOLATILE: "Volatilité extrême",
};

type RegimeKey = "TREND" | "RANGE" | "SQUEEZE" | "VOLATILE";
const FIT: Record<ModuleId, Record<RegimeKey, number>> = {
  sweep: { TREND: 0.85, RANGE: 1, SQUEEZE: 0.7, VOLATILE: 0.5 },
  pullback: { TREND: 1, RANGE: 0.45, SQUEEZE: 0.5, VOLATILE: 0.3 },
  london: { TREND: 0.9, RANGE: 0.75, SQUEEZE: 1, VOLATILE: 0.4 },
  squeeze: { TREND: 0.7, RANGE: 0.65, SQUEEZE: 1, VOLATILE: 0.3 },
  momentum: { TREND: 1, RANGE: 0.35, SQUEEZE: 0.7, VOLATILE: 0.4 },
  reversion: { TREND: 0.25, RANGE: 1, SQUEEZE: 0.4, VOLATILE: 0.2 },
  divergence: { TREND: 0.45, RANGE: 0.9, SQUEEZE: 0.6, VOLATILE: 0.4 },
};
const REVERSAL: ModuleId[] = ["sweep", "reversion", "divergence"];

function regimeFit(id: ModuleId, regime: Regime, dir: Dir): number {
  const key: RegimeKey = regime === "TREND_UP" || regime === "TREND_DOWN" ? "TREND" : regime;
  let f = FIT[id][key];
  const trendDir = regime === "TREND_UP" ? 1 : regime === "TREND_DOWN" ? -1 : 0;
  if (trendDir && trendDir !== dir) f *= REVERSAL.includes(id) ? 0.75 : 0.5;
  return f;
}

// Noisy-OR: independent confirmations add up but never exceed 1
function combine(ws: number[]): number {
  let p = 1;
  for (const w of ws) p *= 1 - Math.min(0.9, w);
  return 1 - p;
}

function nearestOpposing(m: Market, i: number, dir: Dir, entry: number): number | null {
  const s = m.ltf;
  const levels: number[] = [];
  if (dir === 1) {
    if (s.asiaDone[i]) levels.push(s.asiaHi[i]);
    levels.push(s.pdh[i]);
    for (const p of knownPivots(s.highs, i, 4, 120)) levels.push(p.price);
  } else {
    if (s.asiaDone[i]) levels.push(s.asiaLo[i]);
    levels.push(s.pdl[i]);
    for (const p of knownPivots(s.lows, i, 4, 120)) levels.push(p.price);
  }
  let best: number | null = null;
  for (const l of levels) {
    if (Number.isNaN(l)) continue;
    const dist = dir * (l - entry);
    if (dist > 0 && (best === null || dist < best)) best = dist;
  }
  return best;
}

export interface AnalyseEnv {
  m: Market;
  settings: Settings;
  news: NewsEvent[];
}

export function analyse(env: AnalyseEnv, st: TraderState, i: number): Decision {
  const { m, settings } = env;
  const s = m.ltf;
  const tfMs = s.tf * 60000;
  const t = s.c[i].t + tfMs; // decision time = candle close
  const price = s.close[i];
  const a = s.atr[i];
  const regime = computeRegime(m, i);
  const bias = computeBias(m, i);
  const session = sessionAt(t);
  const kz = killzone(t);
  const threshold = THRESHOLDS[settings.mode];

  const votes = runModules(m, i, (d) => ({ bias: d * bias, regime, session, killzone: kz }));
  const weighted: WeightedVote[] = votes.map((v) => {
    const fit = regimeFit(v.id, regime, v.dir);
    const learned = learnedMult(st.brain[v.id]);
    return { ...v, fit, learned, weight: 0.85 * v.strength * MODULE_INFO[v.id].base * fit * learned };
  });

  const sideScore = (d: Dir) => {
    const mine = weighted.filter((v) => v.dir === d).map((v) => v.weight);
    const opp = weighted.filter((v) => v.dir !== d).map((v) => v.weight);
    if (!mine.length) return 0;
    const raw = combine(mine) * (1 - 0.7 * combine(opp));
    const b = d * bias;
    const trend = regime === "TREND_UP" || regime === "TREND_DOWN";
    const htf = trend || regime === "SQUEEZE" ? 0.85 + 0.25 * b : 0.95 + 0.1 * b;
    const sess = SESSION_QUALITY[session];
    const atrP = pctRank(s.atr, i, 300);
    const vol = atrP < 0.05 ? 0.85 : regime === "VOLATILE" ? 0.75 : 1;
    return clamp(Math.round(100 * raw * htf * sess * vol), 0, 99);
  };
  const scoreLong = sideScore(1);
  const scoreShort = sideScore(-1);
  const dir: Dir | 0 = scoreLong === 0 && scoreShort === 0 ? 0 : scoreLong >= scoreShort ? 1 : -1;
  let score = Math.max(scoreLong, scoreShort);

  const pros: string[] = [];
  const cons: string[] = [];
  const mine = dir ? weighted.filter((v) => v.dir === dir).sort((x, y) => y.weight - x.weight) : [];
  for (const v of mine) for (const r of v.reasons.slice(0, 3)) pros.push(r);
  if (dir) {
    const b = dir * bias;
    if (b >= 0.4) pros.push(`Unités supérieures (H1/H4) alignées (${(b * 100).toFixed(0)}%)`);
    else if (b <= -0.3) cons.push(`Contre la tendance de fond H1/H4 (${(b * 100).toFixed(0)}%)`);
    for (const v of weighted.filter((w) => w.dir !== dir)) cons.push(`Signal contraire : ${MODULE_INFO[v.id].name}`);
  }
  if (SESSION_QUALITY[session] >= 0.97) pros.push(`${SESSION_LABEL[session]} : liquidité maximale`);
  else if (session === "ASIE") cons.push("Session asiatique : liquidité faible");
  if (regime === "VOLATILE") cons.push("Volatilité extrême : risque de mèches");

  // Hard guards (a professional never breaks these)
  let blocked: string | null = null;
  const tfBars = (min: number) => Math.round(min / s.tf);
  if (session === "FERME") blocked = "Marché de l'or fermé";
  else if (session === "ROLLOVER") blocked = "Rollover quotidien — spreads élargis";
  else if (weekendRisk(t)) blocked = "Vendredi soir : pas de nouvelle position avant le week-end";
  else blocked = newsBlock(t, env.news);
  if (!blocked && s.c[i].h - s.c[i].l > 3 * a) blocked = "Choc de volatilité (bougie > 3 ATR) — j'attends que ça se calme";
  if (!blocked && st.position) blocked = "Position en cours — je la gère";
  if (!blocked && st.day.trades >= settings.maxTradesDay) blocked = `Quota du jour atteint (${settings.maxTradesDay} trades)`;
  if (!blocked && st.day.pnl <= (-settings.maxDailyLossPct / 100) * st.day.startBalance) blocked = "Limite de perte journalière atteinte — reprise demain";
  if (!blocked && st.cooldownUntil > t) blocked = "Pause après 2 pertes d'affilée — je me remets à zéro";
  if (!blocked && dir && st.lastLoss && st.lastLoss.dir === dir && t - st.lastLoss.t < tfBars(45) * tfMs) blocked = "Pas de revenge trading dans le même sens";

  let plan: Plan | null = null;
  let verdict = "";
  if (!blocked && dir && score >= threshold && mine.length) {
    const primary = mine[0];
    let sl = primary.sl;
    let slDist = dir * (price - sl);
    if (slDist < 0.8 * a) {
      slDist = 0.8 * a;
      sl = price - dir * slDist;
    }
    if (slDist > 3 * a) {
      cons.push("Stop structurel trop large (> 3 ATR)");
      score = Math.min(score, threshold - 1);
    } else {
      let tp2 = primary.tp;
      let rr = (dir * (tp2 - price)) / slDist;
      if (rr < 1.5) {
        tp2 = price + dir * 2 * slDist;
        rr = 2;
      } else if (rr > 4) {
        tp2 = price + dir * 4 * slDist;
        rr = 4;
      }
      const room = nearestOpposing(m, i, dir, price);
      if (room !== null && room < 0.9 * slDist) {
        cons.push(`Obstacle à ${room.toFixed(2)} $ seulement`);
        score = Math.round(score * 0.85);
      }
      if (score >= threshold) {
        plan = {
          dir,
          entry: price,
          sl,
          tp1: price + dir * slDist,
          tp2,
          rr,
          primary: primary.id,
          contributors: mine.map((v) => v.id),
          score,
          riskMult: score >= 85 ? 1.25 : score >= threshold + 8 ? 1 : 0.75,
          reasons: pros.slice(0, 7),
        };
      }
    }
  }

  const side = dir === 1 ? "ACHAT" : "VENTE";
  if (blocked) verdict = blocked;
  else if (plan) verdict = `J'entre à l'${side === "ACHAT" ? "achat" : "vente"} — confiance ${score}/100`;
  else if (dir && score >= threshold - 12) verdict = `${side} en préparation (${score}/${threshold}) — j'attends plus de confluence`;
  else if (dir) verdict = `Signal ${side.toLowerCase()} trop faible (${score}/${threshold}) — patience`;
  else verdict = "Aucun setup propre — je ne force rien";

  return {
    t,
    price,
    score,
    scoreLong,
    scoreShort,
    dir,
    threshold,
    regime,
    bias,
    session,
    killzone: kz,
    votes: weighted,
    pros: pros.slice(0, 7),
    cons: cons.slice(0, 5),
    verdict,
    blocked,
    plan,
  };
}
