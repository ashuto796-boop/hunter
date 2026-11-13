// One working day of the ten agents (run by .github/workflows/ecom-agents.yml).
//   npx tsx server/ecom/main.ts --state state.json [--force] [--only hunter,sourcing]
// Reads the previous state (sealed with ECOM_PASSPHRASE), connects to Shopify and Claude when
// their secrets are set, runs every agent that is due in roster order, then writes the new
// sealed state to the same file. Public Actions logs only ever get counts, never business data.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seal, unseal } from "../../src/gold/engine/seal";
import { ROSTER } from "../../src/ecom/shared/roster";
import { unitEconomics } from "../../src/ecom/shared/finance";
import type { AgentId, EcomState, ProductIdea, PublishedState } from "../../src/ecom/shared/types";
import { isDue, overBudget, runAgent, syncProducts, type Config, type Ctx } from "./agents";
import { hasClaude, usage } from "./claude";
import { Shopify, type Policy } from "./shopify";
import { adsConfigured, fetchAds, verdicts } from "./ads";
import { CJ, cjConfigured } from "./cj";

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

// First run: start from the products researched by hand (server/ecom/seed-products.json).
// They enter as ideas, so the sourcing agent checks real supplier prices before anything else.
if (!state.products.length) {
  type Seed = Pick<ProductIdea, "name" | "problem" | "why" | "angle" | "priceEur" | "costEur" | "score" | "risks" | "searchEn">;
  const seeds = JSON.parse(readFileSync(fileURLToPath(new URL("./seed-products.json", import.meta.url)), "utf8")) as Seed[];
  for (const s of seeds) {
    const u = unitEconomics(s.priceEur, s.costEur, cfg);
    const key = s.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    state.products.push({ ...s, key, marginEur: u.margin, breakEvenRoas: u.breakEvenRoas, suppliers: [], status: "idée", foundAt: now });
  }
}
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
    console.log(`Shopify connecté : ${s.info.products.length} produits (${s.info.products.filter((p) => p.status === "DRAFT").length} brouillons), ${orders.length} commandes sur 30 jours.`);
  } catch (e) {
    state.shopError = (e as Error).message.slice(0, 200);
    console.log(`::warning::Shopify : ${state.shopError}`);
    shop = null;
  }
} else {
  console.log("Shopify pas encore connecté (secrets SHOPIFY_STORE + SHOPIFY_TOKEN).");
}
if (!hasClaude()) console.log("Claude pas encore connecté (secret ANTHROPIC_API_KEY) : seuls les calculs tournent.");

// Ad results (read-only) and the CJ catalogue, each optional
const ads = adsConfigured() ? await fetchAds(cfg.metaApiVersion, log) : null;
if (ads) {
  const live = state.products.filter((p) => p.status === "en vente" || p.status === "brouillon" || p.status === "sourcé");
  const be = state.kpis?.breakEvenRoas ?? (live.length ? live.reduce((s, p) => s + p.breakEvenRoas, 0) / live.length : 2.2);
  const margin = live.length ? live.reduce((s, p) => s + p.marginEur, 0) / live.length : 12;
  verdicts(ads, be, margin);
  // the owner's limits beat every other rule: stop-loss without a sale, then the monthly ceiling
  const spent = ads.platforms.reduce((s, p) => s + p.spend30, 0);
  const sales = ads.platforms.reduce((s, p) => s + p.purchases30, 0);
  const all = ads.platforms.flatMap((p) => p.ads);
  if (spent >= cfg.adStopLossEur && sales === 0) {
    all.forEach((a) => (a.verdict = "couper"));
    log(`Pubs : ${Math.round(spent)} € dépensés sans aucune vente, tout est à couper (limite ${cfg.adStopLossEur} €)`);
  } else if (spent >= cfg.adBudgetMaxMonthEur) {
    all.forEach((a) => (a.verdict = a.verdict === "augmenter" || a.verdict === "attendre" ? "couper" : a.verdict));
    log(`Pubs : plafond de ${cfg.adBudgetMaxMonthEur} € atteint sur 30 jours, tout est à couper`);
  } else if (spent >= cfg.adBudgetMaxMonthEur * 0.8) {
    all.forEach((a) => (a.verdict = a.verdict === "augmenter" ? "attendre" : a.verdict));
  }
  console.log(`Pubs : ${ads.platforms.map((p) => `${p.name} ${p.ads.length} pub(s)`).join(", ") || "aucune donnée"}${ads.errors.length ? `, ${ads.errors.length} erreur(s)` : ""}.`);
}
state.ads = ads;
let cj: CJ | null = null;
if (cjConfigured()) {
  try {
    cj = await CJ.connect();
    console.log("CJ Dropshipping connecté.");
  } catch (e) {
    log(`CJ : ${(e as Error).message}`);
    console.log("::warning::CJ Dropshipping : connexion refusée");
  }
}

