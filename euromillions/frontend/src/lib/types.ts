/** Types des principales réponses de l'API. */

export interface Prob {
  numerator: number;
  denominator: number;
  fraction: string | null;
  percent: string;
  scientific: string;
  one_in: string;
  value: number;
}

export interface GridLite {
  numbers: number[];
  stars: number[];
}

export interface GeneratedGrid extends GridLite {
  id: number;
  combo_index: number;
  pattern_score: number;
  strategy: string;
  generated_at: string;
  diversity_score?: number;
}

export interface SavedGrid extends GridLite {
  id: number;
  combo_index: number;
  strategy: string;
  diversity_score: number | null;
  label: string | null;
  created_at: string | null;
}

export interface PortfolioMetrics {
  n_grids: number;
  distinct_grids: number;
  duplicates: number;
  objective: number | null;
  diversity: number;
  pair_coverage: number;
  triple_coverage: number;
  star_pair_coverage: number;
  star_balance: number;
  star_score: number;
  popularity: number;
  overlap_rate: number;
  distinct_numbers: number;
  distinct_stars: number;
  distinct_pairs: number;
  distinct_triples: number;
  distinct_star_pairs: number;
  number_usage: number[];
  star_usage: number[];
  mean_common_numbers: number;
  mean_common_stars: number;
  overlap_histogram: { common_numbers: number; pairs_of_grids: number }[];
  max_common_numbers_observed: number;
  max_common_total_observed: number;
  similarity_matrix?: number[][];
  probabilities: {
    jackpot: Prob;
    total_combinations: number;
    expected_wins_by_rank: { rank: number; label: string; expected_wins: number; single_grid_probability: Prob }[];
    note: string;
  };
  cost?: number;
  disclaimer: string;
}

export interface GenerationResult {
  strategy: string;
  strategy_name: string;
  strategy_description: string;
  count: number;
  grids: GeneratedGrid[];
  metrics: PortfolioMetrics;
  seed: number | null;
  reproducible: boolean;
  rng: string;
  elapsed_s: number;
  warnings: string[];
  fairness_note: string;
  optimizer?: Record<string, unknown>;
  historical?: Record<string, unknown>;
}

export interface Job<T = unknown> {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  message: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  meta: Record<string, unknown>;
  result?: T;
}

export interface JobStart {
  job: Job;
  simulation_id?: number;
}

export interface PortfolioSummary {
  id: number;
  name: string;
  strategy_code: string;
  n_grids: number;
  seed: number | null;
  objective: number | null;
  ticket_price: number;
  is_individual: boolean;
  notes: string | null;
  created_at: string | null;
  params: Record<string, unknown>;
  has_exact_analysis: boolean;
}

export interface PortfolioDetail extends PortfolioSummary {
  grids: SavedGrid[];
  metrics: PortfolioMetrics | null;
  exact: { p_any_win: number; tiers: { rank: number; p: number }[]; computed_at: string } | null;
}

export interface Draw {
  id: number;
  draw_date: string;
  weekday: string;
  numbers: number[];
  stars: number[];
  era_code: string;
  stars_max: number;
  jackpot_eur: number | null;
  source_id: number | null;
  prizes: { rank: number; winners: number | null; prize_eur: number | null }[];
}

export interface DrawSummary {
  count: number;
  first_date: string | null;
  last_date: string | null;
  eras: Record<string, number>;
  is_demo: boolean;
  last_refresh: string | null;
  draws_with_prizes: number;
  demo_warning: string | null;
}

export interface StatTest {
  statistic: number | null;
  df: number;
  p_value: number | null;
  name?: string;
  hypotheses?: string;
  bins?: number;
}

export interface DistributionRow {
  value: number;
  observed: number;
  observed_pct?: number;
  expected: number;
  theoretical_pct: number;
}

export interface FeatureDistribution {
  distribution: DistributionRow[];
  observed_mean: number | null;
  observed_sd: number | null;
  theoretical_mean: number;
  theoretical_sd: number;
  test: StatTest;
  description?: string;
}

export interface FrequencyItem {
  value: number;
  count: number;
  frequency: number;
  expected: number;
  expected_frequency: number;
  deviation: number;
  deviation_pct: number;
  z_score: number;
  p_value: number;
  q_value_bh: number;
  significant_bh: boolean;
  rank: number;
  window_counts: Record<string, number>;
  window_ranks: Record<string, number>;
  current_gap: number | null;
  eligible_draws?: number;
}

export interface Frequencies {
  draws: number;
  items: FrequencyItem[];
  uniformity_test: StatTest & { draws_used?: number };
  multiple_testing?: string;
  exposure_note?: string;
  warning: string;
}

export interface TierRow {
  rank: number;
  numbers: number;
  stars: number;
  label: string;
  winning_combinations: number;
  probability: Prob;
}

export interface Filters {
  last_n?: number | null;
  date_from?: string | null;
  date_to?: string | null;
  era?: string | null;
}
