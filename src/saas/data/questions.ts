import { Audience, Budget, Domain, Goal, Hours, Market, MarketPref, Profile, Speed, Tech } from "../types";

export interface Option<V extends string> {
  value: V;
  label: string;
  hint?: string;
}

export const DOMAINS: Option<Domain>[] = [
  { value: "marketing", label: "Marketing & réseaux sociaux" },
  { value: "sales", label: "Vente & prospection" },
  { value: "design", label: "Design & création" },
  { value: "tech", label: "Tech & développement" },
  { value: "finance", label: "Finance & comptabilité" },
  { value: "hr", label: "RH & recrutement" },
  { value: "realestate", label: "Immobilier" },
  { value: "health", label: "Santé & bien-être" },
  { value: "education", label: "Éducation & formation" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "food", label: "Restauration" },
  { value: "legal", label: "Juridique & administratif" },
  { value: "content", label: "Création de contenu" },
  { value: "trades", label: "Artisans & commerces de proximité" },
  { value: "sport", label: "Sport & coaching" },
  { value: "tourism", label: "Tourisme & événementiel" },
];

export const HOURS: Option<Hours>[] = [
  { value: "lt5", label: "Moins de 5 h", hint: "Le soir ou le week-end, quand je peux" },
  { value: "5to10", label: "5 à 10 h", hint: "Un vrai side project, régulier" },
  { value: "10to20", label: "10 à 20 h", hint: "L'équivalent d'un mi-temps" },
  { value: "full", label: "Plus de 20 h", hint: "J'y vais à fond" },
];

export const TECH: Option<Tech>[] = [
  { value: "none", label: "Je ne code pas", hint: "Claude écrira tout le code, je suis les étapes" },
  { value: "nocode", label: "J'utilise des outils no-code", hint: "Notion, Airtable, Zapier, Webflow…" },
  { value: "some", label: "Je code un peu", hint: "HTML, un peu de JavaScript ou de Python" },
  { value: "dev", label: "Je suis développeur·se", hint: "Je mets des applis en production" },
];

export const MARKETS: Option<MarketPref>[] = [
  { value: "b2b", label: "Aux entreprises", hint: "PME et TPE : panier plus élevé, clients fidèles" },
  { value: "freelance", label: "Aux indépendants", hint: "Freelances, artisans, coachs, praticiens" },
  { value: "b2c", label: "Aux particuliers", hint: "Grand public, plus de volume" },
  { value: "any", label: "Peu importe", hint: "Je choisirai selon l'idée" },
];

export const GOALS: Option<Goal>[] = [
  { value: "side", label: "Un complément de revenu", hint: "500 à 2 000 € par mois" },
  { value: "salary", label: "Remplacer mon salaire", hint: "3 000 € par mois et plus" },
  { value: "startup", label: "Construire une startup", hint: "Grandir vite, peut-être lever des fonds" },
  { value: "learn", label: "Apprendre en construisant", hint: "Le revenu viendra ensuite" },
];

export const SPEEDS: Option<Speed>[] = [
  { value: "fast", label: "D'ici 1 mois", hint: "Je veux une preuve rapide" },
  { value: "medium", label: "D'ici 3 mois", hint: "Le temps de construire proprement" },
  { value: "slow", label: "Je suis patient·e", hint: "6 mois et plus, ce n'est pas un problème" },
];

export const BUDGETS: Option<Budget>[] = [
  { value: "zero", label: "0 €", hint: "Uniquement des outils gratuits" },
  { value: "small", label: "Moins de 300 €", hint: "Nom de domaine, quelques abonnements" },
  { value: "medium", label: "300 à 2 000 €", hint: "De quoi tester un peu de publicité" },
  { value: "large", label: "Plus de 2 000 €", hint: "Je peux investir" },
];

