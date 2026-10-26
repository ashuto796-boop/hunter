// The seven specialist "traders" of the brain. Each one is written once, for a long setup,
// on a mirrored view of the market: for shorts every price is negated (highs become lows,
// RSI becomes 100 - RSI, ...), so both directions share exactly the same logic.
import { Dir, ModuleId, Regime, Session, Vote } from "./types";
import { Market, knownPivots } from "./features";
import { Pivot } from "./indicators";

export interface Ctx {
  bias: number; // signed for the view direction (+1 = fully with us)
  regime: Regime;
  session: Session;
  killzone: string | null;
}

interface View {
  d: Dir;
  o(j: number): number;
  h(j: number): number;
  l(j: number): number;
  c(j: number): number;
  ema20(j: number): number;
  ema50(j: number): number;
  rsi(j: number): number;
  macd(j: number): number;
  bbUp(j: number): number;
  bbLo(j: number): number;
  bbMid(j: number): number;
  stLine(j: number): number;
  stDir(j: number): number;
  donHi(j: number): number;
  mom(j: number): number;
  vwap(j: number): number;
  asiaHi(j: number): number;
  asiaLo(j: number): number;
  pdh(j: number): number;
  pdl(j: number): number;
  atr(j: number): number;
  adx(j: number): number;
  vol(j: number): number;
  volSma(j: number): number;
  sqz(j: number): boolean;
  asiaDone(j: number): boolean;
  highs: Pivot[];
  lows: Pivot[];
  real(p: number): number; // mirrored price -> real price
}

const views = new WeakMap<Market, [View, View]>();

function makeView(m: Market, d: Dir): View {
  const s = m.ltf;
  const k = s.c;
  const flip = (list: Pivot[]) => list.map((p) => ({ ...p, price: -p.price }));
  const base = {
    d,
    atr: (j: number) => s.atr[j],
    adx: (j: number) => s.adx[j],
    vol: (j: number) => k[j].v,
    volSma: (j: number) => s.volSma[j],
    sqz: (j: number) => s.sqz[j],
    asiaDone: (j: number) => s.asiaDone[j],
    real: (p: number) => d * p,
  };
  if (d === 1) {
    return {
      ...base,
      o: (j) => k[j].o,
      h: (j) => k[j].h,
      l: (j) => k[j].l,
      c: (j) => k[j].c,
      ema20: (j) => s.ema20[j],
      ema50: (j) => s.ema50[j],
      rsi: (j) => s.rsi[j],
      macd: (j) => s.macdHist[j],
      bbUp: (j) => s.bbUp[j],
      bbLo: (j) => s.bbLo[j],
      bbMid: (j) => s.bbMid[j],
      stLine: (j) => s.stLine[j],
      stDir: (j) => s.stDir[j],
      donHi: (j) => s.donHi[j],
      mom: (j) => s.mom[j],
      vwap: (j) => s.vwap[j],
      asiaHi: (j) => s.asiaHi[j],
      asiaLo: (j) => s.asiaLo[j],
      pdh: (j) => s.pdh[j],
      pdl: (j) => s.pdl[j],
      highs: s.highs,
      lows: s.lows,
    };
  }
  return {
    ...base,
    o: (j) => -k[j].o,
    h: (j) => -k[j].l,
    l: (j) => -k[j].h,
    c: (j) => -k[j].c,
    ema20: (j) => -s.ema20[j],
    ema50: (j) => -s.ema50[j],
    rsi: (j) => 100 - s.rsi[j],
    macd: (j) => -s.macdHist[j],
    bbUp: (j) => -s.bbLo[j],
    bbLo: (j) => -s.bbUp[j],
    bbMid: (j) => -s.bbMid[j],
    stLine: (j) => -s.stLine[j],
    stDir: (j) => -s.stDir[j],
    donHi: (j) => -s.donLo[j],
    mom: (j) => -s.mom[j],
    vwap: (j) => -s.vwap[j],
    asiaHi: (j) => -s.asiaLo[j],
    asiaLo: (j) => -s.asiaHi[j],
    pdh: (j) => -s.pdl[j],
    pdl: (j) => -s.pdh[j],
    highs: flip(s.lows),
    lows: flip(s.highs),
  };
}

function getViews(m: Market): [View, View] {
  let v = views.get(m);
  if (!v) {
    v = [makeView(m, 1), makeView(m, -1)];
    views.set(m, v);
  }
  return v;
}

