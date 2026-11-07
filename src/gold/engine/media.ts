// Gold in the media. The server gathers headlines about gold from the press, scores what each one
// means for the price, and keeps a slow "press mood" with its history. The brain reads the mood
// that was known at each candle (no look-ahead): it nudges confidence by a few percent at most,
// and a burst of fresh headlines pauses new entries, like a scheduled announcement would.
import { Dir, NewsEvent } from "./types";

export interface Headline {
  id: string; // normalised title
  t: number; // publication time
  title: string;
  source: string;
  url: string;
  lang: "en" | "fr";
  score: number; // -1 (bad for gold) .. +1 (good for gold)
  by: "lexique" | "claude";
  major?: boolean; // likely to move the market on its own
}

export interface MediaReading {
  t: number;
  score: number;
  summary: string; // a few sentences in French
  themes: string[];
  model: string;
}

export interface MediaState {
  headlines: Headline[]; // newest first, last 48 h
  history: { t: number; score: number; n: number }[]; // mood at each server run, last 10 days
  reading: MediaReading | null; // latest digest written by Claude, when a key is configured
  updatedAt: number;
}

export const emptyMedia = (): MediaState => ({ headlines: [], history: [], reading: null, updatedAt: 0 });

const HOUR = 3_600_000;

// --- relevance ---------------------------------------------------------------------------------
const GOLD_EN = /\b(gold|xau|bullion)\b/i;
const GOLD_FR = /\b(l['’]or|d['’]or|métal jaune|lingots?)\b/i;
const NOT_THE_METAL = /\b(medal|medallist|olympic|coast|cup|award|globe|card|glove|record label|gold standard of|rush\b(?! for))/i;

export function isAboutGold(title: string, lang: "en" | "fr"): boolean {
  if (NOT_THE_METAL.test(title)) return false;
  return lang === "fr" ? GOLD_FR.test(title) || GOLD_EN.test(title) : GOLD_EN.test(title);
}

// --- lexicon -----------------------------------------------------------------------------------
// Context phrases (dollar, rates, haven demand...) are read first and blanked out, so that
// "dollar falls" or "hausse des taux" are not mistaken for a move of gold itself.
// Then price-move words: they count double.
type Rule = [RegExp, number];
const CONTEXT: Rule[] = [
  [/\b(safe[- ]haven|haven demand|valeurs? refuges?|rate cuts?|cuts? (interest )?rates|dovish|weak(er)? dollar|dollar (slips|falls|weakens|slides|drops|eases)|dollar faible|baisse des taux|inflation (fears?|worries)|geopolitic\w*|tensions?|war|guerre|conflict|central banks? (buy|buying|purchases|demand)|achats? des banques centrales|etf inflows?|recession (fears?|risks?)|uncertainty|incertitudes?)\b/gi, 1],
  [/\b(rate hikes?|hikes? (interest )?rates|hawkish|strong(er)? dollar|dollar (gains|rises|rallies|strengthens|jumps|climbs)|dollar fort|hausse des taux|yields? (rise|rises|climb|climbs|jump|jumps|surge|surges)|profit[- ]taking|prises? de bénéfices|etf outflows?|risk[- ]on|ceasefire|cessez-le-feu)\b/gi, -1],
];
const MOVES: Rule[] = [
  [/\b(surges?|surged|surging|soars?|soared|soaring|rall(y|ies|ied|ying)|jumps?|jumped|climbs?|climbed|climbing|spikes?|spiked|rebounds?|rebounded|gains?|gained|rises?|rising|rose|advances?|advanced|record high|all-time high|fresh high|hits? (a )?record|bullish|edges? (higher|up)|edged (higher|up)|firms?|firmed|lifts?|lifted|grimpe\w*|bondi\w*|s['’]envole\w*|hausse|progresse\w*|nouveau record|rebondi\w*|flambe\w*)\b/gi, 2],
  [/\b(slumps?|slumped|plunges?|plunged|plunging|tumbles?|tumbled|drops?|dropped|falls?|falling|fell|slides?|slid|sliding|declines?|declined|retreats?|retreated|sell-?off|sinks?|sank|slips?|slipped|dips?|dipped|crash(es|ed)?|bearish|loses|lost|losing|edges? (lower|down)|edged (lower|down)|eases?|eased|chute\w*|recule\w*|baisse|repli|plonge\w*|dégringol\w*|décroch\w*|cède|perd\w*)\b/gi, -2],
];

export function lexiconScore(title: string): number {
  let text = title;
  let pos = 0;
  let neg = 0;
  for (const [re, w] of [...CONTEXT, ...MOVES]) {
    text = text.replace(re, (m) => {
      if (w > 0) pos += w;
      else neg -= w;
      return " ".repeat(m.length);
    });
  }
  if (pos + neg === 0) return 0;
  return Math.max(-1, Math.min(1, (pos - neg) / (pos + neg + 1)));
}

// --- mood --------------------------------------------------------------------------------------
// Time-decayed average of the last 24 h (half-life 8 h), shrunk toward 0 when few headlines speak.
export function moodOf(headlines: Headline[], now: number): { score: number; n: number } {
  let sw = 0;
  let s = 0;
  let n = 0;
  for (const h of headlines) {
    const age = now - h.t;
    if (age < 0 || age > 24 * HOUR || h.score === 0) continue;
    const w = Math.pow(0.5, age / (8 * HOUR)) * (h.major ? 2 : 1);
    sw += w;
    s += w * h.score;
    n++;
  }
  return { score: sw ? s / (sw + 2) : 0, n };
}

// Mood known at time t (the latest snapshot not older than 6 h), for live and replayed candles alike
export function moodAt(history: MediaState["history"] | undefined, t: number): number | null {
  if (!history?.length) return null;
  let lo = 0;
  let hi = history.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (history[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0 || t - history[found].t > 6 * HOUR || history[found].n < 3) return null;
  return history[found].score;
}

// Confidence multiplier for a signal in direction d: ±5 % at most
export const mediaMult = (mood: number | null, d: Dir) => (mood === null ? 1 : 1 + 0.05 * d * mood);

// Breaking story: a headline flagged major, or 5+ fresh gold headlines in the last hour
// when the usual pace is under a third of that. New entries wait 45 min after it.
export function mediaShocks(headlines: Headline[], now: number): NewsEvent[] {
  const out: NewsEvent[] = [];
  for (const h of headlines) if (h.major && now - h.t < 2 * HOUR) out.push({ t: h.t, title: `Actualité majeure : ${h.title}`, before: 0, after: 45 });
  const lastHour = headlines.filter((h) => now - h.t >= 0 && now - h.t < HOUR);
  const day = headlines.filter((h) => now - h.t >= 0 && now - h.t < 24 * HOUR).length;
  if (lastHour.length >= 5 && lastHour.length > (3 * day) / 24) {
    const top = lastHour.reduce((a, b) => (Math.abs(b.score) > Math.abs(a.score) ? b : a));
    out.push({ t: top.t, title: `Rafale d'articles sur l'or : ${top.title}`, before: 0, after: 45 });
  }
  return out;
}

export function moodLabel(score: number): string {
  if (score >= 0.35) return "très favorable à l'or";
  if (score >= 0.12) return "plutôt favorable à l'or";
  if (score <= -0.35) return "très défavorable à l'or";
  if (score <= -0.12) return "plutôt défavorable à l'or";
  return "neutre";
}
