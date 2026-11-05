"""Statistiques descriptives et tests statistiques sur l'historique des tirages.

Toutes les analyses de ce module sont **descriptives**. Un écart observé entre
fréquences historiques et fréquences théoriques ne constitue pas une capacité
prédictive : sous l'hypothèse de tirages équitables et indépendants, le passé
n'apporte aucune information sur le prochain tirage.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from math import comb, log
from typing import Any, Callable

import numpy as np
from scipy import stats as sps
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.combinatorics import combos_table
from app.core.rng import np_rng
from app.core.rules import CURRENT_ERA, ERAS, get_era
from app.models import Draw

PREDICTION_WARNING = (
    "Ces statistiques décrivent le passé. Elles ne permettent pas de conclure qu'un numéro "
    "a davantage ou moins de chances de sortir au prochain tirage."
)
GAP_WARNING = (
    "Un retard élevé ne signifie pas qu'un numéro est « dû » : sous l'hypothèse de tirages "
    "indépendants, sa probabilité au prochain tirage reste 5/50 = 10 %."
)


@dataclass
class DrawSet:
    dates: np.ndarray  # dtype object (datetime.date)
    numbers: np.ndarray  # (T, 5) int16 trié
    stars: np.ndarray  # (T, 2) int16 trié
    stars_max: np.ndarray  # (T,) int16
    era_codes: np.ndarray  # (T,) object

    @property
    def size(self) -> int:
        return int(self.numbers.shape[0])

    def subset(self, mask: np.ndarray) -> "DrawSet":
        return DrawSet(self.dates[mask], self.numbers[mask], self.stars[mask], self.stars_max[mask], self.era_codes[mask])

    def last(self, n: int | None) -> "DrawSet":
        if n is None or n >= self.size:
            return self
        sl = slice(self.size - n, self.size)
        return DrawSet(self.dates[sl], self.numbers[sl], self.stars[sl], self.stars_max[sl], self.era_codes[sl])

    @staticmethod
    def from_rows(rows: list[tuple[date, list[int], list[int], int, str]]) -> "DrawSet":
        rows = sorted(rows, key=lambda r: r[0])
        if not rows:
            return DrawSet(
                np.array([], dtype=object), np.zeros((0, 5), np.int16), np.zeros((0, 2), np.int16),
                np.zeros(0, np.int16), np.array([], dtype=object),
            )
        return DrawSet(
            np.array([r[0] for r in rows], dtype=object),
            np.array([sorted(r[1]) for r in rows], dtype=np.int16),
            np.array([sorted(r[2]) for r in rows], dtype=np.int16),
            np.array([r[3] for r in rows], dtype=np.int16),
            np.array([r[4] for r in rows], dtype=object),
        )


def load_drawset(
    db: Session,
    date_from: date | None = None,
    date_to: date | None = None,
    last_n: int | None = None,
    era: str | None = None,
) -> DrawSet:
    q = select(Draw).order_by(Draw.draw_date)
    if date_from:
        q = q.where(Draw.draw_date >= date_from)
    if date_to:
        q = q.where(Draw.draw_date <= date_to)
    if era:
        get_era(era)
        q = q.where(Draw.era_code == era)
    rows = [(d.draw_date, d.numbers, d.stars, d.stars_max, d.era_code) for d in db.scalars(q).all()]
    return DrawSet.from_rows(rows).last(last_n)


# ---------------------------------------------------------------------------
# Outils statistiques
# ---------------------------------------------------------------------------


def benjamini_hochberg(pvalues: np.ndarray) -> np.ndarray:
    """q-valeurs de Benjamini-Hochberg (contrôle du taux de fausses découvertes)."""
    p = np.asarray(pvalues, dtype=float)
    n = p.size
    if n == 0:
        return p
    order = np.argsort(p)
    ranked = p[order] * n / np.arange(1, n + 1)
    q = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(n)
    out[order] = np.clip(q, 0, 1)
    return out


def bonferroni(pvalues: np.ndarray) -> np.ndarray:
    p = np.asarray(pvalues, dtype=float)
    return np.clip(p * max(p.size, 1), 0, 1)


def two_sided_binom_p(k: np.ndarray, n: int, p: float) -> np.ndarray:
    k = np.asarray(k)
    lower = sps.binom.cdf(k, n, p)
    upper = sps.binom.sf(k - 1, n, p)
    return np.clip(2 * np.minimum(lower, upper), 0, 1)


def wilson_interval(successes: int, n: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    phat = successes / n
    denom = 1 + z**2 / n
    centre = (phat + z**2 / (2 * n)) / denom
    half = z * np.sqrt(phat * (1 - phat) / n + z**2 / (4 * n**2)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def chi_square_gof(observed: np.ndarray, expected: np.ndarray, min_expected: float = 5.0,
                   ddof: int = 0, scale: float = 1.0) -> dict[str, Any]:
    """Test du khi-deux d'adéquation, avec regroupement des classes d'effectif attendu < 5.

    ``scale`` corrige la statistique quand les comptages ne suivent pas une loi
    multinomiale (tirage sans remise de m éléments parmi K : facteur (K−1)/(K−m)).
    """
    obs = np.asarray(observed, dtype=float)
    exp = np.asarray(expected, dtype=float)
    if exp.sum() <= 0:
        return {"statistic": None, "df": 0, "p_value": None, "bins": 0}
    # Regroupement séquentiel des classes trop petites.
    o_b, e_b = [], []
    acc_o = acc_e = 0.0
    for o, e in zip(obs, exp):
        acc_o += o
        acc_e += e
        if acc_e >= min_expected:
            o_b.append(acc_o)
            e_b.append(acc_e)
            acc_o = acc_e = 0.0
    if acc_e > 0:
        if e_b:
            o_b[-1] += acc_o
            e_b[-1] += acc_e
        else:
            o_b.append(acc_o)
            e_b.append(acc_e)
    o_arr, e_arr = np.array(o_b), np.array(e_b)
    df = len(o_arr) - 1 - ddof
    if df <= 0:
        return {"statistic": None, "df": df, "p_value": None, "bins": len(o_arr)}
    stat = float(((o_arr - e_arr) ** 2 / e_arr).sum() * scale)
    return {"statistic": stat, "df": int(df), "p_value": float(sps.chi2.sf(stat, df)), "bins": len(o_arr)}


def _ranks_desc(values: np.ndarray) -> np.ndarray:
    """Rang 1 = valeur la plus élevée (ex aequo : rang minimal)."""
    return sps.rankdata(-np.asarray(values, dtype=float), method="min").astype(int)


# ---------------------------------------------------------------------------
# Distributions théoriques exactes (énumération des 2 118 760 combinaisons)
# ---------------------------------------------------------------------------


def _feature_sum(t: np.ndarray) -> np.ndarray:
    return t.sum(axis=1)


def _feature_even(t: np.ndarray) -> np.ndarray:
    return (t % 2 == 0).sum(axis=1)


def _feature_consecutive(t: np.ndarray) -> np.ndarray:
    return (np.diff(t, axis=1) == 1).sum(axis=1)


def _feature_min_gap(t: np.ndarray) -> np.ndarray:
    return np.diff(t, axis=1).min(axis=1)


def _feature_max_gap(t: np.ndarray) -> np.ndarray:
    return np.diff(t, axis=1).max(axis=1)


def _feature_distinct_decades(t: np.ndarray) -> np.ndarray:
    dec = (t - 1) // 10
    s = np.sort(dec, axis=1)
    return 1 + (np.diff(s, axis=1) != 0).sum(axis=1)


def _feature_max_per_decade(t: np.ndarray) -> np.ndarray:
    dec = (t - 1) // 10
    counts = np.stack([(dec == d).sum(axis=1) for d in range(5)], axis=1)
    return counts.max(axis=1)


FEATURES: dict[str, Callable[[np.ndarray], np.ndarray]] = {
    "sum": _feature_sum,
    "even": _feature_even,
    "consecutive": _feature_consecutive,
    "min_gap": _feature_min_gap,
    "max_gap": _feature_max_gap,
    "distinct_decades": _feature_distinct_decades,
    "max_per_decade": _feature_max_per_decade,
}


@lru_cache(maxsize=16)
def exact_feature_distribution(feature: str) -> tuple[np.ndarray, np.ndarray]:
    """Valeurs possibles et probabilités exactes d'une caractéristique d'un tirage."""
    table = combos_table().astype(np.int16)
    values = FEATURES[feature](table)
    vmin = int(values.min())
    counts = np.bincount(values - vmin)
    support = np.arange(vmin, vmin + counts.size)
    keep = counts > 0
    return support[keep], counts[keep] / comb(50, 5)


def _observed_vs_theory(feature: str, ds: DrawSet) -> dict[str, Any]:
    support, probs = exact_feature_distribution(feature)
    obs_vals = FEATURES[feature](ds.numbers.astype(np.int16)) if ds.size else np.array([], dtype=int)
    idx = {int(v): i for i, v in enumerate(support)}
    observed = np.zeros(support.size)
    for v in obs_vals:
        observed[idx[int(v)]] += 1
    expected = probs * ds.size
    test = chi_square_gof(observed, expected)
    theo_mean = float((support * probs).sum())
    theo_sd = float(np.sqrt(((support - theo_mean) ** 2 * probs).sum()))
    return {
        "distribution": [
            {"value": int(v), "observed": int(o), "observed_pct": (float(o) / ds.size if ds.size else 0.0),
             "expected": float(e), "theoretical_pct": float(p)}
            for v, o, e, p in zip(support, observed, expected, probs)
        ],
        "observed_mean": float(obs_vals.mean()) if ds.size else None,
        "observed_sd": float(obs_vals.std(ddof=1)) if ds.size > 1 else None,
        "theoretical_mean": theo_mean,
        "theoretical_sd": theo_sd,
        "test": {
            **test,
            "name": "Khi-deux d'adéquation à la distribution théorique exacte",
            "hypotheses": "H0 : tirages équitables et indépendants. Classes d'effectif attendu < 5 regroupées.",
        },
    }


# ---------------------------------------------------------------------------
# Fréquences
# ---------------------------------------------------------------------------

WINDOWS = (20, 50, 100, 500)


def _one_hot(values: np.ndarray, size: int) -> np.ndarray:
    T = values.shape[0]
    x = np.zeros((T, size), dtype=np.int8)
    if T:
        rows = np.repeat(np.arange(T), values.shape[1])
        x[rows, values.ravel() - 1] = 1
    return x


def number_frequencies(ds: DrawSet) -> dict[str, Any]:
    T = ds.size
    p = 5 / 50
    x = _one_hot(ds.numbers, 50)
    counts = x.sum(axis=0).astype(int)
    expected = T * p
    sd = np.sqrt(T * p * (1 - p)) if T else 1.0
    z = (counts - expected) / sd if T else np.zeros(50)
    pvals = two_sided_binom_p(counts, T, p) if T else np.ones(50)
    q = benjamini_hochberg(pvals)
    window_counts = {w: x[-w:].sum(axis=0).astype(int) for w in WINDOWS if T}
    window_ranks = {w: _ranks_desc(c) for w, c in window_counts.items()}
    last_seen = _current_gaps(x)
    rows = []
    rank_all = _ranks_desc(counts)
    for i in range(50):
        rows.append({
            "value": i + 1,
            "count": int(counts[i]),
            "frequency": float(counts[i] / T) if T else 0.0,
            "expected": float(expected),
            "expected_frequency": p,
            "deviation": float(counts[i] - expected),
            "deviation_pct": float((counts[i] - expected) / expected * 100) if expected else 0.0,
            "z_score": float(z[i]),
            "p_value": float(pvals[i]),
            "q_value_bh": float(q[i]),
            "significant_bh": bool(q[i] < 0.05),
            "rank": int(rank_all[i]),
            "window_counts": {str(w): int(c[i]) for w, c in window_counts.items()},
            "window_ranks": {str(w): int(r[i]) for w, r in window_ranks.items()},
            "current_gap": int(last_seen[i]) if last_seen[i] >= 0 else None,
        })
    chi = chi_square_gof(counts, np.full(50, expected), scale=49 / 45) if T else {"statistic": None, "df": 0, "p_value": None}
    return {
        "draws": T,
        "items": rows,
        "uniformity_test": {
            **chi,
            "name": "Khi-deux d'uniformité des 50 numéros (corrigé tirage sans remise, facteur 49/45)",
            "hypotheses": (
                "H0 : chaque numéro a une probabilité 5/50 à chaque tirage, tirages indépendants. "
                "La statistique est multipliée par (K−1)/(K−m) = 49/45 car les 5 numéros d'un tirage sont distincts."
            ),
        },
        "multiple_testing": (
            "50 tests individuels (binomiaux bilatéraux) : q-valeurs de Benjamini-Hochberg. "
            "Un numéro n'est signalé que si q < 0,05."
        ),
        "warning": PREDICTION_WARNING,
    }


def star_frequencies(ds: DrawSet) -> dict[str, Any]:
    """Fréquences des étoiles, corrigées de l'exposition selon les époques (9, 11 puis 12 étoiles)."""
    T = ds.size
    smax = 12
    x = _one_hot(ds.stars, smax)
    counts = x.sum(axis=0).astype(int)
    p_draw = np.zeros((T, smax))
    for s in range(smax):
        eligible = ds.stars_max >= s + 1
        p_draw[:, s] = np.where(eligible, 2.0 / ds.stars_max.clip(min=1), 0.0)
    expected = p_draw.sum(axis=0)
    var = (p_draw * (1 - p_draw)).sum(axis=0)
    eligible_draws = (p_draw > 0).sum(axis=0)
    rows = []
    pvals = np.ones(smax)
    dist_cache: dict[tuple, Any] = {}
    for s in range(smax):
        if eligible_draws[s] == 0:
            continue
        probs = np.sort(p_draw[p_draw[:, s] > 0, s])
        key = tuple(np.unique(probs, return_counts=True)[1].tolist()) + tuple(np.unique(probs).round(12).tolist())
        if key not in dist_cache:
            dist_cache[key] = sps.poisson_binom(probs)
        dist = dist_cache[key]
        k = counts[s]
        pvals[s] = float(np.clip(2 * min(dist.cdf(k), dist.sf(k - 1)), 0, 1))
    q = benjamini_hochberg(pvals[eligible_draws > 0]) if (eligible_draws > 0).any() else np.array([])
    q_full = np.ones(smax)
    q_full[eligible_draws > 0] = q
    window_counts = {w: x[-w:].sum(axis=0).astype(int) for w in WINDOWS if T}
    window_ranks = {w: _ranks_desc(c) for w, c in window_counts.items()}
    rank_all = _ranks_desc(counts)
    last_seen = _current_gaps(x)
    for s in range(smax):
        rows.append({
            "value": s + 1,
            "count": int(counts[s]),
            "eligible_draws": int(eligible_draws[s]),
            "frequency": float(counts[s] / eligible_draws[s]) if eligible_draws[s] else 0.0,
            "expected": float(expected[s]),
            "expected_frequency": float(expected[s] / eligible_draws[s]) if eligible_draws[s] else 0.0,
            "deviation": float(counts[s] - expected[s]),
            "deviation_pct": float((counts[s] - expected[s]) / expected[s] * 100) if expected[s] else 0.0,
            "z_score": float((counts[s] - expected[s]) / np.sqrt(var[s])) if var[s] > 0 else 0.0,
            "p_value": float(pvals[s]),
            "q_value_bh": float(q_full[s]),
            "significant_bh": bool(q_full[s] < 0.05),
            "rank": int(rank_all[s]),
            "window_counts": {str(w): int(c[s]) for w, c in window_counts.items()},
            "window_ranks": {str(w): int(r[s]) for w, r in window_ranks.items()},
            "current_gap": int(last_seen[s]) if last_seen[s] >= 0 else None,
        })
    current = ds.subset(ds.era_codes == CURRENT_ERA.code) if T else ds
    xc = _one_hot(current.stars, 12)
    cc = xc.sum(axis=0)
    chi = (chi_square_gof(cc, np.full(12, current.size * 2 / 12), scale=11 / 10)
           if current.size else {"statistic": None, "df": 0, "p_value": None})
    eras_present = sorted({str(e) for e in ds.era_codes})
    return {
        "draws": T,
        "items": rows,
        "eras_present": eras_present,
        "uniformity_test": {
            **chi,
            "draws_used": current.size,
            "name": "Khi-deux d'uniformité des 12 étoiles (époque actuelle uniquement, facteur 11/10)",
            "hypotheses": "H0 : chaque étoile a une probabilité 2/12 à chaque tirage depuis le 27/09/2016.",
        },
        "exposure_note": (
            "Les étoiles 10 et 11 n'existent que depuis mai 2011 et l'étoile 12 depuis septembre 2016. "
            "Les effectifs attendus tiennent compte du nombre d'étoiles en jeu à chaque tirage "
            "(2/9, 2/11 ou 2/12) ; les p-valeurs utilisent la loi de Poisson-binomiale exacte."
        ),
        "warning": PREDICTION_WARNING,
    }


