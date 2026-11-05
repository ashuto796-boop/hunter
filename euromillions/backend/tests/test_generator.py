import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.core.grid import is_valid_grid
from app.services.generator import NO_EDGE_WARNING, STRATEGIES, GenerationRequest, generate
from app.services.optimizer import InfeasibleConstraints
from app.services.popularity import pattern_flags, pattern_score
from app.services.portfolio import GridConstraints


def _check(res, count):
    grids = res["grids"]
    assert len(grids) == count
    keys = set()
    for g in grids:
        assert len(g["numbers"]) == 5 and len(set(g["numbers"])) == 5
        assert len(g["stars"]) == 2 and len(set(g["stars"])) == 2
        assert all(1 <= n <= 50 for n in g["numbers"]) and all(1 <= s <= 12 for s in g["stars"])
        assert g["numbers"] == sorted(g["numbers"]) and g["stars"] == sorted(g["stars"])
        assert is_valid_grid(g["numbers"], g["stars"])
        keys.add((tuple(g["numbers"]), tuple(g["stars"])))
    assert len(keys) == count  # aucun doublon
    assert res["metrics"]["duplicates"] == 0


@pytest.mark.parametrize("count", [1, 5, 10, 20, 50, 100, 500, 1000, 10_000])
def test_uniform_sizes(count):
    _check(generate(GenerationRequest(count=count, strategy="A")), count)


@pytest.mark.parametrize("strategy", ["B", "C", "F"])
def test_optimized_strategies(strategy):
    res = generate(GenerationRequest(count=12, strategy=strategy, seed=5, time_limit_s=0.5))
    _check(res, 12)
    assert "optimizer" in res


def test_popularity_strategy():
    res = generate(GenerationRequest(count=200, strategy="D", seed=1, popularity_threshold=0.0))
    _check(res, 200)
    assert all(g["pattern_score"] == 0 for g in res["grids"])
    assert any("pas une popularité mesurée" in w for w in res["warnings"])


def test_historical_strategy_has_warning():
    hist = {"draws": 100, "number_counts": list(range(1, 51)), "star_counts": [10] * 12}
    res = generate(GenerationRequest(count=30, strategy="E", seed=2), history=hist)
    _check(res, 30)
    assert NO_EDGE_WARNING in res["warnings"]
    assert "aucun avantage prédictif" in STRATEGIES["E"]["description"]
    with pytest.raises(ValueError):
        generate(GenerationRequest(count=3, strategy="E"), history=None)


def test_seed_reproducibility():
    a = generate(GenerationRequest(count=20, strategy="A", seed=42))
    b = generate(GenerationRequest(count=20, strategy="A", seed=42))
    assert [g["numbers"] for g in a["grids"]] == [g["numbers"] for g in b["grids"]]
    assert a["reproducible"] and "secrets" not in a["rng"]
    c = generate(GenerationRequest(count=20, strategy="A"))
    assert "secrets" in c["rng"]


@settings(max_examples=15, deadline=None)
@given(st.integers(15, 120), st.integers(0, 4))
def test_constraints_respected(sum_max, max_cons):
    c = GridConstraints.from_dict({"sum_min": 15, "sum_max": max(sum_max, 60), "max_consecutive_pairs": max_cons,
                                   "exclude_numbers": [1, 2, 3], "exclude_stars": [12]})
    res = generate(GenerationRequest(count=10, strategy="A", seed=1, constraints=c))
    for g in res["grids"]:
        assert c.accepts(g["numbers"], g["stars"])
        assert not set(g["numbers"]) & {1, 2, 3} and 12 not in g["stars"]


def test_infeasible_constraints():
    c = GridConstraints.from_dict({"sum_min": 239, "sum_max": 240})
    with pytest.raises(InfeasibleConstraints):
        generate(GenerationRequest(count=10, strategy="A", constraints=c))


def test_uniform_generator_statistics():
    res = generate(GenerationRequest(count=10_000, strategy="A", seed=7))
    nums = np.array([g["numbers"] for g in res["grids"]])
    counts = np.bincount(nums.ravel() - 1, minlength=50)
    chi = ((counts - 1000) ** 2 / 1000).sum() * 49 / 45
    from scipy.stats import chi2

    assert chi2.sf(chi, 49) > 1e-4


def test_fairness_note_present():
    res = generate(GenerationRequest(count=3))
    assert "139 838 160" in res["fairness_note"]
    assert "probabilité de sortie" in res["fairness_note"]


def test_popularity_patterns():
    assert "arithmetic" in pattern_flags([1, 2, 3, 4, 5])
    assert "dates" in pattern_flags([1, 7, 12, 25, 31])
    assert pattern_score([5, 10, 15, 20, 25]) > 0.5
    assert pattern_score([3, 17, 28, 39, 46]) == 0
    assert "past_draw" in pattern_flags([3, 17, 28, 39, 46], frozenset({(3, 17, 28, 39, 46)}))
