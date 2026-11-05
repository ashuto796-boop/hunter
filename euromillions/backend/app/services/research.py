"""Mode recherche : tests d'hypothèses reproductibles contre un modèle aléatoire.

Chaque expérience enregistre sa graine : la relancer avec les mêmes paramètres
redonne exactement le même résultat. La distribution de référence (H0) est
obtenue par simulation de tirages équitables et indépendants.

Distinction exploratoire / confirmatoire :
* exploratoire : libre, multiple, sert à formuler des hypothèses ; ses
  p-valeurs ne sont pas des preuves ;
* confirmatoire : une hypothèse précise, testée une fois, sur une période qui
  n'a servi à aucune exploration de la même hypothèse.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import numpy as np

from app.core.combinatorics import combos_table
from app.core.rng import np_rng
from app.services.statistics import DrawSet, FEATURES

HYPOTHESES: dict[str, dict[str, Any]] = {
    "hot_next": {
        "title": "Les numéros « chauds » sortent plus souvent au tirage suivant",
        "metric": "Bons numéros moyens parmi les k numéros les plus fréquents sur les W tirages précédents",
        "alternative": "greater",
        "params": {"k": 5, "window": 50},
    },
    "overdue_next": {
        "title": "Les numéros « en retard » sortent plus souvent au tirage suivant",
        "metric": "Bons numéros moyens parmi les k numéros au plus fort retard",
        "alternative": "greater",
        "params": {"k": 5},
    },
    "repeat_previous": {
        "title": "Les numéros du tirage précédent ressortent plus (ou moins) souvent",
        "metric": "Nombre moyen de numéros communs avec le tirage précédent (H0 : 0,5)",
        "alternative": "two-sided",
        "params": {},
    },
    "sum_mean": {
        "title": "La somme moyenne des numéros diffère de la valeur théorique 127,5",
        "metric": "Somme moyenne des cinq numéros",
        "alternative": "two-sided",
        "params": {},
    },
    "even_mean": {
        "title": "Le nombre moyen de numéros pairs diffère de 2,5",
        "metric": "Nombre moyen de numéros pairs",
        "alternative": "two-sided",
        "params": {},
    },
    "consecutive_mean": {
        "title": "Les numéros consécutifs sont plus ou moins fréquents que prévu",
        "metric": "Nombre moyen de paires consécutives par tirage",
        "alternative": "two-sided",
        "params": {},
    },
    "uniformity": {
        "title": "Les 50 numéros ne sortent pas avec la même fréquence",
        "metric": "Statistique du khi-deux d'uniformité (non corrigée)",
        "alternative": "greater",
        "params": {},
    },
}


@dataclass
class ResearchConfig:
    hypothesis: str
    n_sim: int = 2000
    seed: int | None = None
    alpha: float = 0.05
    params: dict[str, Any] | None = None


def _hits_selection(ds: DrawSet, select: Callable[[np.ndarray, np.ndarray, int], np.ndarray], k: int,
                    warmup: int) -> np.ndarray:
    T = ds.size
    x = np.zeros((T, 50), dtype=np.int8)
    x[np.repeat(np.arange(T), 5), ds.numbers.ravel() - 1] = 1
    cum = np.vstack([np.zeros((1, 50), np.int32), np.cumsum(x, axis=0, dtype=np.int32)])
    last = np.full(50, -1)
    hits = []
    for t in range(T):
        if t >= warmup:
            chosen = select(cum, last, t)[:k]
            hits.append(int(x[t, chosen].sum()))
        last = np.where(x[t] > 0, t, last)
    return np.array(hits)


def _observed(ds: DrawSet, code: str, params: dict[str, Any]) -> tuple[float, int, dict[str, Any]]:
    """Valeur observée de la métrique, nombre d'unités (tirages évalués), informations de calcul."""
    if code == "hot_next":
        k, w = int(params["k"]), int(params["window"])
        if not 1 <= k <= 20 or not 5 <= w <= 1000:
            raise ValueError("Paramètres invalides : 1 ≤ k ≤ 20, 5 ≤ fenêtre ≤ 1000.")
        def sel(cum, last, t):
            counts = cum[t] - cum[max(0, t - w)]
            return np.lexsort((np.arange(50), -counts))
        hits = _hits_selection(ds, sel, k, w)
        return float(hits.mean()), hits.size, {"k": k, "window": w, "expected_h0": k * 5 / 50}
    if code == "overdue_next":
        k = int(params["k"])
        if not 1 <= k <= 20:
            raise ValueError("Paramètre invalide : 1 ≤ k ≤ 20.")
        def sel(cum, last, t):
            gap = t - last
            return np.lexsort((np.arange(50), -gap))
        hits = _hits_selection(ds, sel, k, 50)
        return float(hits.mean()), hits.size, {"k": k, "expected_h0": k * 5 / 50}
    if code == "repeat_previous":
        common = np.array([len(set(a) & set(b)) for a, b in zip(ds.numbers[:-1].tolist(), ds.numbers[1:].tolist())])
        return float(common.mean()), common.size, {"expected_h0": 0.5}
    if code == "sum_mean":
        return float(ds.numbers.sum(axis=1).mean()), ds.size, {"expected_h0": 127.5}
    if code == "even_mean":
        return float((ds.numbers % 2 == 0).sum(axis=1).mean()), ds.size, {"expected_h0": 2.5}
    if code == "consecutive_mean":
        return float(FEATURES["consecutive"](ds.numbers.astype(np.int16)).mean()), ds.size, {}
    if code == "uniformity":
        counts = np.bincount(ds.numbers.ravel().astype(int) - 1, minlength=50)
        e = ds.size / 10
        return float(((counts - e) ** 2 / e).sum()), ds.size, {}
    raise ValueError(f"Hypothèse inconnue : {code}")