def hot_cold(ds: DrawSet, kind: str = "numbers", window: int | None = 50, top: int = 10) -> dict[str, Any]:
    sub = ds.last(window)
    freq = number_frequencies(sub) if kind == "numbers" else star_frequencies(sub)
    items = [i for i in freq["items"] if kind == "numbers" or i["eligible_draws"] > 0]
    ordered = sorted(items, key=lambda i: (-i["count"], i["value"]))
    return {
        "window": sub.size,
        "kind": kind,
        "hot": ordered[:top],
        "cold": list(reversed(ordered[-top:])),
        "warning": PREDICTION_WARNING,
    }


# ---------------------------------------------------------------------------
# Retards et intervalles d'apparition
# ---------------------------------------------------------------------------


def _current_gaps(x: np.ndarray) -> np.ndarray:
    T, K = x.shape
    out = np.full(K, -1, dtype=int)
    for k in range(K):
        idx = np.flatnonzero(x[:, k])
        if idx.size:
            out[k] = T - 1 - idx[-1]
    return out


def gaps(ds: DrawSet, kind: str = "numbers") -> dict[str, Any]:
    if kind == "numbers":
        x = _one_hot(ds.numbers, 50)
        p = 0.1
        eligible = np.ones((ds.size, 50), dtype=bool)
    else:
        x = _one_hot(ds.stars, 12)
        eligible = np.stack([ds.stars_max >= s + 1 for s in range(12)], axis=1) if ds.size else np.zeros((0, 12), bool)
        p = 2 / 12
    K = x.shape[1]
    rows = []
    all_intervals: list[int] = []
    for k in range(K):
        col = x[eligible[:, k], k] if ds.size else np.array([], dtype=np.int8)
        n_elig = col.size
        idx = np.flatnonzero(col)
        intervals = np.diff(idx) if idx.size > 1 else np.array([], dtype=int)
        all_intervals.extend(intervals.tolist())
        current = int(n_elig - 1 - idx[-1]) if idx.size else None
        rows.append({
            "value": k + 1,
            "appearances": int(idx.size),
            "current_gap": current,
            "never_seen": idx.size == 0,
            "mean_interval": float(intervals.mean()) if intervals.size else None,
            "max_interval": int(intervals.max()) if intervals.size else None,
            "max_gap_including_current": int(max(intervals.max() if intervals.size else 0, current or 0)),
            "eligible_draws": int(n_elig),
        })
    arr = np.array(all_intervals, dtype=int)
    hist = []
    if arr.size:
        cap = int(np.percentile(arr, 99)) + 1
        bins = np.bincount(np.minimum(arr, cap))
        total = arr.size
        for g in range(1, bins.size):
            theo = (1 - p) ** (g - 1) * p if g < cap else (1 - p) ** (g - 1)
            hist.append({"interval": g, "label": f"≥ {g}" if g == cap else str(g),
                         "observed": int(bins[g]), "observed_pct": float(bins[g] / total),
                         "theoretical_pct": float(theo)})
    return {
        "kind": kind,
        "draws": ds.size,
        "items": rows,
        "theoretical_mean_interval": 1 / p,
        "interval_distribution": hist,
        "assumptions": (
            f"Sous H0, l'intervalle entre deux apparitions suit une loi géométrique de paramètre p = {p:.4f} "
            f"(moyenne 1/p = {1 / p:.1f} tirages)." + (" Étoiles : paramètre de l'époque actuelle (2/12) ; seuls les tirages "
                                                         "où l'étoile existait sont comptés." if kind == 'stars' else "")
        ),
        "warning": GAP_WARNING,
    }