const fmt = (p: number) => p.toFixed(2);
// "au-dessus de" with French elision: du plus haut, d'un sommet
const above = (label: string) =>
  label.startsWith("le ") ? `au-dessus du ${label.slice(3)}` : label.startsWith("un ") ? `au-dessus d'${label}` : `au-dessus de ${label}`;
const pick = (d: Dir, long: string, short: string) => (d === 1 ? long : short);

function minLow(v: View, from: number, to: number): number {
  let x = Infinity;
  for (let j = Math.max(0, from); j <= to; j++) x = Math.min(x, v.l(j));
  return x;
}

function maxHigh(v: View, from: number, to: number): number {
  let x = -Infinity;
  for (let j = Math.max(0, from); j <= to; j++) x = Math.max(x, v.h(j));
  return x;
}

// Quality of a bullish trigger candle at i (0 = none)
function trigger(v: View, i: number): { q: number; name: string } {
  const o = v.o(i);
  const c = v.c(i);
  const h = v.h(i);
  const l = v.l(i);
  const range = h - l;
  if (range <= 0) return { q: 0, name: "" };
  const body = Math.abs(c - o);
  const po = v.o(i - 1);
  const pc = v.c(i - 1);
  const d = v.d;
  if (c > o && pc < po && c >= po && o <= pc) return { q: 1, name: pick(d, "avalement haussier", "avalement baissier") };
  if (c > o && c > v.h(i - 1)) return { q: 0.8, name: pick(d, "clôture au-dessus du plus haut précédent", "clôture sous le plus bas précédent") };
  if (Math.min(o, c) - l >= 2 * body && (c - l) / range >= 0.6) return { q: 0.6, name: pick(d, "mèche de rejet acheteuse (pin bar)", "mèche de rejet vendeuse (pin bar)") };
  return { q: 0, name: "" };
}

// Nearest opposing liquidity at least minR away; otherwise a default multiple of R
function target(v: View, i: number, entry: number, risk: number, minR: number, defR: number): { tp: number; label: string } {
  const cands: { p: number; label: string }[] = [];
  if (v.asiaDone(i) && !Number.isNaN(v.asiaHi(i))) cands.push({ p: v.asiaHi(i), label: pick(v.d, "plus haut asiatique", "plus bas asiatique") });
  if (!Number.isNaN(v.pdh(i))) cands.push({ p: v.pdh(i), label: pick(v.d, "plus haut d'hier", "plus bas d'hier") });
  for (const p of knownPivots(v.highs, i, 6, 160)) cands.push({ p: p.price, label: pick(v.d, "sommet récent", "creux récent") });
  let best: { tp: number; label: string } | null = null;
  for (const x of cands) {
    const dist = x.p - entry;
    if (dist >= minR * risk && dist <= 4 * risk && (!best || x.p < best.tp)) best = { tp: x.p - 0.05 * risk, label: x.label };
  }
  return best ?? { tp: entry + defR * risk, label: `${defR}R` };
}

function nearKeyLevel(v: View, i: number, price: number, tol: number): string | null {
  if (v.asiaDone(i) && Math.abs(price - v.asiaLo(i)) < tol) return pick(v.d, "plus bas asiatique", "plus haut asiatique");
  if (Math.abs(price - v.pdl(i)) < tol) return pick(v.d, "plus bas d'hier", "plus haut d'hier");
  const real = v.real(price);
  const round = Math.round(real / 50) * 50;
  if (Math.abs(real - round) < tol) return `chiffre rond ${round}`;
  return null;
}

type Raw = Omit<Vote, "id" | "dir">;
type ModuleFn = (v: View, i: number, x: Ctx) => Raw | null;