export const AUDIENCES: Option<Audience>[] = [
  { value: "none", label: "Personne pour l'instant", hint: "Je pars de zéro" },
  { value: "linkedin", label: "Un réseau professionnel", hint: "LinkedIn, anciens collègues, clients d'avant" },
  { value: "community", label: "Une communauté", hint: "Réseaux sociaux, newsletter, groupe, association" },
  { value: "clients", label: "Des contacts dans mon secteur", hint: "Je connais personnellement des clients potentiels" },
];

export type StepKind = "text" | "single" | "multi" | "textarea";

export interface Step {
  key: keyof Profile;
  kind: StepKind;
  title: string;
  subtitle: string;
  options?: Option<string>[];
  max?: number;
  placeholder?: string;
  optional?: boolean;
}

export const STEPS: Step[] = [
  {
    key: "firstName",
    kind: "text",
    title: "Comment tu t'appelles ?",
    subtitle: "Ton prénom, pour personnaliser ton prompt et tes messages de prospection.",
    placeholder: "Ton prénom",
  },
  {
    key: "hours",
    kind: "single",
    title: "Combien de temps peux-tu y consacrer par semaine ?",
    subtitle: "Sois réaliste : un plan tenu vaut mieux qu'un plan ambitieux abandonné.",
    options: HOURS,
  },
  {
    key: "tech",
    kind: "single",
    title: "Quel est ton niveau technique ?",
    subtitle: "Aucun niveau n'est éliminatoire : le prompt sera adapté à ta façon de travailler avec Claude.",
    options: TECH,
  },
  {
    key: "domains",
    kind: "multi",
    title: "Où as-tu de l'expérience ?",
    subtitle: "Métier, secteur ou passion, jusqu'à 3 domaines. Ce sont les clients que tu comprendras le mieux.",
    options: DOMAINS,
    max: 3,
  },
  {
    key: "market",
    kind: "single",
    title: "Tu préfères vendre à qui ?",
    subtitle: "Ça change tout : le prix, la façon de trouver tes clients et le temps avant le premier euro.",
    options: MARKETS,
  },
  {
    key: "goal",
    kind: "single",
    title: "Qu'attends-tu de ce SaaS ?",
    subtitle: "On calcule le nombre de clients qu'il te faut pour y arriver.",
    options: GOALS,
  },
  {
    key: "speed",
    kind: "single",
    title: "Quand veux-tu encaisser ton premier euro ?",
    subtitle: "Plus c'est court, plus on privilégie les idées simples à vendre.",
    options: SPEEDS,
  },
  {
    key: "budget",
    kind: "single",
    title: "Quel budget peux-tu mettre au départ ?",
    subtitle: "Un SaaS se lance avec très peu, mais ça oriente les canaux d'acquisition.",
    options: BUDGETS,
  },
  {
    key: "audience",
    kind: "single",
    title: "As-tu déjà une audience ou un réseau ?",
    subtitle: "C'est ton raccourci vers les premiers clients.",
    options: AUDIENCES,
  },
  {
    key: "problem",
    kind: "textarea",
    title: "Un problème qui t'agace au quotidien ?",
    subtitle: "Facultatif. Quelque chose que toi ou tes clients faites encore à la main, sur Excel ou par e-mail. Les meilleures idées viennent souvent de là.",
    placeholder: "Ex. : je relance mes clients à la main pour les factures impayées…",
    optional: true,
  },
];

export const MARKET_LABEL: Record<Market, string> = {
  b2b: "Entreprises",
  freelance: "Indépendants",
  b2c: "Particuliers",
};

export const COMPLEXITY_LABEL = ["", "Simple à construire", "Difficulté moyenne", "Plus technique"];
export const SALES_LABEL = ["", "Vente rapide", "Vente en quelques semaines", "Cycle de vente long"];

export function labelOf<V extends string>(options: Option<V>[], value: V): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export const DEFAULT_PROFILE: Profile = {
  firstName: "",
  hours: "5to10",
  tech: "none",
  domains: [],
  market: "any",
  goal: "side",
  speed: "medium",
  budget: "small",
  audience: "none",
  problem: "",
};
