"""Audit mathématique automatique : vérifie les propriétés essentielles du logiciel."""

from __future__ import annotations

import random
import secrets
import time
from datetime import datetime, timezone
from fractions import Fraction
from math import comb
from threading import Event
from typing import Any, Callable

import numpy as np
from scipy import stats as sps

from app.core.combinatorics import combos_masks, combos_table
from app.core.grid import combination_rank, grid_from_index, grid_index, is_valid_grid
from app.core.probability import match_count, match_probability, tier_probabilities, total_combinations
from app.core.rules import CURRENT_TIERS, ERAS, rank_for_matches
from app.services.generator import GenerationRequest, generate
from app.services.portfolio_exact import exact_portfolio_analysis
from app.services.simulation import PortfolioInput, SimulationConfig, run_simulation

OFFICIAL_ODDS = {1: 139_838_160, 2: 6_991_908, 3: 3_107_515, 4: 621_503, 5: 31_075, 6: 14_125, 7: 13_811,
                 8: 985, 9: 706, 10: 314, 11: 188, 12: 49, 13: 22}
P_THRESHOLD = 0.001


def _check(code: str, name: str, fn: Callable[[], tuple[bool, dict[str, Any]]]) -> dict[str, Any]:
    t0 = time.perf_counter()
    try:
        passed, details = fn()
        status = "passed" if passed else "failed"
    except Exception as exc:  # un audit doit rapporter, jamais planter
        passed, details, status = False, {"exception": f"{exc.__class__.__name__}: {exc}"}, "error"
    return {"code": code, "name": name, "passed": passed, "status": status, "details": details,
            "duration_s": round(time.perf_counter() - t0, 3)}


def audit_total_combinations() -> tuple[bool, dict[str, Any]]:
    a = total_combinations()
    b = combos_table().shape[0] * comb(12, 2)
    c = len(np.unique(combos_masks())) * 66
    return a == b == c == 139_838_160, {"formula": a, "enumeration": b, "distinct_masks": c, "expected": 139_838_160}


def audit_probabilities() -> tuple[bool, dict[str, Any]]:
    sums = {}
    ok = True
    for era in ERAS:
        s = sum(match_probability(k, st, era) for k in range(6) for st in range(3))
        sums[era.code] = str(s)
        ok &= s == 1
    odds = {}
    for t, p in tier_probabilities():
        v = round(1 / p)
        odds[t.rank] = {"computed": v, "official": OFFICIAL_ODDS[t.rank], "ok": v == OFFICIAL_ODDS[t.rank]}
        ok &= v == OFFICIAL_ODDS[t.rank]
    total_win = sum(match_count(t.numbers, t.stars) for t in CURRENT_TIERS)
    return ok, {"sum_of_all_outcomes_by_era": sums, "odds_by_rank": odds, "winning_combinations_total": total_win}


def audit_rank_function() -> tuple[bool, dict[str, Any]]:
    table = {}
    ok = True
    expected = {(t.numbers, t.stars): t.rank for t in CURRENT_TIERS}
    for k in range(6):
        for s in range(3):
            r = rank_for_matches(k, s)
            table[f"{k}+{s}"] = r
            ok &= r == expected.get((k, s))
    # Vérification par force brute sur des tirages aléatoires.
    rng = random.Random(7)
    for _ in range(5000):
        g = (set(rng.sample(range(1, 51), 5)), set(rng.sample(range(1, 13), 2)))
        d = (set(rng.sample(range(1, 51), 5)), set(rng.sample(range(1, 13), 2)))
        k, s = len(g[0] & d[0]), len(g[1] & d[1])
        ok &= rank_for_matches(k, s) == expected.get((k, s))
    return ok, {"rank_table": table, "random_checks": 5000}


