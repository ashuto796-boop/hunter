"""Générateur de grilles et stratégies A à F.

Rappel fondamental : pour un tirage équitable, toutes les grilles valides ont
exactement la même probabilité de gagner. Les stratégies diffèrent uniquement
par la *structure* du portefeuille (diversité, couverture, motifs évités) ;
aucune n'augmente la probabilité de gain d'une grille.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Event
from typing import Any

import numpy as np

from app.core.rng import new_seed, py_rng
from app.services.optimizer import (
    InfeasibleConstraints,
    OptimizerConfig,
    ProgressFn,
    Sampler,
    optimize,
)
from app.services.popularity import DISCLAIMER as POPULARITY_DISCLAIMER
from app.services.portfolio import GridConstraints, Weights, grid_features, portfolio_metrics

NO_EDGE_WARNING = "Cette méthode ne possède aucun avantage prédictif démontré sur un tirage équitable."

STRATEGIES: dict[str, dict[str, str]] = {
    "A": {
        "name": "Aléatoire uniforme",
        "description": "Chaque grille valide a exactement la même probabilité d'être choisie. Stratégie de référence.",
    },
    "B": {
        "name": "Diversification",
        "description": "Limite les ressemblances entre grilles (numéros et étoiles communs) par optimisation.",
    },
    "C": {
        "name": "Couverture",
        "description": "Maximise le nombre de paires, triplets et paires d'étoiles distincts couverts.",
    },
    "D": {
        "name": "Popularité estimée",
        "description": "Écarte les grilles présentant des motifs souvent joués (dates, suites, alignements).",
    },
    "E": {
        "name": "Pondération historique (expérimentale)",
        "description": "Tirage pondéré par les fréquences historiques. " + NO_EDGE_WARNING,
    },
    "F": {
        "name": "Optimisation multi-objectifs",
        "description": "Combine diversité, couverture, recouvrement, étoiles, motifs et contraintes selon vos pondérations.",
    },
}

STRATEGY_WEIGHTS = {
    "B": Weights(diversity=1.0, pairs=0.0, triples=0.0, stars=0.3, popularity=0.0, overlap=1.0),
    "C": Weights(diversity=0.1, pairs=0.5, triples=0.3, stars=0.3, popularity=0.0, overlap=0.0),
}


@dataclass
class GenerationRequest:
    count: int
    strategy: str = "A"
    seed: int | None = None
    constraints: GridConstraints = field(default_factory=GridConstraints)
    weights: Weights | None = None
    method: str = "simulated_annealing"
    time_limit_s: float = 3.0
    max_common: int | None = 2
    popularity_threshold: float = 0.15
    historical_mode: str = "hot"  # hot | cold
    historical_window: int | None = None
    historical_strength: float = 1.0


def _uniform(req: GenerationRequest, rng, past: frozenset | None, cancel: Event | None) -> list[tuple]:
    sampler = Sampler(rng, req.constraints, past)
    seen: set[int] = set()
    out = []
    tries = 0
    limit = max(200_000, req.count * 200)
    while len(out) < req.count:
        if cancel is not None and cancel.is_set():
            break
        tries += 1
        if tries > limit:
            raise InfeasibleConstraints("Contraintes trop restrictives pour produire autant de grilles distinctes.")
        nums = tuple(sorted(rng.sample(sampler.numbers, 5)))
        stars = tuple(sorted(rng.sample(sampler.stars, 2)))
        if not req.constraints.is_empty:
            f = sampler.features(nums, stars)
            if not sampler.accepts(f):
                continue
            idx = f.index
        else:
            from app.core.grid import grid_index

            idx = grid_index(nums, stars)
        if idx in seen:
            continue
        seen.add(idx)
        out.append((nums, stars))
    return out


def _weighted_sample(rng, values: list[int], weights: np.ndarray, k: int) -> tuple[int, ...]:
    """Tirage pondéré sans remise (séquentiel)."""
    vals = list(values)
    w = list(weights)
    chosen = []
    for _ in range(k):
        total = sum(w)
        r = rng.random() * total
        acc = 0.0
        for j, wj in enumerate(w):
            acc += wj
            if r <= acc:
                chosen.append(vals.pop(j))
                w.pop(j)
                break
        else:
            chosen.append(vals.pop())
            w.pop()
    return tuple(sorted(chosen))


def _historical(req: GenerationRequest, rng, history: dict[str, Any] | None, past: frozenset | None,
                cancel: Event | None) -> tuple[list[tuple], dict[str, Any]]:
    if not history or history.get("draws", 0) == 0:
        raise ValueError("La stratégie E nécessite un historique de tirages importé.")
    num_counts = np.asarray(history["number_counts"], dtype=float)
    star_counts = np.asarray(history["star_counts"], dtype=float)
    a = max(0.0, min(3.0, req.historical_strength))
    def to_weights(c: np.ndarray) -> np.ndarray:
        rel = (c + 1) / (c.mean() + 1)
        w = rel**a if req.historical_mode == "hot" else rel ** (-a)
        return w / w.sum()
    wn, ws = to_weights(num_counts), to_weights(star_counts)
    sampler = Sampler(rng, req.constraints, past)
    allowed_n = [n for n in range(1, 51) if n in set(sampler.numbers)]
    allowed_s = [s for s in range(1, 13) if s in set(sampler.stars)]
    wn_a = np.array([wn[n - 1] for n in allowed_n])
    ws_a = np.array([ws[s - 1] for s in allowed_s])
    seen: set[int] = set()
    out = []
    tries = 0
    while len(out) < req.count:
        if cancel is not None and cancel.is_set():
            break
        tries += 1
        if tries > max(200_000, req.count * 300):
            raise InfeasibleConstraints("Impossible de produire autant de grilles distinctes avec ces paramètres.")
        nums = _weighted_sample(rng, allowed_n, wn_a, 5)
        stars = _weighted_sample(rng, allowed_s, ws_a, 2)
        f = sampler.features(nums, stars)
        if not req.constraints.is_empty and not sampler.accepts(f):
            continue
        if f.index in seen:
            continue
        seen.add(f.index)
        out.append((nums, stars))
    info = {
        "mode": req.historical_mode,
        "window_draws": history.get("draws"),
        "strength": a,
        "number_weights": [round(float(x), 5) for x in wn],
        "star_weights": [round(float(x), 5) for x in ws],
        "warning": NO_EDGE_WARNING,
    }
    return out, info


def generate(req: GenerationRequest, *, history: dict[str, Any] | None = None, past_draws: frozenset | None = None,
             progress: ProgressFn | None = None, cancel: Event | None = None) -> dict[str, Any]:
    if req.strategy not in STRATEGIES:
        raise ValueError(f"Stratégie inconnue : {req.strategy}")
    if not 1 <= req.count <= 10_000:
        raise ValueError("Le nombre de grilles doit être compris entre 1 et 10 000.")
    t0 = time.perf_counter()
    seed_used = req.seed
    reproducible = req.seed is not None
    warnings: list[str] = []
    extra: dict[str, Any] = {}
    weights = req.weights or Weights()
    if req.strategy == "A":
        rng = py_rng(req.seed)
        grids = _uniform(req, rng, past_draws, cancel)
        if not req.constraints.is_empty:
            warnings.append("Avec des contraintes, le tirage est uniforme parmi les grilles qui les respectent.")
    elif req.strategy == "D":
        rng = py_rng(req.seed)
        c = GridConstraints.from_dict({**req.constraints.as_dict(), "max_popularity": req.popularity_threshold})
        sub = GenerationRequest(count=req.count, strategy="A", seed=req.seed, constraints=c)
        grids = _uniform(sub, rng, past_draws, cancel)
        warnings.append(POPULARITY_DISCLAIMER)
        extra["popularity_threshold"] = req.popularity_threshold
    elif req.strategy == "E":
        rng = py_rng(req.seed)
        grids, info = _historical(req, rng, history, past_draws, cancel)
        warnings.append(NO_EDGE_WARNING)
        extra["historical"] = info
    else:
        if req.strategy in STRATEGY_WEIGHTS:
            weights = STRATEGY_WEIGHTS[req.strategy]
        method = req.method if req.strategy == "F" else ("simulated_annealing" if req.count <= 500 else "greedy")
        seed_used = req.seed if req.seed is not None else new_seed()
        cfg = OptimizerConfig(
            n_grids=req.count, method=method, weights=weights, constraints=req.constraints,
            max_common=req.max_common, time_limit_s=req.time_limit_s, seed=seed_used,
        )
        res = optimize(cfg, progress, cancel, past_draws)
        grids = res.grids
        extra["optimizer"] = {k: v for k, v in res.as_dict().items() if k not in ("grids", "metrics")}
        reproducible = True
        warnings.append("Le recuit simulé étant limité dans le temps, la graine seule ne garantit la reproductibilité "
                        "qu'à nombre d'itérations identique." if method != "greedy" else
                        "Heuristique gloutonne : reproductible avec la même graine.")
    if cancel is not None and cancel.is_set():
        warnings.append("Génération annulée : résultat partiel.")
    grids = sorted(grids)
    metrics = portfolio_metrics(grids, weights, req.max_common, include_matrix=len(grids) <= 100)
    now = datetime.now(timezone.utc).isoformat()
    feats = [grid_features(n, s, past_draws) for n, s in grids]
    items = []
    for i, f in enumerate(feats):
        items.append({
            "id": i + 1,
            "numbers": list(f.numbers),
            "stars": list(f.stars),
            "combo_index": f.index,
            "pattern_score": round(f.popularity, 3),
            "strategy": req.strategy,
            "generated_at": now,
        })
    if len(grids) <= 2000:
        _attach_grid_diversity(items, feats)
    return {
        "strategy": req.strategy,
        "strategy_name": STRATEGIES[req.strategy]["name"],
        "strategy_description": STRATEGIES[req.strategy]["description"],
        "count": len(items),
        "grids": items,
        "metrics": metrics,
        "seed": seed_used,
        "reproducible": reproducible,
        "rng": "secrets.SystemRandom (cryptographique)" if not reproducible else "random.Random(graine) — reproductible",
        "elapsed_s": round(time.perf_counter() - t0, 4),
        "warnings": warnings,
        "fairness_note": (
            "Chaque grille a exactement la même probabilité de remporter le jackpot : 1 sur 139 838 160. "
            "Les scores affichés décrivent la structure du portefeuille, jamais une probabilité de sortie."
        ),
        **extra,
    }


def _attach_grid_diversity(items: list[dict[str, Any]], feats) -> None:
    """Score de diversité par grille = 1 − similarité moyenne avec les autres grilles."""
    n = len(feats)
    if n < 2:
        for it in items:
            it["diversity_score"] = 1.0
        return
    masks = np.array([f.mask for f in feats], dtype=np.uint64)
    smasks = np.array([(1 << (f.stars[0] - 1)) | (1 << (f.stars[1] - 1)) for f in feats], dtype=np.uint64)
    ov = np.bitwise_count(masks[:, None] & masks[None, :]).astype(np.int16)
    so = np.bitwise_count(smasks[:, None] & smasks[None, :]).astype(np.int16)
    sim = (ov + so) / 7.0
    np.fill_diagonal(sim, 0)
    mean_sim = sim.sum(axis=1) / (n - 1)
    for it, v in zip(items, mean_sim):
        it["diversity_score"] = round(float(1 - v), 4)
