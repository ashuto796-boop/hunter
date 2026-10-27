import { Idea, Plan, PlanTask, PlanWeek, Profile, Template } from "../types";
import { eur, firstSentence, lcfirst, priceLabel } from "./format";

// Volumes scale with the time available each week
const VOLUME = {
  lt5: { prospects: 20, messages: 15, calls: 5, betas: 3, paying: 1 },
  "5to10": { prospects: 40, messages: 30, calls: 10, betas: 5, paying: 2 },
  "10to20": { prospects: 60, messages: 50, calls: 15, betas: 8, paying: 3 },
  full: { prospects: 100, messages: 80, calls: 20, betas: 10, paying: 5 },
} as const;

export function launchPrice(idea: Idea): number {
  return Math.max(1, Math.round(idea.price * 0.6));
}

// "23 € au lieu de 39 €/mois par établissement"
function launchVsList(idea: Idea): string {
  return `${eur(launchPrice(idea))} au lieu de ${priceLabel(idea)}`;
}

function audienceTask(profile: Profile, idea: Idea): PlanTask {
  switch (profile.audience) {
    case "linkedin":
      return {
        id: "w1-audience",
        title: "Publie un post LinkedIn sur le problème",
        detail: `Raconte le problème (« ${firstSentence(idea.problem)} ») et demande qui le vit. Ne parle pas encore de ton produit : tu cherches des témoignages. Utilise le modèle « Post de lancement » en l'adaptant.`,
        minutes: 45,
      };
    case "community":
      return {
        id: "w1-audience",
        title: "Sonde ta communauté",
        detail: "Une story, un post ou un message dans ton groupe : « Qui vit ce problème ? Je cherche 10 personnes pour en parler 15 minutes. » Note chaque réponse dans ta liste de prospects.",
        minutes: 30,
      };
    case "clients":
      return {
        id: "w1-audience",
        title: "Appelle 5 personnes de ton secteur",
        detail: "Commence par les contacts qui te connaissent déjà : ils te diront la vérité et te présenteront d'autres personnes concernées.",
        minutes: 60,
      };
    default:
      return {
        id: "w1-audience",
        title: "Rejoins 3 communautés où se trouvent tes clients",
        detail: `Pistes : ${idea.channels.slice(0, 2).join(" ; ")}. Lis les discussions, repère les plaintes récurrentes et note les mots exacts que les gens utilisent.`,
        minutes: 45,
      };
  }
}

