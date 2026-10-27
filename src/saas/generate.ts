import { CATALOG } from "./data/catalog";
import { pickTop, scoreIdea } from "./engine/match";
import { useApp } from "./store";
import { Idea, Match, Profile, Project } from "./types";

export interface Batch {
  matches: Match[];
  source: Project["source"];
  notice?: string;
}

// Claude mode when a key is set, catalogue otherwise (and as a fallback if the API call fails)
export async function generateBatch(profile: Profile, exclude: Idea[], batch: number): Promise<Batch> {
  const { apiKey, useClaude } = useApp.getState();
  let notice: string | undefined;
  if (useClaude && apiKey.trim()) {
    try {
      const { generateIdeas } = await import("./engine/ai");
      const ideas = await generateIdeas(apiKey.trim(), profile, exclude.map((i) => i.name));
      const matches = ideas
        .map(({ fitReasons, ...idea }) => {
          const m = scoreIdea(profile, idea, batch);
          return { ...m, reasons: fitReasons.length ? fitReasons.slice(0, 3) : m.reasons };
        })
        .sort((a, b) => b.score - a.score);
      return { matches, source: "claude" };
    } catch (e) {
      notice = `${e instanceof Error ? e.message : "Erreur inconnue."} Voici les meilleures idées du catalogue à la place.`;
    }
  }
  return { matches: pickTop(profile, CATALOG, 3, new Set(exclude.map((i) => i.id)), batch), source: "catalog", notice };
}