// 1. Liquidity sweep + market structure shift (smart-money reversal)
const sweep: ModuleFn = (v, i, x) => {
  const a = v.atr(i);
  for (let k = 0; k <= 5; k++) {
    const j = i - k;
    if (j < 8) break;
    const levels: { p: number; label: string; w: number }[] = [];
    if (v.asiaDone(j) && !Number.isNaN(v.asiaLo(j))) levels.push({ p: v.asiaLo(j), label: pick(v.d, "le plus bas asiatique", "le plus haut asiatique"), w: 0.12 });
    if (!Number.isNaN(v.pdl(j))) levels.push({ p: v.pdl(j), label: pick(v.d, "le plus bas d'hier", "le plus haut d'hier"), w: 0.12 });
    for (const p of knownPivots(v.lows, j - 1, 3, 100)) levels.push({ p: p.price, label: pick(v.d, "un creux récent", "un sommet récent"), w: 0.05 });
    const swept = levels.filter((L) => v.l(j) < L.p - 0.05 * a && v.l(j) > L.p - 1.5 * a);
    if (!swept.length) continue;
    const L = swept.reduce((b, s) => (s.w > b.w ? s : b));
    if (minLow(v, j + 1, i) <= v.l(j)) continue; // no lower low after the sweep
    let reclaimed = false;
    for (let q = j; q <= i; q++) if (v.c(q) > L.p) reclaimed = true;
    if (!reclaimed || v.c(i) <= L.p) continue;
    const mss = maxHigh(v, j - 5, j - 1);
    if (v.c(i) <= mss) continue;
    let fresh = true;
    for (let q = j; q < i; q++) if (v.c(q) > mss) fresh = false;
    if (!fresh) continue;
    const fvg = v.l(i) > v.h(i - 2) || v.l(i - 1) > v.h(i - 3);
    const entry = v.c(i);
    const sl = v.l(j) - 0.25 * a;
    const tg = target(v, i, entry, entry - sl, 1.8, 2.5);
    const reasons = [
      `Balayage de liquidité ${v.d === 1 ? `sous ${L.label}` : above(L.label)} (${fmt(v.real(L.p))})`,
      `Changement de structure : clôture ${pick(v.d, "au-dessus de", "sous")} ${fmt(v.real(mss))}`,
    ];
    if (x.killzone) reasons.push(`Pendant la ${x.killzone}`);
    if (fvg) reasons.push("Déplacement avec fair value gap (FVG)");
    reasons.push(`Cible : ${tg.label}`);
    return {
      strength: Math.min(1, 0.55 + L.w + (x.killzone ? 0.12 : 0) + (fvg ? 0.08 : 0) + (v.c(i) - v.o(i) > 0.8 * a ? 0.05 : 0)),
      sl: v.real(sl),
      tp: v.real(tg.tp),
      reasons,
    };
  }
  return null;
};

// 2. Trend pullback to the EMA20/50 value zone
const pullback: ModuleFn = (v, i, x) => {
  const a = v.atr(i);
  if (x.bias < 0.15) return null;
  if (!(v.ema20(i) > v.ema50(i) && v.c(i) > v.ema50(i) && v.ema50(i) > v.ema50(i - 5))) return null;
  const low = minLow(v, i - 3, i);
  if (low > v.ema20(i) + 0.25 * a || low < v.ema50(i) - 0.6 * a) return null;
  let rmin = Infinity;
  for (let j = i - 5; j <= i; j++) rmin = Math.min(rmin, v.rsi(j));
  if (!(rmin < 48 && v.rsi(i) > v.rsi(i - 1) && v.rsi(i) < 68)) return null;
  const tr = trigger(v, i);
  if (!tr.q) return null;
  const entry = v.c(i);
  const sl = minLow(v, i - 5, i) - 0.3 * a;
  const tg = target(v, i, entry, entry - sl, 1.8, 2.2);
  return {
    strength: Math.min(1, 0.5 + 0.25 * x.bias + (v.adx(i) > 25 ? 0.1 : 0) + 0.15 * tr.q),
    sl: v.real(sl),
    tp: v.real(tg.tp),
    reasons: [
      `Tendance ${pick(v.d, "haussière", "baissière")} propre (EMA20 ${pick(v.d, ">", "<")} EMA50)`,
      `Repli dans la zone de valeur EMA20/50 (${fmt(v.real(v.ema20(i)))})`,
      `RSI rechargé puis reparti`,
      `Déclencheur : ${tr.name}`,
      `Cible : ${tg.label}`,
    ],
  };
};

