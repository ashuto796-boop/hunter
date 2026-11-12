import type { AgentId } from "./types";

export interface AgentProfile {
  id: AgentId;
  name: string; // first name, so the team reads like a team
  role: string;
  mission: string;
  tools: ("Claude" | "Web" | "Shopify lecture" | "Shopify brouillons" | "Calcul" | "CJ Dropshipping" | "Meta / TikTok lecture")[];
  everyHours: number; // default cadence, overridable in server/ecom/config.json
  color: string;
}

// The order is the order they run in: each one reads the reports of those before it.
export const ROSTER: AgentProfile[] = [
  {
    id: "finance",
    name: "Camille",
    role: "Directrice financière",
    mission: "Calcule chaque jour le chiffre d'affaires, la marge, les frais, les charges et le bénéfice net réel à partir des commandes Shopify. Fixe le ROAS minimum pour ne pas perdre d'argent et dit combien de ventes par jour il faut pour 10 000 € net.",
    tools: ["Shopify lecture", "Calcul", "Claude"],
    everyHours: 7,
    color: "#128a5a",
  },
  {
    id: "service",
    name: "Inès",
    role: "Service client & logistique",
    mission: "Surveille les commandes payées non expédiées, les remboursements et les délais. Prépare les réponses types (retard, suivi, retour, remboursement) et signale ce qu'il faut traiter aujourd'hui.",
    tools: ["Shopify lecture", "Claude"],
    everyHours: 7,
    color: "#0e7490",
  },
  {
    id: "legal",
    name: "Hugo",
    role: "Juriste & conformité",
    mission: "Vérifie que la boutique est en règle pour vendre en France et dans l'UE : mentions légales, CGV, rétractation de 14 jours, confidentialité, sécurité des produits (GPSR), allégations interdites dans les fiches.",
    tools: ["Shopify lecture", "Claude"],
    everyHours: 160,
    color: "#6d28d9",
  },
  {
    id: "hunter",
    name: "Yanis",
    role: "Chasseur de produits",
    mission: "Cherche sur le web les produits qui montent en France : qui résolvent un vrai problème, s'expliquent en 3 secondes en vidéo, se vendent 3 fois leur coût et ne sont pas déjà partout. Note chaque idée sur 100.",
    tools: ["Web", "Claude"],
    everyHours: 70,
    color: "#ff5a1f",
  },
  {
    id: "sourcing",
    name: "Léa",
    role: "Acheteuse & fournisseurs",
    mission: "Interroge le catalogue CJ Dropshipping (prix, stock en Europe, port vers la France) et le web pour trouver les meilleurs fournisseurs, puis calcule la marge réelle de chaque produit.",
    tools: ["CJ Dropshipping", "Web", "Claude", "Calcul"],
    everyHours: 70,
    color: "#b45309",
  },
  {
    id: "merch",
    name: "Maxime",
    role: "Responsable boutique & fiches produits",
    mission: "Écrit les fiches produits qui convertissent (titre, bénéfices, FAQ, SEO) et les crée dans Shopify en brouillon, jamais publiées sans toi. Audite les fiches et la boutique existantes.",
    tools: ["Shopify brouillons", "Claude"],
    everyHours: 44,
    color: "#2563eb",
  },
  {
    id: "ads",
    name: "Sofia",
    role: "Media buyer (publicité)",
    mission: "Lit les vrais résultats de tes pubs TikTok et Meta, dit pour chacune s'il faut la couper, l'augmenter ou attendre (selon le ROAS minimum de Camille), et prépare les nouvelles accroches. Elle propose, tu dépenses.",
    tools: ["Meta / TikTok lecture", "Claude", "Calcul"],
    everyHours: 7,
    color: "#db2777",
  },
  {
    id: "content",
    name: "Nathan",
    role: "Créateur de contenu",
    mission: "Écrit le planning de 7 vidéos TikTok / Reels de la semaine (accroche, script plan par plan, légende, hashtags), en vidéos sans visage faciles à tourner au téléphone.",
    tools: ["Web", "Claude"],
    everyHours: 160,
    color: "#7c3aed",
  },
  {
    id: "retention",
    name: "Clara",
    role: "E-mail, SEO & fidélisation",
    mission: "Écrit les e-mails automatiques (bienvenue, panier abandonné, après achat, avis client), les textes SEO et les offres pour faire racheter les clients.",
    tools: ["Claude"],
    everyHours: 160,
    color: "#0891b2",
  },
  {
    id: "ceo",
    name: "Adam",
    role: "Directeur général",
    mission: "Lit les rapports des 9 autres, tranche, fixe les 3 priorités du jour et te dit exactement quoi faire toi-même. Suit la route vers 10 000 € net par mois sans enjoliver.",
    tools: ["Claude"],
    everyHours: 20,
    color: "#17161b",
  },
];

export const PROFILE: Record<AgentId, AgentProfile> = Object.fromEntries(ROSTER.map((a) => [a.id, a])) as Record<AgentId, AgentProfile>;
