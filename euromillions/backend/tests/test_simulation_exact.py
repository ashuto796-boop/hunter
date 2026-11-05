from fractions import Fraction

import numpy as np
import pytest
from scipy import stats as sps

from app.core.combinatorics import combos_masks
from app.core.grid import numbers_to_mask
from app.core.probability import any_prize_probability, match_probability
from app.core.rules import CURRENT_TIERS
from app.services.portfolio_exact import STAR_PAIRS, exact_portfolio_analysis
from app.services.simulation import PortfolioInput, SimulationConfig, random_portfolio, run_simulation

RANK = {(t.numbers, t.stars): t.rank for t in CURRENT_TIERS}


def brute_force(grids):
    """Implémentation indépendante (sans bits compactés ni blocs) pour valider le calcul exact."""
    masks = combos_masks()
    any_rank = {t.rank: 0 for t in CURRENT_TIERS}
    none = 0
    for a, b in STAR_PAIRS:
        ks = [np.bitwise_count(masks & np.uint64(numbers_to_mask(n))) for n, _ in grids]
        ss = [len({a, b} & set(s)) for _, s in grids]
        any_win = np.zeros(masks.size, dtype=bool)
        for t in CURRENT_TIERS:
            hit = np.zeros(masks.size, dtype=bool)
            for k, s in zip(ks, ss):
                if s == t.stars:
                    hit |= k == t.numbers
            any_rank[t.rank] += int(hit.sum())
            any_win |= hit
        none += int((~any_win).sum())
    return any_rank, none


def test_exact_single_grid_equals_theory():
    res = exact_portfolio_analysis([((7, 14, 21, 28, 35), (4, 11))])
    for row in res["tiers"]:
        t = next(t for t in CURRENT_TIERS if t.rank == row["rank"])
        assert Fraction(row["p_at_least_one"]["numerator"], row["p_at_least_one"]["denominator"]) == \
            match_probability(t.numbers, t.stars)
    p_any = Fraction(res["p_any_win"]["numerator"], res["p_any_win"]["denominator"])
    assert p_any == any_prize_probability()


def test_exact_matches_brute_force_with_overlaps():
    grids = [((1, 2, 3, 4, 5), (1, 2)), ((1, 2, 3, 4, 6), (1, 3)), ((1, 2, 10, 20, 30), (1, 2))]
    res = exact_portfolio_analysis(grids)
    any_rank, none = brute_force(grids)
    total = 139_838_160
    for row in res["tiers"]:
        assert Fraction(row["p_at_least_one"]["numerator"], row["p_at_least_one"]["denominator"]) == \
            Fraction(any_rank[row["rank"]], total)
    assert Fraction(res["p_any_win"]["numerator"], res["p_any_win"]["denominator"]) == 1 - Fraction(none, total)
    # Les grilles se recouvrent : l'indépendance surestime P(au moins un gain).
    assert res["p_any_win"]["value"] < res["p_any_win_if_independent"]["value"]
    # Distribution du nombre de grilles gagnantes : normalisée et d'espérance exacte.
    probs = [Fraction(d["probability"]["numerator"], d["probability"]["denominator"]) for d in res["winning_grids_distribution"]]
    assert sum(probs) == 1
    assert abs(res["expected_winning_grids"] - res["expected_winning_grids_exact"]) < 1e-12


def test_exact_rejects_duplicates():
    with pytest.raises(ValueError):
        exact_portfolio_analysis([((1, 2, 3, 4, 5), (1, 2)), ((1, 2, 3, 4, 5), (1, 2))])


def test_simulation_converges_to_theory():
    grids = random_portfolio(5, seed=1)
    res = run_simulation(SimulationConfig([PortfolioInput("p", grids)], 300_000, seed=99))
    p = res["portfolios"][0]
    n_trials = 300_000 * 5
    m = 9  # rangs 5 à 13 (assez fréquents pour être testés)
    for t in p["tiers"]:
        if t["rank"] < 5:
            continue
        pv = sps.binomtest(t["wins"], n_trials, t["theoretical_probability"]).pvalue
        assert pv * m > 1e-4, t
    lo, hi = p["p_any_win_ci99"]
    exact = exact_portfolio_analysis(grids)["p_any_win"]["value"]
    assert lo - 0.002 <= exact <= hi + 0.002


def test_common_random_numbers_and_reproducibility():
    a = random_portfolio(3, 1)
    b = random_portfolio(3, 2)
    r1 = run_simulation(SimulationConfig([PortfolioInput("a", a), PortfolioInput("b", b)], 50_000, seed=5))
    r2 = run_simulation(SimulationConfig([PortfolioInput("a", a)], 50_000, seed=5))
    assert r1["portfolios"][0]["tiers"] == r2["portfolios"][0]["tiers"]  # mêmes tirages simulés
    assert r1["common_random_numbers"]


def test_simulation_payouts_and_cost():
    res = run_simulation(SimulationConfig([PortfolioInput("p", random_portfolio(2, 3))], 10_000, seed=1,
                                          ticket_price=2.5, payouts={13: 4.0}))
    p = res["portfolios"][0]
    assert p["total_cost"] == 50_000.0
    assert p["total_gross"] == pytest.approx(4.0 * next(t["wins"] for t in p["tiers"] if t["rank"] == 13))
    assert "n'augmente pas" in " ".join(res["notes"])


def test_simulation_cancel():
    import threading

    from app.services.simulation import SimulationCancelled

    ev = threading.Event()
    ev.set()
    with pytest.raises(SimulationCancelled):
        run_simulation(SimulationConfig([PortfolioInput("p", random_portfolio(2, 3))], 100_000, seed=1), cancel=ev)