const ctx: Ctx = { cfg, state, shop, policies, orders, ads, cj, now, log };
// Claude spend of the month, measured on every call; a new calendar month starts from zero
const month = new Date(now).toISOString().slice(0, 7);
if (!state.claude || state.claude.month !== month) {
  // the very first run (12 November 2026) happened before spend was tracked
  const before = !state.claude && state.runs > 0 && month === "2026-11" ? cfg.claudeSpentBeforeTrackingUsd : 0;
  state.claude = { month, usd: before, budget: cfg.claudeBudgetMonthUsd, runs: 0 };
}
state.claude.budget = cfg.claudeBudgetMonthUsd;
const monthStart = state.claude.usd;
const spent = () => monthStart + usage.usd;
let blocked = 0;

let ran = 0;
let worked = 0; // agents that produced a fresh report with the model this run
for (const a of ROSTER) {
  if (only.length && !only.includes(a.id)) continue;
  // the CEO writes the brief whenever someone else worked
  const due = a.id === "ceo" ? worked > 0 || isDue("ceo", ctx, force) : isDue(a.id, ctx, force);
  if (!due) continue;
  // the ceiling is enforced here: an agent that could push the month past it does not start
  if (hasClaude() && overBudget(a.id, ctx, spent())) {
    const prev = state.agents[a.id];
    state.agents[a.id] = {
      ...(prev ?? { id: a.id, summary: "", sections: [], todo: [] }),
      at: prev?.at ?? now,
      status: "waiting",
      note: `Plafond Claude du mois atteint (${spent().toFixed(2)} $ dépensés sur ${cfg.claudeBudgetMonthUsd} $) : reprise le 1er du mois prochain, ou monte le plafond dans config.json.`,
    };
    blocked++;
    continue;
  }
  const t0 = Date.now();
  const r = await runAgent(a.id, ctx);
  state.agents[a.id] = r;
  ran++;
  if (r.status === "ok" && r.model && r.at === now) worked++;
  console.log(`${a.name} (${a.role}) : ${r.status} en ${Math.round((Date.now() - t0) / 1000)} s`);
}

state.at = now;
state.runs++;
state.claude.usd = Math.round(spent() * 100) / 100;
state.claude.runs++;
if (blocked) log(`Plafond Claude : ${blocked} agent(s) en pause, ${state.claude.usd} $ dépensés ce mois-ci sur ${cfg.claudeBudgetMonthUsd} $`);
if (ran) log(`Journée de travail : ${ran} agent(s), ${usage.calls} appel(s) Claude, ${usage.searches} recherche(s) web`);

const pub: PublishedState = { v: 1, at: now, runs: state.runs, sealed: await seal(state, passphrase) };
writeFileSync(statePath, JSON.stringify(pub));
console.log(`État chiffré écrit (${ran} agent(s), ${usage.calls} appels Claude, ${usage.input} + ${usage.output} jetons, ${usage.searches} recherches web, ${usage.usd.toFixed(2)} $ ; ce mois-ci ${state.claude.usd} $ sur ${cfg.claudeBudgetMonthUsd} $).`);
