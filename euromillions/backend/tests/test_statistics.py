from math import comb

import numpy as np
from hypothesis import given, settings
from hypothesis import strategies as st

from app.services import statistics as S


def test_exact_distributions_normalized():
    for name in S.FEATURES:
        support, probs = S.exact_feature_distribution(name)
        assert abs(probs.sum() - 1) < 1e-12, name
    support, probs = S.exact_feature_distribution("sum")
    assert support.min() == 15 and support.max() == 240
    assert abs((support * probs).sum() - 127.5) < 1e-9
    support, probs = S.exact_feature_distribution("even")
    for e, p in zip(support, probs):
        assert abs(p - comb(25, int(e)) * comb(25, 5 - int(e)) / comb(50, 5)) < 1e-15


def test_frequencies_consistency(demo_drawset):
    ds = demo_drawset
    nf = S.number_frequencies(ds)
    assert sum(i["count"] for i in nf["items"]) == 5 * ds.size
    assert abs(nf["items"][0]["expected"] - ds.size / 10) < 1e-9
    sf = S.star_frequencies(ds)
    assert sum(i["count"] for i in sf["items"]) == 2 * ds.size
    # Exposition : l'étoile 12 n'existe que depuis 2016, l'étoile 10 depuis 2011.
    eligible = {i["value"]: i["eligible_draws"] for i in sf["items"]}
    assert eligible[1] == ds.size
    assert eligible[10] == int((ds.stars_max >= 10).sum())
    assert eligible[12] == int((ds.stars_max == 12).sum())
    assert abs(sum(i["expected"] for i in sf["items"]) - 2 * ds.size) < 1e-6


def test_demo_data_is_compatible_with_h0(demo_drawset):
    """Les données fictives sont uniformes : après correction, aucun test global ne doit rejeter H0 à 0,1 %."""
    res = S.statistical_tests(demo_drawset)
    assert all(t["p_bonferroni"] > 0.001 for t in res["tests"])


def test_benjamini_hochberg():
    p = np.array([0.01, 0.04, 0.03, 0.5])
    q = S.benjamini_hochberg(p)
    assert np.all(q >= p)
    assert np.isclose(q[0], 0.04)
    assert np.all(S.bonferroni(p) == np.clip(p * 4, 0, 1))


@settings(max_examples=30, deadline=None)
@given(st.lists(st.floats(0, 1), min_size=1, max_size=50))
def test_bh_monotone(pvals):
    p = np.array(pvals)
    q = S.benjamini_hochberg(p)
    order = np.argsort(p)
    assert np.all(np.diff(q[order]) >= -1e-12)
    assert np.all(q <= 1)


def test_pairs_triples(demo_drawset):
    pr = S.pairs(demo_drawset, top=5)
    assert pr["most_frequent"][0]["count"] >= pr["most_frequent"][-1]["count"]
    tr = S.triples(demo_drawset, top=5)
    x = S._one_hot(demo_drawset.numbers, 50).astype(int)
    a, b, c = tr["most_frequent"][0]["values"]
    assert int((x[:, a - 1] & x[:, b - 1] & x[:, c - 1]).sum()) == tr["most_frequent"][0]["count"]
    total_triples = 10 * demo_drawset.size
    assert tr["tests"] == comb(50, 3)
    assert total_triples > 0


def test_gaps(demo_drawset):
    g = S.gaps(demo_drawset)
    assert g["theoretical_mean_interval"] == 10
    for item in g["items"]:
        assert item["current_gap"] is None or item["current_gap"] >= 0
    assert "dû" in g["warning"]


def test_repeats_and_entropy(demo_drawset):
    r = S.repeats(demo_drawset)
    assert sum(d["observed"] for d in r["numbers"]["distribution"]) == demo_drawset.size - 1
    e1 = S.entropy(demo_drawset, n_sim=60, seed=1)
    e2 = S.entropy(demo_drawset, n_sim=60, seed=1)
    assert e1["simulation"] == e2["simulation"]  # reproductible
    assert 0 < e1["normalized_entropy"] <= 1


def test_chi_square_scaling():
    """Sous H0, la statistique corrigée (×49/45) a une moyenne ≈ 49 (degrés de liberté)."""
    from app.core.combinatorics import combos_table

    rng = np.random.default_rng(3)
    t = combos_table()
    stats = []
    for _ in range(300):
        c = np.bincount(t[rng.integers(0, t.shape[0], 500)].ravel() - 1, minlength=50)
        stats.append(S.chi_square_gof(c, np.full(50, 50.0), scale=49 / 45)["statistic"])
    assert 46 < np.mean(stats) < 52


def test_empty_drawset():
    ds = S.DrawSet.from_rows([])
    assert S.number_frequencies(ds)["draws"] == 0
    assert S.overview(ds) == {"draws": 0}
