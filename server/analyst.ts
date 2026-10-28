// Evening log written by Claude from what the AI saw and did during the session. Optional: the
// server loads this module only when the ANTHROPIC_API_KEY secret is set. Comments, never trades.
import Anthropic from "@anthropic-ai/sdk";

export const ANALYST_MODEL = "claude-opus-5-5";

export interface AnalystNote {
  day: string; // New York session date
  at: number;
  text: string;
  model: string; // model that actually answered (a fallback may have served the request)
}

const SYSTEM = `Tu es l'analyste d'AURUM, une IA qui trade seule l'or (contrat XAU/USDT) sur un compte de démonstration, avec sept stratégies spécialisées et une gestion du risque stricte.
Chaque soir, après la clôture de New York, tu écris le carnet de la séance pour son propriétaire : un particulier francophone qui suit l'IA sur son téléphone.

À partir des seules données JSON fournies, écris trois courts paragraphes, chacun précédé de son titre seul sur une ligne :
Marché — direction et amplitude de l'or sur la séance, et le contexte qui l'explique (régime, tendance de fond, dollar, argent, annonces).
L'IA — ce qu'elle a fait et pourquoi : ses trades, ou ce qui l'a retenue de trader. Si une décision paraît discutable au vu des données, dis-le simplement.
Demain — ce qu'elle surveille : niveaux, annonces à venir, conditions dans lesquelles elle pourrait entrer.

Français simple et direct, tutoiement, 150 à 220 mots au total, sans listes à puces, sans emoji. Explique tout terme technique en quelques mots.
N'invente aucun chiffre qui n'est pas dans les données. Ne donne aucun conseil d'investissement : tu commentes un compte de démonstration.`;

export async function writeNote(day: string, facts: unknown, log: (...m: unknown[]) => void): Promise<AnalystNote | null> {
  const client = new Anthropic();
  try {
    const res = await client.beta.messages.create({
      model: ANALYST_MODEL,
      max_tokens: 16000,
      // if the request is declined, the API retries it on a suitable model by itself
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Données de la séance du ${day} :\n${JSON.stringify(facts)}` }],
    });
    if (res.stop_reason === "refusal") {
      log(`carnet non écrit : demande déclinée (${res.stop_details?.category ?? "sans catégorie"})`);
      return null;
    }
    const text = res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    if (!text) return null;
    log(`carnet écrit par ${res.model} (${res.usage.input_tokens} + ${res.usage.output_tokens} jetons)`);
    return { day, at: Date.now(), text, model: res.model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) log("carnet non écrit : la clé ANTHROPIC_API_KEY est refusée");
    else if (e instanceof Anthropic.PermissionDeniedError) log("carnet non écrit : la clé n'a pas accès à ce modèle");
    else if (e instanceof Anthropic.RateLimitError) log("carnet non écrit : limite de débit atteinte, nouvel essai au prochain passage");
    else if (e instanceof Anthropic.APIError) log(`carnet non écrit : erreur API ${e.status} ${e.message}`);
    else log("carnet non écrit :", (e as Error).message);
    return null;
  }
}