// 3. London open: acceptance outside the Asian range
const london: ModuleFn = (v, i, x) => {
  if (x.killzone !== "Killzone Londres" || !v.asiaDone(i)) return null;
  const a = v.atr(i);
  const hi = v.asiaHi(i);
  const lo = v.asiaLo(i);
  const w = hi - lo;
  if (!(w >= 0.6 * a && w <= 5 * a)) return null;
  const c = v.c(i);
  if (!(c > hi + 0.1 * a && c - hi < 1.5 * a)) return null;
  const range = v.h(i) - v.l(i);
  const twoCloses = v.c(i - 1) > hi;
  const strongBody = v.c(i) - v.o(i) >= 0.6 * range && range >= 1.1 * a;
  if (!twoCloses && !strongBody) return null;
  let earlier = 0;
  for (let j = i - 8; j <= i - 2; j++) if (v.c(j) > hi + 0.1 * a) earlier++;
  if (earlier > 1 || x.bias < -0.1) return null;
  const volUp = v.vol(i) > 1.2 * v.volSma(i);
  const sl = Math.min(hi - 0.5 * a, c - 1.0 * a);
  const risk = c - sl;
  return {
    strength: Math.min(1, 0.5 + (volUp ? 0.15 : 0) + 0.15 * Math.max(0, x.bias) + (twoCloses ? 0.1 : 0)),
    sl: v.real(sl),
    tp: v.real(c + 2 * risk),
    reasons: [
      `Ouverture de Londres : acceptation ${pick(v.d, "au-dessus du", "sous le")} range asiatique (${fmt(v.real(hi))})`,
      twoCloses ? "Deux clôtures hors du range" : "Bougie d'impulsion à fort corps",
      ...(volUp ? ["Volume en hausse sur la cassure"] : []),
      "Cible : 2R",
    ],
  };
};

// 4. Volatility squeeze release (Bollinger inside Keltner, then expansion)
const squeeze: ModuleFn = (v, i, x) => {
  let on = 0;
  for (let j = i - 8; j <= i - 1; j++) if (v.sqz(j)) on++;
  if (on < 5) return null;
  const a = v.atr(i);
  const c = v.c(i);
  if (!(c > v.donHi(i) && v.mom(i) > 0 && v.mom(i) > v.mom(i - 1) && v.adx(i) > v.adx(i - 2))) return null;
  if (x.bias < -0.2) return null;
  const sl = Math.max(c - 1.6 * a, minLow(v, i - 3, i) - 0.2 * a);
  const risk = Math.max(c - sl, 0.9 * a);
  const volUp = v.vol(i) > 1.3 * v.volSma(i);
  return {
    strength: Math.min(1, 0.5 + (volUp ? 0.15 : 0) + 0.15 * Math.max(0, x.bias) + (v.c(i) - v.o(i) > 0.7 * a ? 0.1 : 0)),
    sl: v.real(c - risk),
    tp: v.real(c + 2.5 * risk),
    reasons: [
      `Compression de volatilité sur ${on} bougies (Bollinger dans Keltner)`,
      `Explosion ${pick(v.d, "haussière", "baissière")} : cassure du range des 20 dernières bougies`,
      "Momentum en accélération, ADX qui monte",
      ...(volUp ? ["Volume confirme"] : []),
      "Cible : 2.5R",
    ],
  };
};

// 5. Momentum continuation (Supertrend flip or retest, MACD, VWAP)
const momentum: ModuleFn = (v, i, x) => {
  if (v.stDir(i) !== 1 || x.bias < 0.25) return null;
  const a = v.atr(i);
  let flip = false;
  for (let k = 1; k <= 3; k++) if (v.stDir(i - k) === -1) flip = true;
  let age = 0;
  while (age < 40 && v.stDir(i - age) === 1) age++;
  const retest = !flip && age >= 10 && v.l(i) - v.stLine(i) < 0.4 * a && trigger(v, i).q > 0;
  if (!flip && !retest) return null;
  if (!(v.macd(i) > 0 && v.macd(i) >= v.macd(i - 1) && v.adx(i) >= 20 && v.c(i) > v.vwap(i))) return null;
  const c = v.c(i);
  const sl = v.stLine(i) - 0.2 * a;
  const risk = c - sl;
  return {
    strength: Math.min(1, 0.5 + 0.2 * x.bias + (v.adx(i) > 28 ? 0.1 : 0) + (retest ? 0.1 : 0)),
    sl: v.real(sl),
    tp: v.real(c + 2 * risk),
    reasons: [
      flip ? `Supertrend vient de passer ${pick(v.d, "acheteur", "vendeur")}` : "Retest réussi du Supertrend",
      `MACD ${pick(v.d, "positif", "négatif")} et en accélération, ADX ${v.adx(i).toFixed(0)}`,
      `Prix ${pick(v.d, "au-dessus", "en dessous")} du VWAP du jour`,
      "Cible : 2R",
    ],
  };
};

