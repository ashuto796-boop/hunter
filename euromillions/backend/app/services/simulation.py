"""Simulateur Monte-Carlo de tirages EuroMillions (vectorisé NumPy).

* Les tirages sont simulés exactement uniformément : un indice uniforme dans
  [0, C(50,5)) pour les numéros et dans [0, 66) pour les étoiles.
* Tous les portefeuilles comparés sont évalués sur **les mêmes tirages
  simulés** (nombres aléatoires communs), ce qui réduit le bruit des comparaisons.
* Une simulation n'augmente jamais les chances réelles de gagner : elle
  illustre seulement la variabilité des résultats sous des hypothèses données.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from fractions import Fraction
from threading import Event
from typing import Any, Callable, Sequence

import numpy as np

from app.core.combinatorics import combos_masks, star_pairs_masks
from app.core.grid import Grid
from app.core.probability import any_prize_probability, match_probability
from app.core.rng import np_rng
from app.core.rules import CURRENT_TIERS
from app.services.statistics import wilson_interval

CHUNK = 50_000

# Table (bons numéros, bonnes étoiles) -> rang (0 = pas de gain).
RANK_LUT = np.zeros((6, 3), dtype=np.int8)
for _t in CURRENT_TIERS:
    RANK_LUT[_t.numbers, _t.stars] = _t.rank


class SimulationCancelled(Exception):
    pass


@dataclass
class PortfolioInput:
    name: str
    grids: list[tuple[tuple[int, ...], tuple[int, ...]]]
    portfolio_id: int | None = None


@dataclass
class SimulationConfig:
    portfolios: list[PortfolioInput]
    n_draws: int
    seed: int | None = None
    ticket_price: float = 2.5
    payouts: dict[int, float] = field(default_factory=dict)  # rang -> gain supposé (€)
    jackpot: float | None = None
    net_histogram_bins: int = 40


def run_simulation(cfg: SimulationConfig, progress: Callable[[float, str], None] | None = None,
                   cancel: Event | None = None) -> dict[str, Any]:
    if not cfg.portfolios:
        raise ValueError("Au moins un portefeuille est requis.")
    if cfg.n_draws < 1:
        raise ValueError("Le nombre de tirages simulés doit être positif.")
    t0 = time.perf_counter()
    rng, seed = np_rng(cfg.seed)
    main_masks = combos_masks()
    star_masks = star_pairs_masks(12)
    tiers = list(CURRENT_TIERS)
    payout = np.zeros(14, dtype=np.float64)
    for r, v in cfg.payouts.items():
        if 2 <= int(r) <= 13 and v is not None:
            payout[int(r)] = float(v)
    has_payouts = bool(cfg.payouts) or cfg.jackpot is not None
    if cfg.jackpot is not None:
        payout[1] = float(cfg.jackpot)

    prepared = []
    for pf in cfg.portfolios:
        gl = [Grid.create(n, s) for n, s in pf.grids]
        if len({g.index() for g in gl}) != len(gl):
            raise ValueError(f"Le portefeuille « {pf.name} » contient des doublons.")
        prepared.append({
            "name": pf.name,
            "portfolio_id": pf.portfolio_id,
            "n": len(gl),
            "nm": np.array([g.number_mask for g in gl], dtype=np.uint64),
            "sm": np.array([g.star_mask for g in gl], dtype=np.uint64),
            "rank_counts": np.zeros(14, dtype=np.int64),
            "draws_with_win": np.zeros(14, dtype=np.int64),  # tirages avec ≥1 gain au rang r (0 = tous rangs)
            "win_grids_hist": np.zeros(len(gl) + 1, dtype=np.int64),
            "gross": [],
        })

    max_n = max(p["n"] for p in prepared)
    chunk = max(500, min(CHUNK, 4_000_000 // max(max_n, 1)))
    done = 0
    while done < cfg.n_draws:
        if cancel is not None and cancel.is_set():
            raise SimulationCancelled()
        b = min(chunk, cfg.n_draws - done)
        dm = main_masks[rng.integers(0, main_masks.size, b)]
        ds = star_masks[rng.integers(0, star_masks.size, b)]
        for p in prepared:
            k = np.bitwise_count(dm[:, None] & p["nm"][None, :])  # (b, n)
            s = np.bitwise_count(ds[:, None] & p["sm"][None, :])
            ranks = RANK_LUT[k, s]  # (b, n)
            p["rank_counts"] += np.bincount(ranks.ravel(), minlength=14)[:14]
            wins = ranks > 0
            nwin = wins.sum(axis=1)
            p["win_grids_hist"] += np.bincount(nwin, minlength=p["n"] + 1)[: p["n"] + 1]
            p["draws_with_win"][0] += int((nwin > 0).sum())
            hit = np.zeros((b, 14), dtype=bool)
            hit[np.repeat(np.arange(b), p["n"]), ranks.ravel()] = True
            p["draws_with_win"][1:] += hit[:, 1:].sum(axis=0)
            if has_payouts:
                p["gross"].append(payout[ranks].sum(axis=1).astype(np.float64))
        done += b
        if progress:
            progress(done / cfg.n_draws, f"{done:,} / {cfg.n_draws:,} tirages simulés".replace(",", " "))

    results = []
    z99 = 2.5758293035489004
    for p in prepared:
        n = p["n"]
        T = cfg.n_draws
        cost_per_draw = n * cfg.ticket_price
        tier_rows = []
        for t in tiers:
            prob = match_probability(t.numbers, t.stars)
            obs = int(p["rank_counts"][t.rank])
            expected = float(prob) * n * T
            # Comptage par grille : n·T essais de Bernoulli (dépendants entre grilles d'un même tirage,
            # mais l'espérance est exacte ; l'intervalle de Wilson est indicatif).
            freq = obs / (n * T)
            lo, hi = wilson_interval(obs, n * T, z99)
            tier_rows.append({
                "rank": t.rank,
                "label": t.label,
                "wins": obs,
                "expected_wins": expected,
                "empirical_frequency": freq,
                "theoretical_probability": float(prob),
                "relative_gap": (freq - float(prob)) / float(prob),
                "ci99_low": lo,
                "ci99_high": hi,
                "within_ci99": bool(lo <= float(prob) <= hi),
                "draws_with_at_least_one": int(p["draws_with_win"][t.rank]),
            })
        hist = [{"winning_grids": k, "draws": int(c)} for k, c in enumerate(p["win_grids_hist"]) if c > 0]
        res: dict[str, Any] = {
            "name": p["name"],
            "portfolio_id": p["portfolio_id"],
            "n_grids": n,
            "draws": T,
            "jackpots": int(p["rank_counts"][1]),
            "tiers": tier_rows,
            "draws_with_any_win": int(p["draws_with_win"][0]),
            "p_any_win_empirical": p["draws_with_win"][0] / T,
            "p_any_win_ci99": wilson_interval(int(p["draws_with_win"][0]), T, z99),
            "expected_wins_per_draw": float(any_prize_probability()) * n,
            "winning_grids_histogram": hist,
            "total_cost": round(cost_per_draw * T, 2),
            "cost_per_draw": round(cost_per_draw, 2),
        }
        if has_payouts:
            gross = np.concatenate(p["gross"]) if p["gross"] else np.zeros(T)
            net = gross - cost_per_draw
            total_gross = float(gross.sum())
            res["payout_assumptions"] = True
            res["total_gross"] = round(total_gross, 2)
            res["total_net"] = round(total_gross - cost_per_draw * T, 2)
            res["mean_net_per_draw"] = float(net.mean())
            res["return_rate"] = total_gross / (cost_per_draw * T) if cost_per_draw else None
            res["p_net_positive"] = float((net > 0).mean())
            res["net_quantiles"] = {q: float(np.quantile(net, q / 100)) for q in (1, 5, 25, 50, 75, 95, 99)}
            res["net_histogram"] = _histogram(net, cfg.net_histogram_bins)
            cum = np.cumsum(net)
            idx = np.unique(np.linspace(0, T - 1, min(T, 300)).astype(int))
            res["cumulative_net"] = [{"draw": int(i + 1), "net": float(cum[i])} for i in idx]
        else:
            res["payout_assumptions"] = False
        results.append(res)
    return {
        "seed": seed,
        "n_draws": cfg.n_draws,
        "common_random_numbers": True,
        "ticket_price": cfg.ticket_price,
        "payouts": {str(k): v for k, v in cfg.payouts.items()},
        "jackpot": cfg.jackpot,
        "portfolios": results,
        "elapsed_s": round(time.perf_counter() - t0, 3),
        "notes": [
            "Tous les portefeuilles sont évalués sur les mêmes tirages simulés (graine enregistrée).",
            "Les fréquences empiriques convergent vers les probabilités théoriques ; les écarts observés relèvent du hasard.",
            "Les gains simulés dépendent entièrement des hypothèses de paiement saisies ; les rapports réels varient "
            "à chaque tirage selon les mises et le nombre de gagnants.",
            "Une simulation n'augmente pas les chances réelles de gagner.",
        ],
    }


def _histogram(values: np.ndarray, bins: int) -> list[dict[str, float]]:
    lo, hi = float(values.min()), float(values.max())
    if lo == hi:
        return [{"from": lo, "to": hi, "count": int(values.size)}]
    counts, edges = np.histogram(values, bins=bins)
    return [{"from": float(edges[i]), "to": float(edges[i + 1]), "count": int(c)} for i, c in enumerate(counts) if c]


def random_portfolio(n: int, seed: int | None = None) -> list[tuple[tuple[int, ...], tuple[int, ...]]]:
    """Portefeuille de référence : n grilles distinctes uniformes."""
    from app.core.rng import py_rng

    rng = py_rng(seed)
    seen: set = set()
    out = []
    while len(out) < n:
        g = (tuple(sorted(rng.sample(range(1, 51), 5))), tuple(sorted(rng.sample(range(1, 13), 2))))
        if g not in seen:
            seen.add(g)
            out.append(g)
    return out


def simulation_work(portfolios: Sequence[PortfolioInput], n_draws: int) -> int:
    return n_draws * sum(len(p.grids) for p in portfolios)


def expected_value_per_draw(n_grids: int, payouts: dict[int, float], jackpot: float | None) -> Fraction:
    """Espérance exacte (sous hypothèses de gains fixes) du gain brut par tirage."""
    ev = Fraction(0)
    for t in CURRENT_TIERS:
        amount = jackpot if t.rank == 1 else payouts.get(t.rank)
        if amount:
            ev += match_probability(t.numbers, t.stars) * Fraction(str(amount)) * n_grids
    return ev
