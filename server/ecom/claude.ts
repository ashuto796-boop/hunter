// The agents' brain. Two kinds of calls:
//  - research(): Claude searches the web (server-side web search) and writes free-text notes;
//  - structured(): Claude turns facts and notes into a report that must match a Zod schema.
// Research is split from structuring because web results come back with citations, which
// structured outputs do not accept in the same request. Web pages are untrusted: they only ever
// reach the agents as data, and the only thing an agent can do in the shop is create a draft.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export class Declined extends Error {}

let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic());

export const hasClaude = () => !!process.env.ANTHROPIC_API_KEY;

export interface Usage {
  calls: number;
  input: number;
  output: number;
  searches: number;
}
export const usage: Usage = { calls: 0, input: 0, output: 0, searches: 0 };

function count(res: Anthropic.Beta.BetaMessage) {
  usage.calls++;
  usage.input += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
  usage.output += res.usage.output_tokens;
  usage.searches += res.usage.server_tool_use?.web_search_requests ?? 0;
}

export async function research(model: string, system: string, prompt: string, maxSearches: number): Promise<{ text: string; model: string }> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  let text = "";
  let served = model;
  for (let turn = 0; turn < 4; turn++) {
    const res = await api().beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearches, user_location: { type: "approximate", country: "FR", timezone: "Europe/Paris" } }],
      messages,
    });
    count(res);
    served = res.model;
    if (res.stop_reason === "refusal") throw new Declined(`demande déclinée (${res.stop_details?.category ?? "sans catégorie"})`);
    text += res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    // a long search turn can pause; it resumes from where it stopped
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  return { text: text.trim(), model: served };
}

export async function structured<S extends z.ZodType>(
  model: string,
  system: string,
  prompt: string,
  schema: S,
  effort: "low" | "medium" | "high" = "medium",
): Promise<{ data: z.infer<S>; model: string }> {
  const res = await api().beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  count(res);
  if (res.stop_reason === "refusal") throw new Declined(`demande déclinée (${res.stop_details?.category ?? "sans catégorie"})`);
  if (res.stop_reason === "max_tokens") throw new Error("réponse coupée (trop longue)");
  if (!res.parsed_output) throw new Error("réponse illisible");
  return { data: res.parsed_output as z.infer<S>, model: res.model };
}

export function explain(e: unknown): string {
  if (e instanceof Declined) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "la clé ANTHROPIC_API_KEY est refusée";
  if (e instanceof Anthropic.PermissionDeniedError) return "la clé n'a pas accès à ce modèle";
  if (e instanceof Anthropic.RateLimitError) return "limite de débit Claude atteinte, nouvel essai au prochain passage";
  if (e instanceof Anthropic.APIError) return `erreur Claude ${e.status ?? ""} ${e.message}`.slice(0, 200);
  return ((e as Error)?.message ?? String(e)).slice(0, 200);
}
