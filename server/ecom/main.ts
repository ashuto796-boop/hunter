// One working day of the ten agents (run by .github/workflows/ecom-agents.yml).
//   npx tsx server/ecom/main.ts --state state.json [--force] [--only hunter,sourcing]
// Reads the previous state (sealed with ECOM_PASSPHRASE), connects to Shopify and Claude when
// their secrets are set, runs every agent that is due in roster order, then writes the new
// sealed state to the same file. Public Actions logs only ever get counts, never business data.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seal, unseal } from "../../src/gold/engine/seal";
import { ROSTER } from "../../src/ecom/shared/roster";
import type { AgentId, EcomState, PublishedState } from "../../src/ecom/shared/types";
import { isDue, runAgent, syncProducts, type Config, type Ctx } from "./agents";
import { hasClaude, usage } from "./claude";
import { Shopify, type Policy } from "./shopify";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const statePath = arg("--state") ?? "state.json";
const force = args.includes("--force") || process.env.ECOM_FORCE === "true";
const only = (arg("--only") ?? process.env.ECOM_ONLY ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean) as AgentId[];

const passphrase = process.env.ECOM_PASSPHRASE ?? "";
if (passphrase.length < 8) {
  console.error("::error::Ajoute le secret ECOM_PASSPHRASE (8 caractères ou plus) : il chiffre les données de ta boutique avant publication.");
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(fileURLToPath(new URL("./config.json", import.meta.url)), "utf8")) as Config;
const now = Date.now();

function fresh(): EcomState {
  return { v: 1, at: now, runs: 0, shop: null, kpis: null, agents: {}, products: [], calendar: [], log: [] };
}

async function load(): Promise<EcomState> {
  if (!existsSync(statePath)) return fresh();
  try {
    const pub = JSON.parse(readFileSync(statePath, "utf8")) as PublishedState;
    const s = await unseal<EcomState>(pub.sealed, passphrase);
    if (!s) {
      console.log("::warning::état précédent illisible avec ce ECOM_PASSPHRASE : nouveau départ");
      return fresh();
    }
    return s;
  } catch {
    return fresh();
  }
}

const state = await load();
const log = (text: string) => {
  state.log.unshift({ at: Date.now(), text });
  state.log = state.log.slice(0, 80);
};

let shop: Shopify | null = null;
let policies: Policy[] = [];
let orders: Ctx["orders"] = null;
state.shopError = undefined;
if (Shopify.configured()) {
  try {
    shop = await Shopify.connect();
    const s = await shop.shop();
    state.shop = s.info;
    policies = s.policies;
    orders = await shop.orders(30);
    syncProducts(state);
    console.log(`Shopify connecté : ${s.info.products.length} produits, ${orders.length} commandes sur 30 jours.`);
  } catch (e) {
    state.shopError = (e as Error).message.slice(0, 200);
    console.log(`::warning::Shopify : ${state.shopError}`);
    shop = null;
  }
} else {
  console.log("Shopify pas encore connecté (secrets SHOPIFY_STORE + SHOPIFY_TOKEN).");
}
if (!hasClaude()) console.log("Claude pas encore connecté (secret ANTHROPIC_API_KEY) : seuls les calculs tournent.");

const ctx: Ctx = { cfg, state, shop, policies, orders, now, log };
let ran = 0;
for (const a of ROSTER) {
  if (only.length && !only.includes(a.id)) continue;
  // the CEO writes the brief whenever someone else worked
  const due = a.id === "ceo" ? ran > 0 || isDue("ceo", ctx, force) : isDue(a.id, ctx, force);
  if (!due) continue;
  const t0 = Date.now();
  const r = await runAgent(a.id, ctx);
  state.agents[a.id] = r;
  ran++;
  console.log(`${a.name} (${a.role}) : ${r.status} en ${Math.round((Date.now() - t0) / 1000)} s`);
}

state.at = now;
state.runs++;
if (ran) log(`Journée de travail : ${ran} agent(s), ${usage.calls} appel(s) Claude, ${usage.searches} recherche(s) web`);

const pub: PublishedState = { v: 1, at: now, runs: state.runs, sealed: await seal(state, passphrase) };
writeFileSync(statePath, JSON.stringify(pub));
console.log(`État chiffré écrit (${ran} agent(s), ${usage.calls} appels Claude, ${usage.input} + ${usage.output} jetons, ${usage.searches} recherches web).`);
