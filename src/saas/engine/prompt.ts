import { BUDGETS, GOALS, HOURS, labelOf } from "../data/questions";
import { Idea, Profile } from "../types";
import { eur, lcfirst, priceLabel } from "./format";
import { revenueTarget } from "./match";

const TECH_LINE: Record<Profile["tech"], string> = {
  none: "je ne sais pas coder",
  nocode: "j'utilise des outils no-code mais je n'ai jamais codé",
  some: "je code un peu (HTML, un peu de JavaScript ou de Python)",
  dev: "je suis développeur·se et je mets des applications en production",
};

function stack(profile: Profile, usesAI: boolean): string {
  const ai = usesAI
    ? "\n- IA : l'API Claude d'Anthropic (SDK officiel `@anthropic-ai/sdk`, modèle `claude-opus-5-5`), appelée uniquement côté serveur."
    : "";
  switch (profile.tech) {
    case "none":
    case "nocode":
      return `Tu écris 100 % du code. J'utiliserai Claude Code (sur claude.ai/code ou l'application de bureau) pour que tu crées et modifies les fichiers toi-même. Stack imposée, pour rester simple à maintenir :
- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase pour la base de données et l'authentification
- Stripe pour les paiements (Checkout + portail client)
- Hébergement sur Vercel${ai}

Chaque fois que je dois faire quelque chose moi-même (créer un compte, copier une clé, configurer un service), explique-le comme à un débutant, avec le nom exact des menus et des boutons.`;
    case "some":
      return `Je code un peu : explique tes choix et les parties importantes du code pour que je puisse le maintenir. Stack :
- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase (Postgres, authentification, Row Level Security)
- Stripe (Checkout, portail client, webhooks)
- Resend pour les e-mails transactionnels
- Hébergement sur Vercel${ai}`;
    case "dev":
      return `Je suis développeur·se : va droit au but, code de qualité production. Stack proposée (challenge-la si un autre choix est nettement meilleur pour ce produit) :
- Next.js (App Router) + TypeScript strict + Tailwind CSS
- Supabase (Postgres, Auth, Row Level Security), ou Postgres + Drizzle
- Stripe (Checkout, Customer Portal, webhooks signés)
- Resend pour les e-mails transactionnels
- Hébergement sur Vercel${ai}
- Tests sur la logique métier critique`;
  }
}

function workstyle(profile: Profile): string {
  const beginner = profile.tech === "none" || profile.tech === "nocode";
  const lines = beginner
    ? [
        "Une étape à la fois. À la fin de chaque étape, dis-moi exactement comment vérifier que ça marche.",
        "Pas de jargon sans explication.",
        "Sécurité dès le départ : aucune clé secrète dans le code envoyé au navigateur, règles de sécurité (RLS) activées sur chaque table Supabase.",
        "Si quelque chose casse, explique-moi la cause en une phrase avant de corriger.",
      ]
    : [
        "Petites étapes, chacune testable et commitée séparément.",
        "Sécurité dès le départ : RLS sur chaque table, clés secrètes uniquement côté serveur, signature des webhooks Stripe vérifiée.",
        "Signale-moi la dette technique que tu prends volontairement.",
      ];
  lines.push("L'interface et tous les textes de l'application sont en français, sobres, rapides et pensés d'abord pour le mobile.");
  return lines.map((l) => `- ${l}`).join("\n");
}

export function buildPrompt(profile: Profile, idea: Idea): string {
  const usesAI = idea.features.some((f) => /\bIA\b/.test(f));
  const { mrr, clients } = revenueTarget(profile, idea);
  const name = profile.firstName.trim();
  const goal = labelOf(GOALS, profile.goal).toLowerCase();
  const perMonth = idea.recurring ? `${clients} clients à ${priceLabel(idea)}` : `${clients} ventes par mois à ${priceLabel(idea)}`;
  const features = [...idea.features, "Inscription et connexion par e-mail", `Paiement en ligne avec Stripe (${priceLabel(idea)})`];

  return `Tu es mon associé·e technique et produit. Je lance un SaaS et je veux que tu le construises avec moi, étape par étape, jusqu'à ce qu'un premier client puisse payer.

## Qui je suis
${name ? `- Prénom : ${name}\n` : ""}- Niveau technique : ${TECH_LINE[profile.tech]}
- Temps disponible : ${labelOf(HOURS, profile.hours).toLowerCase()} par semaine
- Objectif : ${goal}, soit environ ${eur(mrr)} par mois (${perMonth})
- Budget de départ : ${lcfirst(labelOf(BUDGETS, profile.budget))}

## Le produit : ${idea.name}
${idea.pitch}

- **Problème** : ${idea.problem}
- **Cible** : ${idea.target}
- **Solution** : ${idea.solution}
- **Pourquoi maintenant** : ${idea.whyNow}
- **Ce qu'ils utilisent aujourd'hui** : ${idea.alternatives}
- **Prix** : ${priceLabel(idea)}${idea.recurring ? "" : " (paiement unique)"}

## Périmètre de la v1
La v1 doit permettre à un premier client de payer et d'obtenir de la valeur dès sa première semaine. Fonctionnalités :
${features.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Hors périmètre de la v1 : application mobile native, multilingue, gestion d'équipes et de rôles avancée, intégrations non listées ci-dessus. Si une fonctionnalité te paraît indispensable et manque, propose-la, mais ne l'ajoute pas sans mon accord.
${idea.caution ? `\n## Point d'attention\n${idea.caution}\n` : ""}
## Stack technique
${stack(profile, usesAI)}

## Comment on travaille
${workstyle(profile)}

## Ta première réponse
Avant d'écrire la moindre ligne de code :
1. Reformule le produit en 5 lignes et signale-moi les angles morts ou les risques que tu vois.
2. Propose le modèle de données (tables, champs, relations) et la liste des pages de l'application.
3. Découpe la construction en étapes de 1 à 2 heures, dans l'ordre, chacune testable, pour avoir une v1 en ligne en deux semaines à mon rythme.

Attends ensuite ma validation avant de commencer l'étape 1.`;
}

export function buildLandingPrompt(profile: Profile, idea: Idea): string {
  return `Crée la page d'attente (landing page) de ${idea.name}, un SaaS dont la promesse est : « ${idea.pitch} »

Cible : ${idea.target}.
Problème : ${idea.problem}
Prix de lancement : ${priceLabel(idea)}.

La page, en français, doit contenir : une promesse claire en une phrase, les 3 bénéfices principaux, une section « Comment ça marche » en 3 étapes, le prix de lancement, une courte FAQ (4 questions) et un formulaire « Je veux tester en avant-première » (prénom, e-mail, métier). Ton direct et chaleureux, tutoiement${profile.tech === "dev" ? "" : ", aucune connaissance technique requise pour la publier"}. Livre-la sous forme d'une seule page HTML autonome que je peux publier telle quelle.`;
}