# ---------------------------------------------------------------------------
# Paires, triplets, cooccurrences
# ---------------------------------------------------------------------------

P_PAIR = comb(48, 3) / comb(50, 5)
P_TRIPLE = comb(47, 2) / comb(50, 5)


def cooccurrence_matrix(ds: DrawSet) -> dict[str, Any]:
    x = _one_hot(ds.numbers, 50).astype(np.int32)
    c = x.T @ x
    np.fill_diagonal(c, 0)
    return {"size": 50, "matrix": c.tolist(), "expected_pair": float(ds.size * P_PAIR), "draws": ds.size}


def pairs(ds: DrawSet, top: int = 25) -> dict[str, Any]:
    T = ds.size
    x = _one_hot(ds.numbers, 50).astype(np.int32)
    c = x.T @ x
    iu = np.triu_indices(50, k=1)
    counts = c[iu]
    pvals = two_sided_binom_p(counts, T, P_PAIR) if T else np.ones(counts.size)
    q = benjamini_hochberg(pvals)
    order = np.lexsort((iu[1], iu[0], -counts))
    def row(i: int) -> dict[str, Any]:
        return {"a": int(iu[0][i] + 1), "b": int(iu[1][i] + 1), "count": int(counts[i]),
                "expected": float(T * P_PAIR), "p_value": float(pvals[i]), "q_value_bh": float(q[i]),
                "significant_bh": bool(q[i] < 0.05)}
    return {
        "draws": T,
        "expected": float(T * P_PAIR),
        "most_frequent": [row(i) for i in order[:top]],
        "least_frequent": [row(i) for i in order[::-1][:top]],
        "significant_count": int((q < 0.05).sum()),
        "tests": 1225,
        "multiple_testing": "1 225 paires testées : correction de Benjamini-Hochberg (q < 0,05).",
        "hypotheses": "H0 : chaque paire apparaît dans un tirage avec probabilité C(48,3)/C(50,5) = 2/245.",
        "warning": PREDICTION_WARNING,
    }


