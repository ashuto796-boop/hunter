from datetime import date
from fractions import Fraction
from math import comb

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.core import probability as P
from app.core.rules import CURRENT_ERA, ERAS, era_for_date, get_era, rank_for_matches, tiers_for_era

# Valeurs officielles « 1 chance sur N » (arrondies) de l'époque actuelle.
OFFICIAL_ODDS = {
    1: 139_838_160,
    2: 6_991_908,
    3: 3_107_515,
    4: 621_503,
    5: 31_075,
    6: 14_125,
    7: 13_811,
    8: 985,
    9: 706,
    10: 314,
    11: 188,
    12: 49,
    13: 22,
}


def test_total_combinations_exact():
    assert P.total_combinations() == 139_838_160
    assert P.total_combinations() == comb(50, 5) * comb(12, 2)


def test_jackpot_probability_exact():
    assert P.jackpot_probability() == Fraction(1, 139_838_160)


def test_tier_probabilities_match_official_odds():
    for tier, p in P.tier_probabilities():
        assert round(1 / p) == OFFICIAL_ODDS[tier.rank], tier


def test_tier_order_is_probability_order():
    probs = [p for _, p in P.tier_probabilities()]
    assert probs == sorted(probs)


@pytest.mark.parametrize("era", ERAS)
def test_all_match_probabilities_sum_to_one(era):
    total = sum(P.match_probability(k, s, era) for k in range(6) for s in range(3))
    assert total == 1


def test_any_prize_about_one_in_thirteen():
    p = P.any_prize_probability()
    assert round(1 / p) == 13


def test_portfolio_probability():
    assert P.portfolio_jackpot_probability(10) == Fraction(10, 139_838_160)
    assert P.portfolio_jackpot_probability(139_838_160) == 1
    with pytest.raises(ValueError):
        P.portfolio_jackpot_probability(139_838_161)


def test_repeated_draws_probability():
    p = P.portfolio_jackpot_probability(1)
    assert P.repeated_draws_probability(p, 1) == p
    assert P.repeated_draws_probability(p, 0) == 0
    exact = P.repeated_draws_probability(p, 104)
    approx = P.repeated_draws_probability_float(float(p), 104)
    assert abs(float(exact) - approx) < 1e-15


@given(st.integers(min_value=1, max_value=10_000), st.integers(min_value=1, max_value=5_000))
def test_repeated_probability_bounds(n, t):
    p = P.portfolio_jackpot_probability(n)
    r = P.repeated_draws_probability_float(float(p), t)
    assert float(p) <= r + 1e-18
    assert r <= min(1.0, t * float(p)) + 1e-12


def test_format_probability():
    d = P.format_probability(Fraction(1, 139_838_160))
    assert d.fraction == "1 / 139 838 160"
    assert d.one_in == "1 chance sur 139 838 160"
    assert d.scientific.startswith("7,15")
    assert d.percent.endswith("%")
    assert P.format_probability(Fraction(0)).one_in == "aucune chance"


def test_eras():
    assert era_for_date(date(2004, 2, 13)).stars_max == 9
    assert era_for_date(date(2011, 5, 10)).stars_max == 11
    assert era_for_date(date(2016, 9, 23)).stars_max == 11
    assert era_for_date(date(2016, 9, 27)).stars_max == 12
    assert era_for_date(date(2026, 1, 2)) == CURRENT_ERA
    with pytest.raises(ValueError):
        era_for_date(date(2003, 12, 31))
    assert get_era(None) == CURRENT_ERA


def test_rank_for_matches():
    assert rank_for_matches(5, 2) == 1
    assert rank_for_matches(2, 0) == 13
    assert rank_for_matches(1, 1) is None
    assert rank_for_matches(0, 2) is None
    # Avant 2011, pas de rang 2+0.
    assert rank_for_matches(2, 0, get_era("E2004")) is None
    assert len(tiers_for_era(get_era("E2004"))) == 12
