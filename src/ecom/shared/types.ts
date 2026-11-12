// Shared between the agents server (server/ecom/) and the dashboard (src/ecom/).

export type AgentId = "ceo" | "finance" | "hunter" | "sourcing" | "merch" | "ads" | "content" | "retention" | "service" | "legal";

export interface Task {
  text: string;
  who: "toi" | "agent"; // "toi": only the owner can do it (pay, sign, publish, order a sample)
  priority: 1 | 2 | 3; // 1 = today
  agent: AgentId;
}

export interface Section {
  title: string;
  items: string[];
}

export interface AgentReport {
  id: AgentId;
  at: number; // when this report was written
  status: "ok" | "waiting" | "error";
  note?: string; // why it is waiting or failed
  model?: string; // model that actually answered
  summary: string;
  sections: Section[];
  todo: Task[];
}

export interface Supplier {
  name: string; // e.g. CJ Dropshipping, BigBuy, AliExpress store name
  unitCostEur: number;
  shipEur: number;
  shipDays: string; // e.g. "4-7 j (entrepôt UE)"
  note: string;
}

export interface ProductIdea {
  key: string; // stable id (slug of the name)
  name: string;
  problem: string; // problem it solves for the buyer
  why: string; // why now: trend, proof of demand
  angle: string; // marketing angle
  priceEur: number; // planned selling price TTC
  costEur: number; // product + shipping, best supplier
  marginEur: number; // price - cost - payment fees (before ads)
  breakEvenRoas: number;
  score: number; // 0-100
  risks: string[];
  suppliers: Supplier[];
  status: "idée" | "sourcé" | "brouillon" | "en vente" | "écarté";
  shopifyId?: string;
  searchEn?: string; // supplier search keywords
  listing?: { title: string; descriptionHtml: string; price: number; compareAt: number | null; at: number };
  foundAt: number;
}

export interface Kpis {
  at: number;
  currency: string;
  days: number; // window (30)
  orders: number;
  revenue: number; // net of refunds, TTC
  revenueHt: number;
  avgBasket: number;
  cogs: number; // products + supplier shipping
  cogsEstimated: boolean; // true when some unit costs are missing in Shopify
  fees: number;
  adSpend: number;
  social: number; // micro-entreprise contributions
  fixed: number;
  net: number; // estimated net profit over the window
  netMonthPace: number; // projected over 30 days
  goal: number;
  breakEvenRoas: number | null;
  ordersPerDayNeeded: number | null; // to reach the goal at the current basket and margin
  unfulfilledLate: number; // paid, not shipped after 3 days
  refundRate: number; // share of revenue refunded
  daily: { day: string; orders: number; revenue: number }[];
}

export interface ShopInfo {
  name: string;
  domain: string;
  currency: string;
  products: { id: string; title: string; status: string; price: number | null }[];
  policies: string[]; // policy types present (REFUND_POLICY, PRIVACY_POLICY...)
}

export interface ContentPost {
  day: string; // "Lun", "Mar"...
  platform: string; // TikTok, Reels, Shorts
  format: string;
  hook: string;
  script: string;
  caption: string;
}

export interface AdLine {
  name: string;
  campaign: string;
  spend: number; // last 7 days
  impressions: number;
  clicks: number;
  purchases: number;
  value: number;
  roas: number | null;
  verdict?: "couper" | "augmenter" | "attendre"; // decided in code from the break-even ROAS
}

export interface PlatformAds {
  name: string; // Meta, TikTok
  spend7: number;
  purchases7: number;
  roas7: number | null;
  spend30: number;
  purchases30: number;
  roas30: number | null;
  ads: AdLine[];
}

export interface AdsSnapshot {
  at: number;
  platforms: PlatformAds[];
  errors: string[];
  spend30: number;
}

export interface EcomState {
  v: 1;
  at: number;
  runs: number;
  shop: ShopInfo | null;
  shopError?: string;
  kpis: Kpis | null;
  agents: Partial<Record<AgentId, AgentReport>>;
  products: ProductIdea[];
  calendar: ContentPost[];
  ads?: AdsSnapshot | null;
  log: { at: number; text: string }[];
}

// What is published on the ecom-data branch: the business data is sealed with ECOM_PASSPHRASE.
export interface PublishedState {
  v: 1;
  at: number;
  runs: number;
  sealed: import("../../gold/engine/seal").Sealed;
}