_COMB_LOOKUP = np.array([[comb(n, k) for k in range(6)] for n in range(51)], dtype=np.int64)


def triples(ds: DrawSet, top: int = 25) -> dict[str, Any]:
    T = ds.size
    counts = np.zeros(comb(50, 3), dtype=np.int64)
    if T:
        nums = ds.numbers.astype(np.int64)
        idx_sets = [(i, j, k) for i in range(5) for j in range(i + 1, 5) for k in range(j + 1, 5)]
        for i, j, k in idx_sets:
            r = _COMB_LOOKUP[nums[:, i] - 1, 1] + _COMB_LOOKUP[nums[:, j] - 1, 2] + _COMB_LOOKUP[nums[:, k] - 1, 3]
            counts += np.bincount(r, minlength=counts.size)
    table = combos_table(50, 3)
    pvals = two_sided_binom_p(counts, T, P_TRIPLE) if T else np.ones(counts.size)
    q = benjamini_hochberg(pvals)
    order = np.argsort(-counts, kind="stable")
    def row(i: int) -> dict[str, Any]:
        return {"values": [int(v) for v in table[i]], "count": int(counts[i]), "expected": float(T * P_TRIPLE),
                "p_value": float(pvals[i]), "q_value_bh": float(q[i]), "significant_bh": bool(q[i] < 0.05)}
    observed_max = int(counts.max()) if T else 0
    return {
        "draws": T,
        "expected": float(T * P_TRIPLE),
        "most_frequent": [row(i) for i in order[:top]],
        "never_seen": int((counts == 0).sum()),
        "never_seen_expected": float(counts.size * (1 - P_TRIPLE) ** T) if T else float(counts.size),
        "observed_max": observed_max,
        "significant_count": int((q < 0.05).sum()),
        "tests": int(counts.size),
        "multiple_testing": "19 600 triplets testés : correction de Benjamini-Hochberg (q < 0,05).",
        "hypotheses": "H0 : chaque triplet apparaît dans un tirage avec probabilité C(47,2)/C(50,5) = 1/1960.",
        "warning": PREDICTION_WARNING,
    }