// 6. Mean reversion inside a range (Bollinger excess + rejection)
const reversion: ModuleFn = (v, i, x) => {
  if (v.adx(i) >= 25 || x.bias < -0.6) return null;
  const a = v.atr(i);
  const pierced = v.l(i) < v.bbLo(i) || v.l(i - 1) < v.bbLo(i - 1);
  if (!pierced || v.c(i) <= v.bbLo(i)) return null;
  const rmin = Math.min(v.rsi(i), v.rsi(i - 1), v.rsi(i - 2));
  if (rmin >= 33) return null;
  const tr = trigger(v, i);
  if (!tr.q) return null;
  const c = v.c(i);
  const low = minLow(v, i - 2, i);
  const sl = low - 0.4 * a;
  const tp = v.bbMid(i);
  if (tp - c < 1.0 * (c - sl)) return null;
  const lvl = nearKeyLevel(v, i, low, 0.6 * a);
  return {
    strength: Math.min(1, 0.45 + (rmin < 25 ? 0.2 : 0) + (lvl ? 0.15 : 0) + 0.1 * tr.q),
    sl: v.real(sl),
    tp: v.real(tp),
    reasons: [
      `Excès ${pick(v.d, "baissier", "haussier")} hors de la bande de Bollinger, RSI ${pick(v.d, rmin.toFixed(0), (100 - rmin).toFixed(0))}`,
      `Rejet : ${tr.name}`,
      ...(lvl ? [`Sur un niveau clé : ${lvl}`] : []),
      "Cible : retour à la moyenne (milieu de Bollinger)",
    ],
  };
};

// 7. RSI divergence on a fresh swing at a key level
const divergence: ModuleFn = (v, i, x) => {
  const [p2, p1] = knownPivots(v.lows, i, 2, 45);
  if (!p2 || !p1 || i - p2.at > 3 || p2.i - p1.i < 5) return null;
  const r2 = v.rsi(p2.i);
  const r1 = v.rsi(p1.i);
  if (!(p2.price < p1.price && r2 > r1 + 3 && r2 < 42)) return null;
  if (!(v.c(i) > v.h(p2.i) && v.c(i) > v.o(i))) return null;
  const a = v.atr(i);
  const c = v.c(i);
  const sl = p2.price - 0.3 * a;
  const tg = target(v, i, c, c - sl, 1.8, 2);
  const lvl = nearKeyLevel(v, i, p2.price, 0.5 * a);
  return {
    strength: Math.min(1, 0.45 + (lvl ? 0.15 : 0) + (x.bias > 0 ? 0.1 : 0) + (r2 - r1 > 6 ? 0.1 : 0)),
    sl: v.real(sl),
    tp: v.real(tg.tp),
    reasons: [
      `Divergence ${pick(v.d, "haussière", "baissière")} RSI : le prix fait un nouvel extrême, pas le RSI`,
      ...(lvl ? [`Sur un niveau clé : ${lvl}`] : []),
      `Confirmation par clôture ${pick(v.d, "au-dessus", "en dessous")} de la bougie pivot`,
      `Cible : ${tg.label}`,
    ],
  };
};

export const MODULES: Record<ModuleId, ModuleFn> = { sweep, pullback, london, squeeze, momentum, reversion, divergence };

export const MODULE_INFO: Record<ModuleId, { name: string; style: string; base: number }> = {
  sweep: { name: "Chasseur de liquidité", style: "Smart money · balayage + cassure de structure", base: 1.15 },
  pullback: { name: "Sniper tendance", style: "Repli sur EMA dans le sens de la tendance", base: 1.1 },
  london: { name: "Ouverture de Londres", style: "Sortie acceptée du range asiatique", base: 1.0 },
  squeeze: { name: "Compression → explosion", style: "Squeeze Bollinger/Keltner", base: 0.95 },
  momentum: { name: "Momentum rider", style: "Supertrend + MACD + VWAP", base: 0.9 },
  reversion: { name: "Élastique", style: "Retour à la moyenne en range", base: 0.85 },
  divergence: { name: "Divergence", style: "Divergence RSI sur niveau clé", base: 0.8 },
};

export const MODULE_IDS = Object.keys(MODULES) as ModuleId[];

export function runModules(m: Market, i: number, ctxFor: (d: Dir) => Ctx): Vote[] {
  const [vl, vs] = getViews(m);
  const out: Vote[] = [];
  for (const v of [vl, vs]) {
    const x = ctxFor(v.d);
    for (const id of MODULE_IDS) {
      const r = MODULES[id](v, i, x);
      if (r) out.push({ id, dir: v.d, ...r });
    }
  }
  return out;
}
