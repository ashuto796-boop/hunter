import math

import pytest

from app.core.rules import CURRENT_ERA, get_era
from app.services.budget import BudgetInput, budget_analysis
from app.services.export import export_portfolio, to_csv
from app.services.jackpot import JackpotInput, jackpot_analysis, share_factor
from app.services.ml_lab import run_ml_experiment
from app.services.research import ResearchConfig, run_research
from app.services.results import check_grids


def test_budget_basic():
    out = budget_analysis(BudgetInput(ticket_price=2.5, budget_weekly=10, draws_per_week=2, duration_weeks=52))
    assert out["n_grids"] == 2
    assert out["annual_cost"] == 520.0
    pj = out["p_jackpot_per_draw"]
    assert pj["numerator"] * 139_838_160 == 2 * pj["denominator"]
    assert "risque de perte" in out["warning"]
    lo, hi = out["secondary"]["p_any_win_per_draw_bounds"]
    assert lo < hi <= 1


def test_budget_monthly_and_return():
    out = budget_analysis(BudgetInput(budget_monthly=100, assumed_return_rate=0.5, duration_weeks=52))
    assert out["n_grids"] == int(100 * 12 / 52 / 2 / 2.5)
    assert out["expected_loss"] == pytest.approx(out["total_cost"] * 0.5)
    with pytest.raises(ValueError):
        budget_analysis(BudgetInput())


def test_share_factor():
    assert share_factor(0) == 1
    assert share_factor(1) == pytest.approx(1 - math.exp(-1))
    assert 0 < share_factor(3) < share_factor(1) < 1


def test_jackpot_analysis():
    out = jackpot_analysis(JackpotInput(jackpot=130e6, n_grids=1, ticket_price=2.5, secondary_payouts={13: 4.0}))
    assert out["ev_jackpot"] == pytest.approx(130e6 / 139_838_160)
    assert out["ev_net"] == pytest.approx(out["ev_jackpot"] + out["ev_secondary"] - 2.5)
    shared = jackpot_analysis(JackpotInput(jackpot=130e6, other_tickets=139_838_160))
    assert shared["lambda"] == pytest.approx(1.0)
    assert shared["ev_jackpot"] < out["ev_jackpot"]
    assert any("pas un gain garanti" in h for h in out["hypotheses"])
    assert out["break_even_jackpot"] > 0


def test_results_check_ranks_and_unknown_prizes():
    grids = [((1, 2, 3, 4, 5), (1, 2)), ((1, 2, 30, 40, 50), (7, 8)), ((10, 11, 12, 13, 14), (1, 3))]
    res = check_grids(grids, [1, 2, 3, 4, 5], [1, 2], CURRENT_ERA, prizes={13: 4.3})
    ranks = [l["rank"] for l in res["lines"]]
    assert ranks == [1, 13, None]
    assert res["lines"][0]["prize"] is None and not res["lines"][0]["prize_known"]  # jamais inventé
    assert res["lines"][1]["prize"] == 4.3
    assert res["summary"]["wins_with_unknown_amount"] == 1
    res_old = check_grids([((1, 2, 30, 40, 50), (7, 8))], [1, 2, 3, 4, 5], [1, 2], get_era("E2004"))
    assert res_old["lines"][0]["rank"] is None  # pas de rang 2+0 avant 2011


def test_ml_lab_protocol(demo_drawset):
    out = run_ml_experiment(demo_drawset, models=["logistic", "hot", "random"], seed=3, n_bootstrap=100)
    assert out["protocol"]["split"] == "chronologique"
    tr_end = out["protocol"]["train_period"][1]
    te_start = out["protocol"]["test_period"][0]
    assert tr_end < te_start  # aucune fuite temporelle
    assert {r["model"] for r in out["results"]} == {"logistic", "hot", "random"}
    # Sur des données fictives uniformes, aucun modèle ne doit battre le hasard.
    assert out["any_model_beats_random"] is False
    assert "ne surpasse le hasard" in out["conclusion"]


def test_ml_features_no_leakage(demo_drawset):
    from app.services.ml_lab import WARMUP, build_features

    X, Y, idx = build_features(demo_drawset.last(300))
    ds = demo_drawset.last(300)
    t = 150
    row = t - WARMUP
    # « sorti au tirage précédent » doit correspondre au tirage t−1, jamais au tirage t.
    prev = set(ds.numbers[t - 1].tolist())
    assert {i + 1 for i in range(50) if X[row, i, 4] == 1} == prev
    assert {i + 1 for i in range(50) if Y[row, i] == 1} == set(ds.numbers[t].tolist())


@pytest.mark.parametrize("code", ["hot_next", "overdue_next", "repeat_previous", "sum_mean", "even_mean",
                                  "consecutive_mean", "uniformity"])
def test_research_reproducible(demo_drawset, code):
    ds = demo_drawset.last(400)
    a = run_research(ds, ResearchConfig(code, n_sim=200, seed=10))
    b = run_research(ds, ResearchConfig(code, n_sim=200, seed=10))
    assert a["p_value"] == b["p_value"] and a["observed"] == b["observed"]
    assert 0 < a["p_value"] <= 1


def test_exports():
    grids = [{"numbers": [1, 2, 3, 4, 5], "stars": [1, 2], "strategy": "=cmd()"}]
    for fmt in ("csv", "xlsx", "json", "pdf"):
        data = export_portfolio(fmt, "Test", grids, {"cost": 2.5}, {"seed": 1})
        assert len(data) > 50
    assert export_portfolio("pdf", "T", grids, {}, None)[:4] == b"%PDF"
    csv = to_csv(grids, ["strategy"]).decode("utf-8")
    assert "'=cmd()" in csv  # neutralisation des formules