def star_pairs(ds: DrawSet) -> dict[str, Any]:
    T = ds.size
    pairs_list = [(a, b) for a in range(1, 13) for b in range(a + 1, 13)]
    observed = {pr: 0 for pr in pairs_list}
    for s1, s2 in ds.stars.tolist():
        observed[(s1, s2)] += 1
    rows = []
    pvals = []
    era_sizes = {int(m): int((ds.stars_max == m).sum()) for m in np.unique(ds.stars_max)} if T else {}
    dist_cache: dict[tuple, Any] = {}
    for a, b in pairs_list:
        key = tuple(sorted((m, c) for m, c in era_sizes.items() if b <= m))
        probs = np.concatenate([np.full(c, 1 / comb(m, 2)) for m, c in key]) if key else np.array([])
        exp = float(probs.sum())
        k = observed[(a, b)]
        if probs.size:
            if key not in dist_cache:
                dist_cache[key] = sps.poisson_binom(probs)
            dist = dist_cache[key]
            pv = float(np.clip(2 * min(dist.cdf(k), dist.sf(k - 1)), 0, 1))
        else:
            pv = 1.0
        pvals.append(pv)
        rows.append({"a": a, "b": b, "count": k, "expected": exp, "eligible_draws": int(probs.size), "p_value": pv})
    q = benjamini_hochberg(np.array(pvals))
    for r, qq in zip(rows, q):
        r["q_value_bh"] = float(qq)
        r["significant_bh"] = bool(qq < 0.05)
    matrix = [[0] * 12 for _ in range(12)]
    for r in rows:
        matrix[r["a"] - 1][r["b"] - 1] = matrix[r["b"] - 1][r["a"] - 1] = r["count"]
    return {
        "draws": T,
        "items": sorted(rows, key=lambda r: (-r["count"], r["a"], r["b"])),
        "matrix": matrix,
        "multiple_testing": "66 paires d'étoiles : correction de Benjamini-Hochberg.",
        "hypotheses": "Effectif attendu = somme sur les tirages où la paire existait de 1/C(S,2), S = 9, 11 ou 12.",
        "warning": PREDICTION_WARNING,
    }


