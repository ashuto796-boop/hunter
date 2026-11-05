"""Schémas Pydantic de validation des requêtes de l'API."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.grid import validate_grid
from app.core.rules import CURRENT_ERA


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GridIn(StrictModel):
    numbers: list[int] = Field(min_length=5, max_length=5)
    stars: list[int] = Field(min_length=2, max_length=2)
    label: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _valid(self) -> "GridIn":
        validate_grid(self.numbers, self.stars, CURRENT_ERA)
        self.numbers = sorted(self.numbers)
        self.stars = sorted(self.stars)
        return self

    def pair(self) -> tuple[tuple[int, ...], tuple[int, ...]]:
        return tuple(self.numbers), tuple(self.stars)


class ConstraintsIn(StrictModel):
    sum_min: int | None = Field(default=None, ge=15, le=240)
    sum_max: int | None = Field(default=None, ge=15, le=240)
    even_min: int | None = Field(default=None, ge=0, le=5)
    even_max: int | None = Field(default=None, ge=0, le=5)
    max_consecutive_pairs: int | None = Field(default=None, ge=0, le=4)
    max_per_decade: int | None = Field(default=None, ge=1, le=5)
    exclude_numbers: list[int] = Field(default_factory=list, max_length=45)
    exclude_stars: list[int] = Field(default_factory=list, max_length=10)
    max_popularity: float | None = Field(default=None, ge=0, le=1)


class WeightsIn(StrictModel):
    diversity: float = Field(default=0.35, ge=0, le=10)
    pairs: float = Field(default=0.25, ge=0, le=10)
    triples: float = Field(default=0.10, ge=0, le=10)
    stars: float = Field(default=0.15, ge=0, le=10)
    popularity: float = Field(default=0.10, ge=0, le=10)
    overlap: float = Field(default=0.05, ge=0, le=10)


Method = Literal["greedy", "local_search", "simulated_annealing", "tabu", "genetic", "cp_sat"]
Seed = Annotated[int, Field(ge=0, le=2**63 - 1)] | None


class GenerateIn(StrictModel):
    count: int = Field(ge=1, le=10_000)
    strategy: Literal["A", "B", "C", "D", "E", "F"] = "A"
    seed: Seed = None
    constraints: ConstraintsIn = Field(default_factory=ConstraintsIn)
    weights: WeightsIn | None = None
    method: Method = "simulated_annealing"
    time_limit_s: float = Field(default=3.0, gt=0, le=120)
    max_common: int | None = Field(default=2, ge=0, le=4)
    popularity_threshold: float = Field(default=0.15, ge=0, le=1)
    historical_mode: Literal["hot", "cold"] = "hot"
    historical_window: int | None = Field(default=None, ge=10, le=10_000)
    historical_strength: float = Field(default=1.0, ge=0, le=3)


class GridsIn(StrictModel):
    grids: list[GridIn] = Field(min_length=1, max_length=10_000)
    weights: WeightsIn | None = None
    max_common: int | None = Field(default=2, ge=0, le=4)
    ticket_price: float | None = Field(default=None, gt=0, le=100)


class ExportGridsIn(StrictModel):
    grids: list[dict[str, Any]] = Field(min_length=1, max_length=10_000)
    format: Literal["csv", "xlsx", "json", "pdf"] = "csv"
    name: str = Field(default="Grilles", max_length=200)
    params: dict[str, Any] | None = None

    @field_validator("grids")
    @classmethod
    def _grids(cls, v: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for g in v:
            validate_grid(list(g.get("numbers", [])), list(g.get("stars", [])))
        return v


class PortfolioCreate(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    strategy_code: str = Field(default="A", max_length=20)
    params: dict[str, Any] = Field(default_factory=dict)
    seed: Seed = None
    grids: list[GridIn] = Field(min_length=1, max_length=10_000)
    notes: str | None = Field(default=None, max_length=5000)
    ticket_price: float | None = Field(default=None, gt=0, le=100)


class PortfolioUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=5000)


class SaveGridIn(GridIn):
    strategy_code: str = Field(default="A", max_length=20)
    diversity_score: float | None = None


class OptimizeIn(StrictModel):
    n_grids: int = Field(ge=1, le=10_000)
    method: Method = "simulated_annealing"
    weights: WeightsIn = Field(default_factory=WeightsIn)
    constraints: ConstraintsIn = Field(default_factory=ConstraintsIn)
    max_common: int | None = Field(default=2, ge=0, le=4)
    time_limit_s: float = Field(default=5.0, gt=0, le=120)
    max_iterations: int = Field(default=200_000, ge=1, le=10_000_000)
    seed: Seed = None
    params: dict[str, float | int] = Field(default_factory=dict)
    budget: float | None = Field(default=None, gt=0)
    ticket_price: float | None = Field(default=None, gt=0, le=100)


class CompareMethodsIn(OptimizeIn):
    methods: list[Method] = Field(default_factory=lambda: ["greedy", "local_search", "simulated_annealing", "tabu",
                                                           "genetic"], min_length=1, max_length=6)


class CandidatesIn(OptimizeIn):
    candidates: list[dict[str, Any]] = Field(default_factory=list, max_length=8)


class PortfolioCompareIn(StrictModel):
    portfolio_a: int
    portfolio_b: int
    n_draws: int = Field(default=100_000, ge=1_000, le=2_000_000)
    seed: Seed = None
    exact: bool = True
    ticket_price: float | None = Field(default=None, gt=0, le=100)


class InlinePortfolio(StrictModel):
    name: str = Field(max_length=200)
    grids: list[GridIn] = Field(min_length=1, max_length=10_000)


class SimulationIn(StrictModel):
    portfolio_ids: list[int] = Field(default_factory=list, max_length=10)
    inline_portfolios: list[InlinePortfolio] = Field(default_factory=list, max_length=10)
    random_baselines: list[int] = Field(default_factory=list, max_length=5)
    n_draws: int = Field(ge=1, le=5_000_000)
    seed: Seed = None
    ticket_price: float | None = Field(default=None, gt=0, le=100)
    payouts: dict[int, float] = Field(default_factory=dict)
    jackpot: float | None = Field(default=None, ge=0)

    @field_validator("payouts")
    @classmethod
    def _payouts(cls, v: dict[int, float]) -> dict[int, float]:
        for r, a in v.items():
            if not 2 <= int(r) <= 13 or a < 0:
                raise ValueError("Gains supposés : rangs 2 à 13, montants positifs.")
        return v

    @field_validator("random_baselines")
    @classmethod
    def _rb(cls, v: list[int]) -> list[int]:
        if any(not 1 <= n <= 10_000 for n in v):
            raise ValueError("Taille de portefeuille aléatoire entre 1 et 10 000.")
        return v


class ExactAnalysisIn(StrictModel):
    portfolio_id: int | None = None
    grids: list[GridIn] | None = Field(default=None, max_length=1000)


class ResultCheckIn(StrictModel):
    draw_id: int | None = None
    draw_date: date | None = None
    numbers: list[int] | None = Field(default=None, min_length=5, max_length=5)
    stars: list[int] | None = Field(default=None, min_length=2, max_length=2)
    portfolio_id: int | None = None
    grids: list[GridIn] | None = Field(default=None, max_length=10_000)
    save: bool = True


class DrawCreate(StrictModel):
    draw_date: date
    numbers: list[int] = Field(min_length=5, max_length=5)
    stars: list[int] = Field(min_length=2, max_length=2)
    jackpot_eur: float | None = Field(default=None, ge=0)
    prizes: dict[int, dict[str, float | int | None]] = Field(default_factory=dict)


class UrlImportIn(StrictModel):
    url: str = Field(max_length=1000)
    overwrite: bool = False


class JackpotIn(StrictModel):
    jackpot: float = Field(default=130_000_000, gt=0, le=1e10)
    n_grids: int = Field(default=1, ge=1, le=10_000_000)
    ticket_price: float | None = Field(default=None, gt=0, le=100)
    other_tickets: float | None = Field(default=None, ge=0, le=1e10)
    expected_other_winners: float | None = Field(default=None, ge=0, le=1000)
    popularity_multiplier: float = Field(default=1.0, gt=0, le=100)
    secondary_payouts: dict[int, float] = Field(default_factory=dict)
    use_historical_payouts: bool = False


class MLRunIn(StrictModel):
    models: list[Literal["logistic", "random_forest", "gradient_boosting", "mlp", "ewma", "hot", "overdue",
                         "random"]] = Field(default_factory=lambda: ["logistic", "random_forest", "gradient_boosting",
                                                                     "mlp", "ewma", "hot", "overdue", "random"])
    train_ratio: float = Field(default=0.7, ge=0.3, le=0.9)
    seed: Seed = None
    n_bootstrap: int = Field(default=500, ge=100, le=5000)
    date_from: date | None = None
    date_to: date | None = None


class ResearchIn(StrictModel):
    hypothesis: str = Field(max_length=60)
    mode: Literal["exploratory", "confirmatory"] = "exploratory"
    date_from: date | None = None
    date_to: date | None = None
    last_n: int | None = Field(default=None, ge=60, le=100_000)
    n_sim: int = Field(default=2000, ge=100, le=20_000)
    seed: Seed = None
    alpha: float = Field(default=0.05, gt=0, lt=0.5)
    params: dict[str, int] = Field(default_factory=dict)
    title: str | None = Field(default=None, max_length=300)


class StrategyCreate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(default="F", max_length=20)
    description: str | None = Field(default=None, max_length=2000)
    params: dict[str, Any] = Field(default_factory=dict)


class LabEvaluateIn(StrictModel):
    n_grids: int = Field(default=10, ge=2, le=100)
    weights: WeightsIn = Field(default_factory=WeightsIn)
    constraints: ConstraintsIn = Field(default_factory=ConstraintsIn)
    max_common: int | None = Field(default=2, ge=0, le=4)
    method: Method = "simulated_annealing"
    time_limit_s: float = Field(default=1.0, gt=0, le=3)
    seed: Seed = None


class LabCompareIn(StrictModel):
    configs: list[dict[str, Any]] = Field(min_length=1, max_length=5)
    n_grids: int = Field(default=10, ge=2, le=200)
    time_limit_s: float = Field(default=2.0, gt=0, le=20)
    seed: Seed = None


class AutoTuneIn(StrictModel):
    target: Literal["pair_coverage", "triple_coverage", "diversity", "star_score", "star_pair_coverage"] = "pair_coverage"
    n_grids: int = Field(default=10, ge=2, le=200)
    trials: int = Field(default=12, ge=2, le=60)
    time_per_trial_s: float = Field(default=1.0, gt=0, le=10)
    min_diversity: float | None = Field(default=None, ge=0, le=1)
    constraints: ConstraintsIn = Field(default_factory=ConstraintsIn)
    max_common: int | None = Field(default=2, ge=0, le=4)
    seed: Seed = None


class SettingsIn(StrictModel):
    ticket_price: float | None = Field(default=None, gt=0, le=100)
    ticket_price_source: str | None = Field(default=None, max_length=1000)
    currency: str | None = Field(default=None, max_length=10)
    draws_per_week: int | None = Field(default=None, ge=1, le=2)
    default_seed: int | None = Field(default=None, ge=0)
    show_demo_banner: bool | None = None
    official_source_url: str | None = Field(default=None, max_length=1000)