export function buildPlan(profile: Profile, idea: Idea): Plan {
  const v = VOLUME[profile.hours];
  const lp = launchPrice(idea);
  const zero = profile.budget === "zero";
  const fast = profile.speed === "fast";
  const presale: PlanTask = {
    id: fast ? "w1-presale" : "w3-presale",
    title: "Propose une pré-vente",
    detail: `À ceux qui ont le plus mal : tarif de lancement à ${launchVsList(idea)}, garanti${idea.recurring ? " tant qu'ils restent abonnés" : ""}, s'ils paient maintenant via un lien de paiement Stripe. Un paiement vaut mille « c'est une super idée ».`,
    minutes: 45,
  };

  const w1: PlanWeek = {
    id: "w1",
    title: "Valider le problème",
    days: "Jours 1 à 7",
    goal: `${v.calls} conversations avec des personnes qui vivent le problème, avant d'écrire une ligne de code.`,
    tasks: [
      {
        id: "w1-icp",
        title: "Décris ton client idéal en une phrase",
        detail: `Point de départ : ${lcfirst(idea.target)}. Ajoute 3 critères pour reconnaître un bon prospect : taille, outil utilisé aujourd'hui, urgence du problème.`,
        minutes: 30,
      },
      {
        id: "w1-list",
        title: `Liste ${v.prospects} prospects`,
        detail: `Cherche dans : ${idea.channels.slice(0, 3).join(" ; ")}. Note le nom, le contact et l'indice qui te fait penser qu'ils ont le problème.`,
        minutes: 90,
      },
      audienceTask(profile, idea),
      {
        id: "w1-messages",
        title: `Envoie ${v.messages} messages de découverte`,
        detail: "Utilise le modèle « Message de découverte ». Tu ne vends rien : tu cherches à comprendre comment ils gèrent le problème aujourd'hui.",
        minutes: 60,
      },
      {
        id: "w1-calls",
        title: `Mène ${v.calls} conversations de 15 minutes`,
        detail: `Questions : comment gères-tu ça aujourd'hui ? Combien de temps ou d'argent ça te coûte ? Qu'as-tu déjà essayé ? Si un outil réglait ça, combien serais-tu prêt·e à payer ? Note leurs mots exacts : ce sera le texte de ta page.`,
        minutes: v.calls * 20,
      },
      {
        id: "w1-landing",
        title: "Mets en ligne ta page d'attente",
        detail: `Demande la page à Claude avec le prompt « Page d'attente » (onglet Prompt), puis publie-la ${zero ? "gratuitement (Vercel, Netlify ou GitHub Pages)" : "sur ton nom de domaine (une dizaine d'euros par an)"}. Branche un formulaire gratuit pour recueillir les inscriptions.`,
        minutes: 60,
      },
      ...(fast ? [presale] : []),
      {
        id: "w1-decision",
        title: "Décide : go ou no-go",
        detail: `Go si au moins ${Math.max(3, Math.round(v.calls / 2))} personnes décrivent le problème comme urgent et si 2 acceptent une démo. Sinon, reviens à tes 3 idées et teste la suivante : tu auras perdu une semaine, pas six mois.`,
        minutes: 20,
      },
    ],
  };

  const w2: PlanWeek = {
    id: "w2",
    title: "Construire le MVP avec Claude",
    days: "Jours 8 à 14",
    goal: "Une première version en ligne qui règle le problème central, rien de plus.",
    tasks: [
      {
        id: "w2-prompt",
        title: "Lance Claude avec ton prompt",
        detail: "Copie le prompt de l'onglet Prompt dans Claude. Valide le modèle de données et le découpage en étapes avant qu'il ne commence à coder.",
        minutes: 30,
      },
      {
        id: "w2-core",
        title: "Construis uniquement la fonctionnalité centrale",
        detail: `« ${idea.features[0]} ». Tout le reste attend : c'est ce que tes prospects t'ont décrit comme le plus douloureux qui compte.`,
        minutes: profile.hours === "lt5" ? 180 : 360,
      },
      {
        id: "w2-auth-pay",
        title: "Ajoute la connexion et le paiement",
        detail: `Inscription par e-mail et paiement Stripe à ${priceLabel(idea)}. Teste tout le parcours avec une carte de test Stripe.`,
        minutes: 120,
      },
      {
        id: "w2-deploy",
        title: "Mets en ligne",
        detail: zero ? "Déploie sur Vercel et garde l'adresse gratuite en .vercel.app pour l'instant." : "Déploie sur Vercel et branche ton nom de domaine.",
        minutes: 45,
      },
      {
        id: "w2-demo",
        title: "Montre l'avancement à tes prospects",
        detail: "Enregistre une vidéo d'une minute du produit et envoie-la aux personnes rencontrées en semaine 1. Leurs réactions valent plus que n'importe quelle fonctionnalité de plus.",
        minutes: 30,
      },
    ],
  };
  if (profile.hours === "lt5")
    w2.tasks.push({
      id: "w2-shortcut",
      title: "Si le temps manque : encaisse sans attendre",
      detail: "Livre la fonctionnalité centrale sans paiement intégré et encaisse avec un simple lien de paiement Stripe. L'intégration complète viendra quand tu auras des clients.",
      minutes: 15,
    });

  const w3: PlanWeek = {
    id: "w3",
    title: "Premiers utilisateurs",
    days: "Jours 15 à 21",
    goal: `${v.betas} bêta-testeurs qui utilisent le produit chaque semaine.`,
    tasks: [
      {
        id: "w3-onboard",
        title: `Installe ${v.betas} bêta-testeurs`,
        detail: "Fais l'installation toi-même, en visio ou en vrai, avec le modèle « Invitation bêta ». Regarde-les utiliser le produit sans les aider : chaque hésitation est un bug.",
        minutes: v.betas * 40,
      },
      {
        id: "w3-fix",
        title: "Corrige les 3 plus gros blocages",
        detail: "Aucune nouvelle fonctionnalité : uniquement ce qui empêche d'obtenir le résultat promis. Donne à Claude la description exacte de chaque blocage.",
        minutes: 240,
      },
      ...(fast ? [] : [presale]),
      {
        id: "w3-testimonials",
        title: "Récolte 3 témoignages",
        detail: "Une phrase, un prénom, un métier. Ajoute-les sur ta page d'attente : c'est ton meilleur argument de vente.",
        minutes: 30,
      },
      {
        id: "w3-emails",
        title: "Prépare tes e-mails d'activation",
        detail: "Trois e-mails automatiques : bienvenue, l'astuce clé à J+2, demande de retour à J+7. Claude peut les rédiger à partir de ce que tu as appris.",
        minutes: 45,
      },
    ],
  };

  const w4: PlanWeek = {
    id: "w4",
    title: "Premiers clients payants",
    days: "Jours 22 à 30",
    goal: `${v.paying} client${v.paying > 1 ? "s" : ""} payant${v.paying > 1 ? "s" : ""} et un canal d'acquisition qui fonctionne.`,
    tasks: [
      {
        id: "w4-convert",
        title: "Propose le passage payant à chaque bêta-testeur",
        detail: `Modèle « Passage payant » : tarif de lancement à ${launchVsList(idea)}. Demande franchement ce qui les retient s'ils hésitent.`,
        minutes: 60,
      },
      {
        id: "w4-outreach",
        title: `Contacte ${v.messages} nouveaux prospects`,
        detail: `Cette fois avec une démo et des témoignages. Canal à tester : ${idea.channels[idea.channels.length - 1]}.`,
        minutes: 90,
      },
      {
        id: "w4-post",
        title: "Publie ton histoire là où sont tes clients",
        detail: `Canal conseillé : ${idea.channels[1] ?? idea.channels[0]}. Raconte le problème, ce que tu as construit et un résultat de bêta-testeur, avec le modèle « Post de lancement ». Pas de publicité déguisée, les gens la repèrent tout de suite.`,
        minutes: 45,
      },
      {
        id: "w4-referral",
        title: "Demande des recommandations",
        detail: "À chaque client satisfait : « Qui d'autre autour de toi a ce problème ? » Une recommandation convertit bien mieux qu'un message à froid.",
        minutes: 20,
      },
      {
        id: "w4-review",
        title: "Fais le bilan de tes 30 jours",
        detail: "Note les messages envoyés, les conversations, les essais, les clients payants et le revenu mensuel. Garde le canal qui a le mieux marché et double la mise le mois prochain.",
        minutes: 30,
      },
    ],
  };

  return {
    targets: [
      { label: "Conversations", value: String(v.calls) },
      { label: "Bêta-testeurs", value: String(v.betas) },
      { label: "Clients payants", value: String(v.paying) },
      { label: "Prix de lancement", value: eur(lp) },
    ],
    weeks: [w1, w2, w3, w4],
    templates: templates(profile, idea, v.betas),
  };
}

