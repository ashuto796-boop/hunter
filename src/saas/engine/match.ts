import { DOMAINS, MARKET_LABEL, labelOf } from "../data/questions";
import { Goal, Idea, Match, Profile } from "../types";

// Points per criterion. Domain knowledge weighs most: it is what makes the first sales possible.
const W = { domain: 40, market: 15, feasibility: 20, goal: 10, speed: 8, budget: 4, audience: 8 };
const MAX = Object.values(W).reduce((a, b) => a + b, 0);
const PROBLEM_MAX = 30;

const TECH_LEVEL = { none: 0, nocode: 1, some: 2, dev: 3 } as const;
const HOURS_LEVEL = { lt5: 0, "5to10": 1, "10to20": 2, full: 3 } as const;

export const GOAL_MRR: Record<Goal, number> = { side: 1000, salary: 3000, startup: 10000, learn: 300 };

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ");
}

function problemHits(profile: Profile, idea: Idea): number {
  const text = normalize(profile.problem);
  if (!text.trim()) return 0;
  const words = new Set(text.split(/\s+/).filter((w) => w.length > 2));
  let hits = 0;
  for (const tag of idea.tags) {
    const t = normalize(tag).trim();
    if (!t) continue;
    // Multi-word tags match as a phrase; single words also match their plural or a longer form
    if (t.includes(" ") ? text.includes(t) : [...words].some((w) => w === t || (t.length > 4 && w.startsWith(t)))) hits++;
  }
  return hits;
}

export function scoreIdea(profile: Profile, idea: Idea, batch = 0): Match {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let pts = 0;

  // Domain knowledge
  const overlap = idea.domains.filter((d) => profile.domains.includes(d));
  if (profile.domains.length === 0) pts += W.domain * 0.4;
  else if (profile.domains.includes(idea.domains[0])) {
    pts += W.domain;
    reasons.push(`Tu connais le terrain : ${labelOf(DOMAINS, idea.domains[0]).toLowerCase()}.`);
  } else if (overlap.length) {
    pts += W.domain * 0.7;
    reasons.push(`Ton expérience en ${labelOf(DOMAINS, overlap[0]).toLowerCase()} est un vrai atout ici.`);
  }

  // Who pays
  if (profile.market === "any") pts += W.market * 0.7;
  else if (profile.market === idea.market) {
    pts += W.market;
    reasons.push(`Tu vends à la cible que tu préfères : ${MARKET_LABEL[idea.market].toLowerCase()}.`);
  } else if (profile.market !== "b2c" && idea.market !== "b2c") pts += W.market * 0.5;

  // Can it be built with this level and this time? Claude writes the code, so the bar is the
  // ability to follow along, not to code.
  const capacity = TECH_LEVEL[profile.tech] * 0.6 + HOURS_LEVEL[profile.hours] * 0.4;
  const gap = Math.max(0, idea.complexity - 1 - capacity);
  const fit = Math.max(0, 1 - gap / 2);
  pts += W.feasibility * fit;
  if (fit >= 0.99 && idea.complexity <= 2) reasons.push("Un MVP réaliste avec ton temps et ton niveau.");
  if (fit < 0.6) warnings.push("Produit plus technique : prévois plus de temps pour le MVP, Claude t'accompagnera étape par étape.");

  // Goal
  let g = 0;
  if (profile.goal === "side") g = idea.salesCycle === 1 ? 1 : idea.salesCycle === 2 ? 0.6 : 0.2;
  else if (profile.goal === "salary") g = idea.market === "b2c" ? 0.3 : idea.price >= 25 ? 1 : 0.6;
  else if (profile.goal === "startup") g = (idea.market === "b2b" ? 0.6 : 0.3) + (idea.complexity === 3 ? 0.4 : idea.complexity === 2 ? 0.2 : 0);
  else g = idea.complexity <= 2 ? 0.8 : 0.5;
  pts += W.goal * g;

  // Time to first euro
  let s = 1;
  if (profile.speed === "fast") s = (idea.salesCycle === 1 ? 1 : idea.salesCycle === 2 ? 0.5 : 0) - (idea.complexity === 3 ? 0.3 : 0);
  else if (profile.speed === "medium") s = idea.salesCycle <= 2 ? 1 : 0.5;
  pts += W.speed * Math.max(0, s);
  if (profile.speed === "fast" && idea.salesCycle === 1) reasons.push("Se vend vite : la personne qui a le problème décide seule.");
  if (profile.speed === "fast" && idea.salesCycle === 3) warnings.push("Cycle de vente long : le premier euro prendra sans doute plus d'un mois.");

  // Budget: consumer products usually need paid acquisition sooner
  const lowBudget = profile.budget === "zero" || profile.budget === "small";
  pts += W.budget * (lowBudget && idea.market === "b2c" ? 0.25 : 1);
  if (lowBudget && idea.market === "b2c") warnings.push("Grand public sans budget pub : mise tout sur le contenu et les communautés.");

  // Existing audience
  let a = 0.4;
  if (profile.audience === "linkedin" && idea.market !== "b2c") {
    a = 1;
    reasons.push("Ton réseau professionnel peut t'apporter les premiers clients.");
  } else if (profile.audience === "community" && (idea.market === "b2c" || idea.domains.includes("content"))) {
    a = 1;
    reasons.push("Ta communauté est un canal de lancement tout trouvé.");
  } else if (profile.audience === "clients" && overlap.length) {
    a = 1;
    reasons.push("Tu connais déjà des clients potentiels dans ce secteur.");
  } else if (profile.audience !== "none") a = 0.3;
  pts += W.audience * a;

  const hits = problemHits(profile, idea);
  if (hits) {
    pts += Math.min(PROBLEM_MAX, hits * 12);
    reasons.unshift("Ça rejoint le problème que tu as décrit.");
  }

  if (idea.caution) warnings.push(idea.caution);

  const max = MAX + (profile.problem.trim() ? PROBLEM_MAX : 0);
  const score = Math.min(99, Math.round((100 * pts) / max));
  return { idea, score, reasons: reasons.slice(0, 3), warnings, batch };
}

// Picks the best ideas while avoiding three variations on the same theme
export function pickTop(profile: Profile, ideas: Idea[], count: number, exclude: Set<string>, batch: number): Match[] {
  const pool = ideas.filter((i) => !exclude.has(i.id)).map((i) => scoreIdea(profile, i, batch));
  const picked: Match[] = [];
  while (picked.length < count && pool.length) {
    let best = 0;
    let bestVal = -Infinity;
    pool.forEach((m, i) => {
      const sameDomain = picked.some((p) => p.idea.domains[0] === m.idea.domains[0]);
      const sameMarket = picked.filter((p) => p.idea.market === m.idea.market).length;
      const val = m.score - (sameDomain ? 8 : 0) - sameMarket * 2;
      if (val > bestVal) {
        bestVal = val;
        best = i;
      }
    });
    picked.push(pool.splice(best, 1)[0]);
  }
  return picked;
}

export function revenueTarget(profile: Profile, idea: Idea) {
  const mrr = GOAL_MRR[profile.goal];
  const clients = Math.ceil(mrr / idea.price);
  return { mrr, clients };
}
