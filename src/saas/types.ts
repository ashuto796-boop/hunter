export type Hours = "lt5" | "5to10" | "10to20" | "full";
export type Tech = "none" | "nocode" | "some" | "dev";
export type Goal = "side" | "salary" | "startup" | "learn";
export type Budget = "zero" | "small" | "medium" | "large";
export type Audience = "none" | "linkedin" | "community" | "clients";
export type Market = "b2b" | "b2c" | "freelance";
export type MarketPref = Market | "any";
export type Speed = "fast" | "medium" | "slow";

export const DOMAIN_IDS = [
  "marketing",
  "sales",
  "design",
  "tech",
  "finance",
  "hr",
  "realestate",
  "health",
  "education",
  "ecommerce",
  "food",
  "legal",
  "content",
  "trades",
  "sport",
  "tourism",
] as const;
export type Domain = (typeof DOMAIN_IDS)[number];

export interface Profile {
  firstName: string;
  hours: Hours;
  tech: Tech;
  domains: Domain[];
  market: MarketPref;
  goal: Goal;
  speed: Speed;
  budget: Budget;
  audience: Audience;
  problem: string;
}

export interface Idea {
  id: string;
  name: string;
  pitch: string;
  problem: string;
  solution: string;
  target: string;
  market: Market;
  // First domain is the core one, used for matching and diversity
  domains: Domain[];
  whyNow: string;
  features: string[];
  price: number;
  priceUnit: string;
  // false = one-off payment (per housing, per wedding, per school year…)
  recurring: boolean;
  // 1 = simple CRUD app, 3 = integrations / AI pipeline / real time
  complexity: 1 | 2 | 3;
  // 1 = buyer decides alone in a call, 3 = several people, long cycle
  salesCycle: 1 | 2 | 3;
  channels: string[];
  alternatives: string;
  caution?: string;
  tags: string[];
  source: "catalog" | "claude";
}

export interface Match {
  idea: Idea;
  score: number;
  reasons: string[];
  warnings: string[];
  batch: number;
}

export interface Project {
  id: string;
  createdAt: number;
  profile: Profile;
  matches: Match[];
  chosenId: string | null;
  source: "catalog" | "claude";
}

export interface PlanTask {
  id: string;
  title: string;
  detail: string;
  minutes: number;
}

export interface PlanWeek {
  id: string;
  title: string;
  days: string;
  goal: string;
  tasks: PlanTask[];
}

export interface Template {
  id: string;
  title: string;
  hint: string;
  body: string;
}

export interface Plan {
  targets: { label: string; value: string }[];
  weeks: PlanWeek[];
  templates: Template[];
}
