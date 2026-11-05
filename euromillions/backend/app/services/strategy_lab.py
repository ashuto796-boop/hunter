"""Laboratoire de stratégies : évaluation rapide, comparaison et recherche automatique de paramètres.

La recherche automatique optimise une **métrique structurelle** (couverture,
diversité…) du portefeuille généré ; elle n'utilise jamais les tirages
historiques, afin de ne pas donner l'illusion d'une prédiction future.
"""

from __future__ import annotations

import random
from threading import Event
from typing import Any, Callable

from app.core.rng import new_seed
from app.services.optimizer import OptimizationCancelled, OptimizerConfig, optimize
from app.services.portfolio import GridConstraints, Weights

TUNABLE_METRICS = {
    "pair_coverage": "Couverture des paires",
    "triple_coverage": "Couverture des triplets",
    "diversity": "Diversité",
    "star_score": "Répartition des étoiles",
    "star_pair_coverage": "Couverture des paires d'étoiles",
}


def evaluate_config(n_grids: int, weights: Weights, constraints: GridConstraints, max_common: int | None,
                    method: str = "simulated_annealing", time_limit_s: float = 1.0, seed: int | None = None,
                    cancel: Event | None = None) -> dict[str, Any]:
    res = optimize(OptimizerConfig(n_grids=n_grids, method=method, weights=weights, constraints=constraints,
                                   max_common=max_common, time_limit_s=time_limit_s, seed=seed), cancel=cancel)
    d = res.as_dict()
    m = d["metrics"]
    return {
        "objective": d["objective"],
        "scores": {k: m.get(k) for k in ("diversity", "pair_coverage", "triple_coverage", "star_score",
                                         "star_pair_coverage", "star_balance", "popularity", "overlap_rate")},
        "max_common_numbers_observed": m.get("max_common_numbers_observed"),
        "duplicates": m.get("duplicates"),
        "grids": d["grids"],
        "seed": d["seed"],
        "iterations": d["iterations"],
        "elapsed_s": d["elapsed_s"],
        "history": d["history"],
    }


def compare_configs(configs: list[dict[str, Any]], n_grids: int, time_limit_s: float, seed: int | None,
                    progress: Callable[[float, str], None] | None = None, cancel: Event | None = None) -> dict[str, Any]:
    if not 1 <= len(configs) <= 5:
        raise ValueError("Comparez entre 1 et 5 stratégies.")
    seed = seed if seed is not None else new_seed()
    rows = []
    for i, c in enumerate(configs):
        if progress:
            progress(i / len(configs), f"Stratégie {i + 1}/{len(configs)}")
        ev = evaluate_config(
            n_grids, Weights.from_dict(c.get("weights")), GridConstraints.from_dict(c.get("constraints")),
            c.get("max_common", 2), c.get("method", "simulated_annealing"), time_limit_s, seed, cancel,
        )
        rows.append({"name": c.get("name") or f"Stratégie {i + 1}", "config": c, **ev})
    best_by = {}
    for metric in TUNABLE_METRICS:
        vals = [(r["scores"].get(metric) or 0, r["name"]) for r in rows]
        best_by[metric] = max(vals)[1]
    low_pop = min(rows, key=lambda r: r["scores"].get("popularity") or 0)["name"]
    return {"seed": seed, "n_grids": n_grids, "results": rows, "best_by_criterion": {**best_by, "popularity_lowest": low_pop},
            "note": "Chaque stratégie est « meilleure » uniquement pour le critère indiqué ; aucune n'améliore les chances de gain."}


def auto_tune(target: str, n_grids: int, trials: int = 12, time_per_trial_s: float = 1.0,
              min_diversity: float | None = None, constraints: GridConstraints | None = None,
              max_common: int | None = 2, seed: int | None = None,
              progress: Callable[[float, str], None] | None = None, cancel: Event | None = None) -> dict[str, Any]:
    """Recherche aléatoire de pondérations et de températures maximisant une métrique structurelle."""
    if target not in TUNABLE_METRICS:
        raise ValueError(f"Métrique inconnue : {target}")
    if not 2 <= trials <= 60:
        raise ValueError("Le nombre d'essais doit être compris entre 2 et 60.")
    seed = seed if seed is not None else new_seed()
    rng = random.Random(seed)
    constraints = constraints or GridConstraints()
    rows = []
    best = None
    for t in range(trials):
        if cancel is not None and cancel.is_set():
            raise OptimizationCancelled()
        if progress:
            progress(t / trials, f"Essai {t + 1}/{trials}")
        raw = [rng.random() for _ in range(6)]
        w = Weights(diversity=raw[0], pairs=raw[1], triples=raw[2], stars=raw[3], popularity=raw[4] * 0.5,
                    overlap=raw[5])
        t_init = 10 ** rng.uniform(-3, -1)
        params_sa = {"t_initial": t_init, "t_final": t_init / 10 ** rng.uniform(2, 4)}
        res = optimize(OptimizerConfig(n_grids=n_grids, method="simulated_annealing", weights=w, constraints=constraints,
                                       max_common=max_common, time_limit_s=time_per_trial_s, seed=seed + t,
                                       params=params_sa), cancel=cancel)
        m = res.metrics
        value = m.get(target) or 0.0
        feasible = min_diversity is None or (m.get("diversity") or 0) >= min_diversity
        row = {"trial": t + 1, "weights": w.as_dict(), "annealing": params_sa, "value": value, "feasible": feasible,
               "diversity": m.get("diversity"), "pair_coverage": m.get("pair_coverage"),
               "triple_coverage": m.get("triple_coverage"), "star_score": m.get("star_score")}
        rows.append(row)
        if feasible and (best is None or value > best["value"]):
            best = {**row, "grids": [{"numbers": list(n), "stars": list(s)} for n, s in res.grids]}
    return {
        "target": target,
        "target_label": TUNABLE_METRICS[target],
        "seed": seed,
        "trials": rows,
        "best": best,
        "note": (
            "Recherche aléatoire sur les pondérations de la fonction objectif et les températures du recuit simulé. "
            "La métrique optimisée est structurelle (couverture/diversité) ; aucun tirage historique n'est utilisé."
        ),
    }