# ---------------------------------------------------------------------------
# Structure des tirages
# ---------------------------------------------------------------------------


def parity(ds: DrawSet) -> dict[str, Any]:
    out = _observed_vs_theory("even", ds)
    out["description"] = "Nombre de numéros pairs dans le tirage (25 pairs, 25 impairs entre 1 et 50)."
    return out


def sums(ds: DrawSet) -> dict[str, Any]:
    out = _observed_vs_theory("sum", ds)
    # Regroupement par classes de 10 pour l'affichage.
    support, probs = exact_feature_distribution("sum")
    obs_vals = ds.numbers.sum(axis=1) if ds.size else np.array([])
    edges = list(range(10, 251, 10))
    binned = []
    for lo in edges[:-1]:
        hi = lo + 10
        mask = (support >= lo) & (support < hi)
        binned.append({"label": f"{lo}–{hi - 1}", "from": lo, "to": hi - 1,
                       "observed": int(((obs_vals >= lo) & (obs_vals < hi)).sum()),
                       "theoretical_pct": float(probs[mask].sum()),
                       "expected": float(probs[mask].sum() * ds.size)})
    out["binned"] = [b for b in binned if b["theoretical_pct"] > 0]
    out["description"] = "Somme des cinq numéros (de 15 à 240). Distribution théorique exacte par énumération."
    return out


def decades(ds: DrawSet) -> dict[str, Any]:
    T = ds.size
    labels = ["1–10", "11–20", "21–30", "31–40", "41–50"]
    dec = (ds.numbers.astype(int) - 1) // 10 if T else np.zeros((0, 5), int)
    counts = np.array([(dec == d).sum() for d in range(5)])
    expected = np.full(5, T * 5 / 5)
    chi = chi_square_gof(counts, expected, scale=49 / 45) if T else {"statistic": None, "df": 0, "p_value": None}
    return {
        "draws": T,
        "buckets": [{"label": l, "count": int(c), "expected": float(e)} for l, c, e in zip(labels, counts, expected)],
        "bucket_test": {**chi, "name": "Khi-deux sur les dizaines (approximation, facteur 49/45)",
                        "hypotheses": "H0 : chaque dizaine reçoit en moyenne 1 numéro par tirage."},
        "distinct_decades": _observed_vs_theory("distinct_decades", ds),
        "max_per_decade": _observed_vs_theory("max_per_decade", ds),
    }