function templates(profile: Profile, idea: Idea, betas: number): Template[] {
  const me = profile.firstName.trim() || "[Ton prénom]";
  const problem = lcfirst(firstSentence(idea.problem));
  return [
    {
      id: "discovery",
      title: "Message de découverte",
      hint: "Semaine 1 · e-mail ou message privé",
      body: `Bonjour [Prénom],

Je m'appelle ${me} et je m'intéresse à un problème précis : ${problem}

Je ne vends rien : je cherche à comprendre comment vous gérez ça aujourd'hui. Auriez-vous 15 minutes cette semaine pour en parler ? En échange, je vous partage ce que j'apprends des autres professionnels interrogés.

Merci d'avance,
${me}`,
    },
    {
      id: "beta",
      title: "Invitation bêta",
      hint: "Semaine 3 · après une conversation",
      body: `Bonjour [Prénom],

Merci encore pour notre échange. Vous m'aviez dit que [reprenez sa phrase sur le problème].

J'ai construit une première version de ${idea.name}. ${idea.pitch}

Je cherche ${betas} personnes pour la tester gratuitement pendant deux semaines, avec mon aide pour l'installation. Ça vous tente ?

${me}`,
    },
    {
      id: "paid",
      title: "Passage payant",
      hint: "Semaine 4 · fin de la période d'essai",
      body: `Bonjour [Prénom],

Ça fait deux semaines que vous utilisez ${idea.name} : merci pour vos retours, ils ont vraiment fait évoluer le produit.

Comme promis aux premiers testeurs, le tarif de lancement est de ${launchVsList(idea)}${idea.recurring ? ", garanti tant que vous restez abonné(e)" : ""}. Voici le lien pour l'activer : [lien de paiement]

Si quelque chose vous retient, dites-le-moi franchement.

${me}`,
    },
    {
      id: "post",
      title: "Post de lancement",
      hint: "LinkedIn, groupe ou communauté",
      body: `${firstSentence(idea.problem)}

Ces dernières semaines, j'ai discuté avec [nombre] personnes concernées. Ce qui revient tout le temps : « [citation d'un prospect] ».

Alors j'ai construit ${idea.name}. ${idea.pitch}

Je cherche encore quelques testeurs. Si ça vous parle, commentez ou écrivez-moi en privé.`,
    },
  ];
}