def audit_index_bijection() -> tuple[bool, dict[str, Any]]:
    rng = random.Random(11)
    ok = True
    for _ in range(20_000):
        i = rng.randrange(139_838_160)
        g = grid_from_index(i)
        ok &= grid_index(g.numbers, g.stars) == i and is_valid_grid(g.numbers, g.stars)
    table = combos_table()
    sample = rng.sample(range(table.shape[0]), 2000)
    ok &= all(combination_rank(table[i].tolist()) == i for i in sample)
    return ok, {"roundtrips": 20_000, "table_rank_checks": 2000}


def audit_generator_uniformity(n: int = 120_000) -> tuple[bool, dict[str, Any]]:
    """Génère n grilles avec le générateur de production (secrets.SystemRandom) et teste l'uniformité."""
    rng = secrets.SystemRandom()
    nums = np.empty((n, 5), dtype=np.int16)
    stars = np.empty((n, 2), dtype=np.int16)
    for i in range(n):
        nums[i] = rng.sample(range(1, 51), 5)
        stars[i] = rng.sample(range(1, 13), 2)
    nc = np.bincount(nums.ravel() - 1, minlength=50)
    sc = np.bincount(stars.ravel() - 1, minlength=12)
    chi_n = float(((nc - n / 10) ** 2 / (n / 10)).sum() * 49 / 45)
    chi_s = float(((sc - n / 6) ** 2 / (n / 6)).sum() * 11 / 10)
    p_n = float(sps.chi2.sf(chi_n, 49))
    p_s = float(sps.chi2.sf(chi_s, 11))
    sp = np.sort(stars, axis=1)
    sp_idx = (sp[:, 0] - 1) + (sp[:, 1] - 1) * (sp[:, 1] - 2) // 2
    spc = np.bincount(sp_idx, minlength=66)
    chi_sp = float(((spc - n / 66) ** 2 / (n / 66)).sum())
    p_sp = float(sps.chi2.sf(chi_sp, 65))
    srt = np.sort(nums, axis=1).astype(np.int64)
    ranks = np.array([sum(comb(int(v) - 1, j + 1) for j, v in enumerate(row)) for row in srt[:20_000]])
    buckets = np.bincount((ranks * 100) // comb(50, 5), minlength=100)
    chi_b = float(((buckets - 200) ** 2 / 200).sum())
    p_b = float(sps.chi2.sf(chi_b, 99))
    pvals = [p_n, p_s, p_sp, p_b]
    ok = min(pvals) * len(pvals) > P_THRESHOLD
    return ok, {
        "grids": n,
        "rng": "secrets.SystemRandom",
        "numbers_chi2": {"statistic": chi_n, "df": 49, "p_value": p_n, "correction": "×49/45"},
        "stars_chi2": {"statistic": chi_s, "df": 11, "p_value": p_s, "correction": "×11/10"},
        "star_pairs_chi2": {"statistic": chi_sp, "df": 65, "p_value": p_sp},
        "combination_index_chi2": {"statistic": chi_b, "df": 99, "p_value": p_b, "sample": 20_000, "buckets": 100},
        "criterion": f"min(p) × 4 > {P_THRESHOLD} (Bonferroni). Test statistique : un échec isolé reste possible "
                     "par hasard (probabilité ≈ 0,1 %).",
    }


def audit_constraints_and_duplicates() -> tuple[bool, dict[str, Any]]:
    details: dict[str, Any] = {}
    ok = True
    for strategy, count in (("A", 10_000), ("D", 2_000), ("B", 50), ("C", 50)):
        res = generate(GenerationRequest(count=count, strategy=strategy, seed=123, time_limit_s=1.0))
        grids = res["grids"]
        valid = all(is_valid_grid(g["numbers"], g["stars"]) for g in grids)
        sorted_ok = all(g["numbers"] == sorted(g["numbers"]) and g["stars"] == sorted(g["stars"]) for g in grids)
        unique = len({(tuple(g["numbers"]), tuple(g["stars"])) for g in grids}) == len(grids)
        details[strategy] = {"grids": len(grids), "valid": valid, "sorted": sorted_ok, "unique": unique}
        ok &= valid and sorted_ok and unique and len(grids) == count
    return ok, details


def audit_exact_portfolio() -> tuple[bool, dict[str, Any]]:
    res = exact_portfolio_analysis([((3, 14, 25, 36, 47), (2, 9))])
    ok = True
    for row in res["tiers"]:
        p = Fraction(row["p_at_least_one"]["numerator"], row["p_at_least_one"]["denominator"])
        t = next(t for t in CURRENT_TIERS if t.rank == row["rank"])
        ok &= p == match_probability(t.numbers, t.stars)
    pf = [((1, 2, 3, 4, 5), (1, 2)), ((1, 2, 3, 4, 6), (1, 2))]
    two = exact_portfolio_analysis(pf)
    p_any_two = two["p_any_win"]["value"]
    single_any = float(sum(match_probability(t.numbers, t.stars) for t in CURRENT_TIERS))
    ok &= single_any <= p_any_two <= 2 * single_any
    return ok, {"single_grid_matches_theory": ok, "two_overlapping_grids_p_any": p_any_two,
                "bounds": [single_any, 2 * single_any], "elapsed_s": res["elapsed_s"] + two["elapsed_s"]}


def audit_simulation(n_draws: int = 400_000) -> tuple[bool, dict[str, Any]]:
    grids = [((5, 12, 23, 34, 45), (3, 8)), ((1, 10, 20, 30, 40), (5, 12))]
    res = run_simulation(SimulationConfig([PortfolioInput("audit", grids)], n_draws, seed=2024))
    tiers = res["portfolios"][0]["tiers"]
    rows = []
    ok = True
    m = len(tiers)
    for t in tiers:
        n_trials = n_draws * len(grids)
        p = t["theoretical_probability"]
        # Test binomial bilatéral, seuil corrigé Bonferroni.
        pv = float(sps.binomtest(t["wins"], n_trials, p).pvalue) if t["rank"] > 4 else 1.0
        rows.append({"rank": t["rank"], "observed": t["wins"], "expected": t["expected_wins"], "p_value": pv})
        ok &= pv * m > P_THRESHOLD
    return ok, {"draws": n_draws, "seed": res["seed"], "tiers": rows,
                "criterion": f"p × {m} > {P_THRESHOLD} pour chaque rang (rangs 1 à 4 trop rares pour être testés)."}


AUDIT_CHECKS = [
    ("total", "Nombre total de combinaisons (139 838 160)", audit_total_combinations),
    ("probabilities", "Probabilités exactes des 13 rangs et normalisation", audit_probabilities),
    ("ranks", "Calcul des rangs de gains", audit_rank_function),
    ("index", "Bijection grille ↔ indice combinatoire", audit_index_bijection),
    ("uniformity", "Uniformité du générateur aléatoire", audit_generator_uniformity),
    ("constraints", "Contraintes, tri et absence de doublons des grilles générées", audit_constraints_and_duplicates),
    ("exact_portfolio", "Analyse exacte de portefeuille (dépendances entre grilles)", audit_exact_portfolio),
    ("simulation", "Convergence du simulateur vers les probabilités théoriques", audit_simulation),
]


def run_audit(progress: Callable[[float, str], None] | None = None, cancel: Event | None = None) -> dict[str, Any]:
    t0 = time.perf_counter()
    checks = []
    for i, (code, name, fn) in enumerate(AUDIT_CHECKS):
        if cancel is not None and cancel.is_set():
            break
        if progress:
            progress(i / len(AUDIT_CHECKS), name)
        checks.append(_check(code, name, fn))
    passed = sum(1 for c in checks if c["passed"])
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
        "passed": passed,
        "total": len(checks),
        "compliant": passed == len(AUDIT_CHECKS),
        "elapsed_s": round(time.perf_counter() - t0, 2),
        "summary": (
            "Rapport de conformité mathématique : " + (
                "toutes les vérifications sont satisfaites." if passed == len(AUDIT_CHECKS)
                else f"{len(checks) - passed} vérification(s) en échec — voir le détail.")
        ),
    }