def spacing(ds: DrawSet) -> dict[str, Any]:
    return {
        "draws": ds.size,
        "min_gap": _observed_vs_theory("min_gap", ds),
        "max_gap": _observed_vs_theory("max_gap", ds),
        "description": "Écarts entre numéros triés consécutifs (n2−n1, …, n5−n4).",
    }


def consecutive(ds: DrawSet) -> dict[str, Any]:
    out = _observed_vs_theory("consecutive", ds)
    out["description"] = "Nombre de paires de numéros consécutifs dans le tirage (ex. 12-13)."
    return out


def repeats(ds: DrawSet) -> dict[str, Any]:
    T = ds.size
    res: dict[str, Any] = {"draws": T}
    if T < 2:
        res.update({"numbers": None, "stars": None})
        return res
    common = np.array([len(set(a) & set(b)) for a, b in zip(ds.numbers[:-1].tolist(), ds.numbers[1:].tolist())])
    theo = np.array([comb(5, k) * comb(45, 5 - k) / comb(50, 5) for k in range(6)])
    obs = np.bincount(common, minlength=6)
    res["numbers"] = {
        "distribution": [{"value": k, "observed": int(obs[k]), "expected": float(theo[k] * (T - 1)),
                          "theoretical_pct": float(theo[k])} for k in range(6)],
        "observed_mean": float(common.mean()),
        "theoretical_mean": 0.5,
        "test": {**chi_square_gof(obs, theo * (T - 1)), "name": "Khi-deux (loi hypergéométrique)",
                 "hypotheses": "H0 : tirages indépendants ; P(k communs) = C(5,k)·C(45,5−k)/C(50,5)."},
    }
    same_era = ds.stars_max[:-1] == ds.stars_max[1:]
    s_common = np.array([len(set(a) & set(b)) for a, b, ok in
                         zip(ds.stars[:-1].tolist(), ds.stars[1:].tolist(), same_era) if ok])
    s_max = ds.stars_max[1:][same_era]
    if s_common.size:
        theo_s = np.zeros(3)
        for m in s_max:
            m = int(m)
            theo_s += np.array([comb(2, k) * comb(m - 2, 2 - k) / comb(m, 2) for k in range(3)])
        obs_s = np.bincount(s_common, minlength=3)
        res["stars"] = {
            "distribution": [{"value": k, "observed": int(obs_s[k]), "expected": float(theo_s[k]),
                              "theoretical_pct": float(theo_s[k] / s_common.size)} for k in range(3)],
            "test": {**chi_square_gof(obs_s, theo_s), "name": "Khi-deux (loi hypergéométrique, par époque)"},
        }
    else:
        res["stars"] = None
    return res


def _entropy(counts: np.ndarray) -> float:
    total = counts.sum()
    if total == 0:
        return 0.0
    p = counts[counts > 0] / total
    return float(-(p * np.log(p)).sum())


def _gini(counts: np.ndarray) -> float:
    x = np.sort(counts.astype(float))
    n = x.size
    if x.sum() == 0:
        return 0.0
    return float((2 * np.arange(1, n + 1) - n - 1).dot(x) / (n * x.sum()))