def _null_distribution(code: str, units: int, params: dict[str, Any], n_sim: int, rng: np.random.Generator) -> np.ndarray:
    if code in ("hot_next", "overdue_next", "repeat_previous"):
        # Sous H0, le tirage suivant est indépendant du passé : quel que soit le critère de sélection
        # des k numéros, le nombre de bons numéros suit une loi hypergéométrique (50, 5, k) exacte.
        k = int(params.get("k", 5)) if code != "repeat_previous" else 5
        return rng.hypergeometric(5, 45, k, size=(n_sim, units)).mean(axis=1)
    table = combos_table()
    if code in ("sum_mean", "even_mean", "consecutive_mean"):
        feat = {"sum_mean": "sum", "even_mean": "even", "consecutive_mean": "consecutive"}[code]
        values = _feature_cache(feat)
        out = np.empty(n_sim)
        for i in range(n_sim):
            out[i] = values[rng.integers(0, table.shape[0], units)].mean()
        return out
    if code == "uniformity":
        out = np.empty(n_sim)
        e = units / 10
        for i in range(n_sim):
            c = np.bincount(table[rng.integers(0, table.shape[0], units)].ravel().astype(int) - 1, minlength=50)
            out[i] = ((c - e) ** 2 / e).sum()
        return out
    raise ValueError(code)


_FEATURE_VALUES: dict[str, np.ndarray] = {}


def _feature_cache(name: str) -> np.ndarray:
    if name not in _FEATURE_VALUES:
        _FEATURE_VALUES[name] = FEATURES[name](combos_table().astype(np.int16)).astype(np.float64)
    return _FEATURE_VALUES[name]


def run_research(ds: DrawSet, cfg: ResearchConfig) -> dict[str, Any]:
    if cfg.hypothesis not in HYPOTHESES:
        raise ValueError(f"Hypothèse inconnue : {cfg.hypothesis}")
    if not 100 <= cfg.n_sim <= 20_000:
        raise ValueError("Le nombre de simulations doit être compris entre 100 et 20 000.")
    if not 0 < cfg.alpha < 0.5:
        raise ValueError("Le seuil alpha doit être compris entre 0 et 0,5.")
    h = HYPOTHESES[cfg.hypothesis]
    params = {**h["params"], **(cfg.params or {})}
    if ds.size < 60:
        raise ValueError("Au moins 60 tirages sont nécessaires sur la période choisie.")
    rng, seed = np_rng(cfg.seed)
    observed, units, info = _observed(ds, cfg.hypothesis, params)
    null = _null_distribution(cfg.hypothesis, units, params, cfg.n_sim, rng)
    null_mean = float(null.mean())
    if h["alternative"] == "greater":
        p = (np.sum(null >= observed) + 1) / (null.size + 1)
    else:
        dev = abs(observed - null_mean)
        p = (np.sum(np.abs(null - null_mean) >= dev - 1e-12) + 1) / (null.size + 1)
    # IC à 95 % de la métrique observée : écart-type de la distribution nulle comme approximation
    # de l'erreur d'échantillonnage (hypothèse : même variance sous H0 et H1).
    sd = float(null.std(ddof=1))
    ci = [observed - 1.959964 * sd, observed + 1.959964 * sd]
    hist_counts, edges = np.histogram(null, bins=30)
    reject = bool(p < cfg.alpha)
    return {
        "hypothesis": cfg.hypothesis,
        "title": h["title"],
        "metric": h["metric"],
        "alternative": h["alternative"],
        "params": params,
        "seed": seed,
        "n_sim": cfg.n_sim,
        "alpha": cfg.alpha,
        "units": units,
        "period": [ds.dates[0].isoformat(), ds.dates[-1].isoformat()],
        "observed": observed,
        "null_mean": null_mean,
        "null_sd": sd,
        "null_interval_95": [float(np.percentile(null, 2.5)), float(np.percentile(null, 97.5))],
        "observed_ci95": ci,
        "p_value": float(p),
        "reject_h0": reject,
        "null_histogram": [{"from": float(edges[i]), "to": float(edges[i + 1]), "count": int(c)}
                           for i, c in enumerate(hist_counts)],
        "info": info,
        "interpretation": (
            ("H0 rejetée au seuil choisi : un écart descriptif est observé sur cette période. " if reject else
             "H0 non rejetée : les données sont compatibles avec des tirages équitables et indépendants. ")
            + "Une p-valeur faible n'établit pas une capacité prédictive ; en mode exploratoire, de nombreux essais "
            "produisent mécaniquement des p-valeurs faibles."
        ),
        "null_model": (
            "Tirages simulés équitables et indépendants (graine enregistrée). Pour les hypothèses de sélection, "
            "la loi nulle exacte est hypergéométrique, quel que soit le critère de sélection."
        ),
    }
