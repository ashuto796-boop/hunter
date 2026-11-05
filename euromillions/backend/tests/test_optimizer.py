import random

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.services.optimizer import METHODS, OptimizerConfig, compare_methods, optimize
from app.services.portfolio import PortfolioState, Weights, build_state, grid_features, portfolio_metrics


def _random_feats(n, seed):
    rng = random.Random(seed)
    out = {}
    while len(out) < n:
        f = grid_features(sorted(rng.sample(range(1, 51), 5)), sorted(rng.sample(range(1, 13), 2)))
        out[f.index] = f
    return list(out.values())


@settings(max_examples=25, deadline=None)
@given(st.integers(2, 30), st.integers(0, 10_000))
def test_incremental_state_matches_full_rebuild(n, seed):
    w = Weights()
    feats = _random_feats(n + 10, seed)
    st_ = build_state(feats[:n], w, max_common=1)
    rng = random.Random(seed)
    for k in range(10):
        st_.replace(rng.randrange(n), feats[n + k])
    rebuilt = build_state(st_.grids, w, max_common=1)
    assert abs(st_.objective() - rebuilt.objective()) < 1e-12
    assert st_.violations == rebuilt.violations
    assert st_.distinct_pairs == rebuilt.distinct_pairs
    assert st_.distinct_triples == rebuilt.distinct_triples


def test_mean_overlap_identity():
    """Σ_{i<j} |N_i ∩ N_j| = Σ_x C(c_x, 2) : la diversité se calcule à partir des usages."""
    feats = _random_feats(25, 3)
    st_ = build_state(feats, Weights(), None)
    brute = sum(len(set(a.numbers) & set(b.numbers)) for i, a in enumerate(feats) for b in feats[i + 1:])
    assert st_.sum_c2_num == brute


def test_append_pop_inverse():
    feats = _random_feats(6, 9)
    st_ = build_state(feats[:5], Weights(), max_common=1)
    before = (st_.objective(), st_.violations, st_.distinct_pairs)
    st_.append(feats[5])
    st_.pop_last()
    assert (st_.objective(), st_.violations, st_.distinct_pairs) == before


@pytest.mark.parametrize("method", list(METHODS))
def test_each_method_improves_on_random(method):
    cfg = OptimizerConfig(n_grids=10, method=method, time_limit_s=1.5, seed=11)
    res = optimize(cfg)
    assert len(res.grids) == 10
    assert len(set(res.grids)) == 10
    assert res.metrics["duplicates"] == 0
    d = res.as_dict()
    for key in ("objective", "diversity", "pair_coverage", "duplicates", "elapsed_s", "iterations", "params", "history"):
        assert key in d
    baseline = build_state(_random_feats(10, 1), Weights(), 2).objective()
    assert res.objective >= baseline - 0.05


def test_annealing_beats_random_portfolio_on_objective():
    w = Weights()
    res = optimize(OptimizerConfig(n_grids=20, method="simulated_annealing", time_limit_s=1.5, seed=3, weights=w))
    randoms = [build_state(_random_feats(20, s), w, 2).objective() for s in range(20)]
    assert res.objective > max(randoms)


def test_compare_methods_same_seed():
    out = compare_methods(OptimizerConfig(n_grids=6, time_limit_s=0.3, seed=5), ["greedy", "local_search"])
    assert out["seed"] == 5
    assert {r["method"] for r in out["results"]} == {"greedy", "local_search"}
    assert "pas pour les chances de gain" in out["note"]


def test_large_portfolio_greedy():
    res = optimize(OptimizerConfig(n_grids=3000, method="greedy", time_limit_s=30, seed=1))
    assert len(set(res.grids)) == 3000


def test_metrics_report_fields():
    feats = _random_feats(12, 4)
    m = portfolio_metrics([(f.numbers, f.stars) for f in feats], ticket_price=2.5)
    assert m["cost"] == 30.0
    pj = m["probabilities"]["jackpot"]
    assert pj["numerator"] * 139_838_160 == 12 * pj["denominator"]
    assert len(m["similarity_matrix"]) == 12
    assert "pas des probabilités" in m["disclaimer"]
    assert sum(h["pairs_of_grids"] for h in m["overlap_histogram"]) == 66


def test_objective_is_not_called_probability():
    import app.services.portfolio as P

    doc = P.__doc__ or ""
    assert "n'est pas une probabilité" in doc


def test_state_empty():
    assert PortfolioState(Weights()).objective() == 0.0