def entropy(ds: DrawSet, n_sim: int = 400, seed: int | None = 12345, window: int = 100) -> dict[str, Any]:
    T = ds.size
    counts = np.bincount(ds.numbers.ravel().astype(int) - 1, minlength=50) if T else np.zeros(50, int)
    h = _entropy(counts)
    hmax = log(50)
    top10 = float(np.sort(counts)[::-1][:10].sum() / counts.sum()) if T else 0.0
    sim_h = np.array([])
    if T:
        rng, used_seed = np_rng(seed)
        table = combos_table()
        sim_h = np.empty(n_sim)
        for i in range(n_sim):
            idx = rng.integers(0, table.shape[0], T)
            c = np.bincount(table[idx].ravel().astype(int) - 1, minlength=50)
            sim_h[i] = _entropy(c)
    else:
        used_seed = seed
    series = []
    if T >= window:
        step = max(1, (T - window) // 200)
        for end in range(window, T + 1, step):
            c = np.bincount(ds.numbers[end - window:end].ravel().astype(int) - 1, minlength=50)
            series.append({"index": end, "date": ds.dates[end - 1].isoformat(), "normalized_entropy": _entropy(c) / hmax})
    return {
        "draws": T,
        "entropy": h,
        "max_entropy": hmax,
        "normalized_entropy": h / hmax if T else None,
        "gini": _gini(counts),
        "top10_share": top10,
        "top10_share_expected": 0.2,
        "simulation": {
            "n_sim": int(sim_h.size),
            "seed": used_seed,
            "mean": float(sim_h.mean()) if sim_h.size else None,
            "p5": float(np.percentile(sim_h, 5)) if sim_h.size else None,
            "p95": float(np.percentile(sim_h, 95)) if sim_h.size else None,
            "p_value_low": float((np.sum(sim_h <= h) + 1) / (sim_h.size + 1)) if sim_h.size else None,
        },
        "rolling": series,
        "rolling_window": window,
        "hypotheses": (
            "L'entropie de Shannon des fréquences mesure la dispersion des tirages. Même sous H0 elle est "
            "inférieure au maximum ln(50) : la référence est donc la distribution simulée sous H0 avec le même "
            "nombre de tirages (graine enregistrée). p_value_low = P(entropie simulée ≤ observée)."
        ),
    }


def history_curve(ds: DrawSet, values: list[int], kind: str = "numbers", max_points: int = 300) -> dict[str, Any]:
    T = ds.size
    size = 50 if kind == "numbers" else 12
    x = _one_hot(ds.numbers if kind == "numbers" else ds.stars, size)
    cum = np.cumsum(x, axis=0)
    step = max(1, T // max_points)
    idx = list(range(step - 1, T, step))
    if T and idx[-1] != T - 1:
        idx.append(T - 1)
    pts = []
    for i in idx:
        pt: dict[str, Any] = {"index": i + 1, "date": ds.dates[i].isoformat()}
        for v in values:
            if 1 <= v <= size:
                pt[str(v)] = int(cum[i, v - 1])
        pt["expected"] = (i + 1) * (5 / 50 if kind == "numbers" else 2 / 12)
        pts.append(pt)
    return {"kind": kind, "values": values, "points": pts,
            "note": "Effectifs cumulés ; « expected » = effectif cumulé attendu sous H0 (époque actuelle pour les étoiles)."}


def statistical_tests(ds: DrawSet) -> dict[str, Any]:
    """Synthèse des tests globaux, avec correction pour comparaisons multiples."""
    tests = []
    nf = number_frequencies(ds)
    tests.append(("uniformite_numeros", nf["uniformity_test"]))
    sf = star_frequencies(ds)
    tests.append(("uniformite_etoiles", sf["uniformity_test"]))
    for name, fn in (("parite", parity), ("sommes", sums), ("consecutifs", consecutive)):
        tests.append((name, fn(ds)["test"]))
    rep = repeats(ds)
    if rep.get("numbers"):
        tests.append(("repetitions", rep["numbers"]["test"]))
    dec = decades(ds)
    tests.append(("dizaines", dec["bucket_test"]))
    pv = np.array([t["p_value"] if t.get("p_value") is not None else 1.0 for _, t in tests])
    q = benjamini_hochberg(pv)
    bonf = bonferroni(pv)
    out = []
    for (code, t), qq, bb in zip(tests, q, bonf):
        out.append({"code": code, **t, "q_value_bh": float(qq), "p_bonferroni": float(bb),
                    "reject_h0_5pct_bh": bool(t.get("p_value") is not None and qq < 0.05)})
    return {
        "draws": ds.size,
        "tests": out,
        "interpretation": (
            "Un rejet de H0 signalerait un écart descriptif à la distribution théorique sur la période étudiée. "
            "Il ne démontre pas qu'un futur tirage est prévisible ; il faudrait le confirmer sur des données "
            "nouvelles (mode recherche confirmatoire). Avec de nombreux tests, des p-valeurs faibles apparaissent "
            "par hasard : seules les valeurs corrigées (BH, Bonferroni) sont à considérer."
        ),
    }


def overview(ds: DrawSet) -> dict[str, Any]:
    T = ds.size
    if T == 0:
        return {"draws": 0}
    counts = np.bincount(ds.numbers.ravel().astype(int) - 1, minlength=50)
    eras = []
    for era in ERAS:
        n = int((ds.era_codes == era.code).sum())
        if n:
            eras.append({"code": era.code, "label": era.label, "draws": n})
    last = {"date": ds.dates[-1].isoformat(), "numbers": ds.numbers[-1].tolist(), "stars": ds.stars[-1].tolist()}
    return {
        "draws": T,
        "first_date": ds.dates[0].isoformat(),
        "last_date": ds.dates[-1].isoformat(),
        "last_draw": last,
        "eras": eras,
        "most_drawn_number": int(np.argmax(counts) + 1),
        "least_drawn_number": int(np.argmin(counts) + 1),
        "mean_sum": float(ds.numbers.sum(axis=1).mean()),
        "theoretical_mean_sum": 127.5,
        "warning": PREDICTION_WARNING,
    }
