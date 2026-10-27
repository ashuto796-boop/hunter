// Optional "Claude mode": ideas invented for the profile instead of picked from the catalogue.
// Loaded lazily so the SDK only ships to people who turn it on. The key is the user's own and
// goes straight from the browser to api.anthropic.com.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AUDIENCES, BUDGETS, DOMAINS, GOALS, HOURS, MARKETS, SPEEDS, TECH, labelOf } from "../data/questions";
import { Domain, DOMAIN_IDS, Idea, Market, Profile } from "../types";
import { CLAUDE_MODEL } from "./model";

const IdeaSchema = z.object({
  name: z.string(),
  pitch: z.string(),
  problem: z.string(),
  solution: z.string(),
  target: z.string(),
  // Plain strings, normalised below: the SDK turns enums into hints, so a stray value must not
  // make the whole response fail validation
  market: z.string(),
  domains: z.array(z.string()),
  whyNow: z.string(),
  features: z.array(z.string()),
  price: z.number(),
  priceUnit: z.string(),
  recurring: z.boolean(),
  complexity: z.number().int(),
  salesCycle: z.number().int(),
  channels: z.array(z.string()),
  alternatives: z.string(),
  caution: z.string(),
  tags: z.array(z.string()),
  fitReasons: z.array(z.string()),
});

const OutputSchema = z.object({ ideas: z.array(IdeaSchema) });

export interface ClaudeIdea extends Idea {
  fitReasons: string[];
}

const SYSTEM = `Tu es un expert de la création de micro-SaaS rentables pour le marché francophone. À partir du profil d'une personne qui veut se lancer, tu proposes exactement 3 idées de SaaS faites pour elle.

Exigences :
- Des idées concrètes, sur une niche précise, pour une cible qui perd déjà du temps ou de l'argent à cause du problème et qui peut payer.
- Adaptées à son temps disponible, son niveau technique, son budget, son objectif, son réseau et ses domaines d'expérience. Si elle décrit un problème, au moins une idée doit y répondre.
- Trois idées réellement différentes (pas trois variantes d'un même produit).
- "whyNow" s'appuie sur une tendance réelle et vérifiable (réglementation, technologie, usage). N'invente ni chiffre, ni loi, ni date : en cas de doute, reste qualitatif.
- Ne cite pas de concurrent dont tu n'es pas certain qu'il existe ; "alternatives" décrit ce que la cible utilise aujourd'hui.
- "name" : un nom de produit court et prononçable en français.
- "pitch" : une phrase de promesse. "problem" et "solution" : 1 à 2 phrases chacun.
- "features" : 4 à 6 fonctionnalités du MVP, sans l'authentification ni le paiement.
- "price" : un prix réaliste en euros HT ; "priceUnit" commence par "/mois" pour un abonnement (ex. "/mois par cabinet") ou décrit l'unité d'un paiement unique (ex. "par logement") ; "recurring" indique lequel.
- "market" : "b2b" (entreprises), "freelance" (indépendants) ou "b2c" (particuliers).
- "complexity" : 1 (application simple), 2 (quelques intégrations) ou 3 (IA, temps réel, intégrations lourdes). "salesCycle" : 1 (l'acheteur décide seul en un appel), 2 (quelques semaines) ou 3 (plusieurs décideurs).
- "channels" : 3 ou 4 canaux concrets pour trouver les 10 premiers clients.
- "domains" : 1 à 3 identifiants parmi la liste fournie, le plus pertinent en premier.
- "caution" : le principal point réglementaire ou risque, ou une chaîne vide.
- "tags" : 5 à 8 mots-clés en minuscules, sans accents.
- "fitReasons" : 2 ou 3 raisons courtes, au tutoiement, pour lesquelles cette idée lui correspond.
Tout est rédigé en français, au tutoiement.`;

function describe(profile: Profile, exclude: string[]): string {
  const domains = profile.domains.map((d) => labelOf(DOMAINS, d)).join(", ") || "aucun en particulier";
  const lines = [
    "Profil :",
    `- Prénom : ${profile.firstName || "non renseigné"}`,
    `- Temps disponible par semaine : ${labelOf(HOURS, profile.hours)}`,
    `- Niveau technique : ${labelOf(TECH, profile.tech)}`,
    `- Domaines d'expérience : ${domains}`,
    `- Préfère vendre : ${labelOf(MARKETS, profile.market).toLowerCase()}`,
    `- Objectif : ${labelOf(GOALS, profile.goal)}`,
    `- Premier euro souhaité : ${labelOf(SPEEDS, profile.speed)}`,
    `- Budget de départ : ${labelOf(BUDGETS, profile.budget)}`,
    `- Audience ou réseau : ${labelOf(AUDIENCES, profile.audience)}`,
    `- Problème vécu : ${profile.problem.trim() || "non renseigné"}`,
    "",
    `Identifiants de domaines possibles : ${DOMAINS.map((d) => `${d.value} (${d.label})`).join(", ")}.`,
  ];
  if (exclude.length) lines.push("", `Déjà proposées, à ne pas reprendre : ${exclude.join(", ")}.`);
  return lines.join("\n");
}

const clamp3 = (n: number) => Math.min(3, Math.max(1, Math.round(n))) as 1 | 2 | 3;
const MARKET_IDS: Market[] = ["b2b", "b2c", "freelance"];
const toMarket = (m: string): Market => MARKET_IDS.find((x) => x === m.trim().toLowerCase()) ?? "b2b";
const toDomains = (ds: string[]): Domain[] => {
  const ok = ds.map((d) => d.trim().toLowerCase()).filter((d): d is Domain => (DOMAIN_IDS as readonly string[]).includes(d));
  return ok.length ? [...new Set(ok)].slice(0, 3) : ["tech"];
};

export async function generateIdeas(apiKey: string, profile: Profile, exclude: string[]): Promise<ClaudeIdea[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let res;
  try {
    res = await client.beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(OutputSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: describe(profile, exclude) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Clé API refusée : vérifie-la dans les réglages.");
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error("Cette clé API n'a pas accès au modèle.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Trop de requêtes ou crédit épuisé sur ton compte Anthropic. Réessaie plus tard.");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("Impossible de joindre l'API Claude. Vérifie ta connexion.");
    if (e instanceof Anthropic.APIError) throw new Error(`Erreur de l'API Claude (${e.status ?? "?"}).`);
    throw e;
  }
  if (res.stop_reason === "refusal") throw new Error("Claude a refusé cette demande. Reformule le problème décrit et réessaie.");
  if (res.stop_reason === "max_tokens") throw new Error("La réponse de Claude a été coupée. Réessaie.");
  const out = res.parsed_output;
  if (!out || out.ideas.length === 0) throw new Error("Réponse de Claude illisible. Réessaie.");

  const stamp = Date.now().toString(36);
  return out.ideas.slice(0, 3).map((i, n) => ({
    ...i,
    id: `ai-${stamp}-${n}`,
    market: toMarket(i.market),
    domains: toDomains(i.domains),
    features: i.features.slice(0, 6),
    channels: i.channels.slice(0, 4),
    price: Math.max(1, i.price),
    complexity: clamp3(i.complexity),
    salesCycle: clamp3(i.salesCycle),
    caution: i.caution.trim() || undefined,
    source: "claude" as const,
  }));
}
