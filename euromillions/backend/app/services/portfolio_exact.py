"""Analyse exacte d'un portefeuille sur un même tirage (rangs secondaires).

Les gains des différentes grilles d'un portefeuille joué sur un même tirage
ne sont **pas indépendants** : deux grilles qui partagent des numéros gagnent
souvent ensemble. Ce module énumère donc exhaustivement les
C(50,5) × C(12,2) = 139 838 160 tirages possibles et compte exactement :

* P(au moins un gain au rang r) pour chaque rang ;
* P(au moins un gain, tous rangs confondus) ;
* la distribution exacte du nombre de grilles gagnantes ;
* la distribution exacte du meilleur rang obtenu.

Technique : pour chaque bloc de combinaisons de numéros, on calcule le nombre
de bons numéros de chaque grille (popcount de masques 64 bits), puis on
combine les 66 paires d'étoiles en exploitant le fait qu'une grille a 2, 1
ou 0 bonnes étoiles selon la paire tirée. Les « au moins un » sont obtenus par
OU binaire sur des vecteurs de bits compactés. Tous les comptages sont
entiers : les probabilités sont des fractions exactes.
"""

from __future__ import annotations

import time
from fractions import Fraction
from math import comb
from threading import Event
from typing import Any, Callable, Sequence

import numpy as np

from app.core.combinatorics import combos_masks
from app.core.grid import Grid
from app.core.probability import any_prize_probability, match_probability, probability_payload, total_combinations
from app.core.rules import CURRENT_TIERS

CHUNK = 1 << 18  # 262 144 combinaisons de numéros par bloc
STAR_PAIRS = [(a, b) for a in range(1, 13) for b in range(a + 1, 13)]


class AnalysisCancelled(Exception):
    pass


def exact_portfolio_analysis(
    grids: Sequence[tuple[Sequence[int], Sequence[int]]],
    progress: Callable[[float, str], None] | None = None,
    cancel: Event | None = None,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    gl = [Grid.create(n, s) for n, s in grids]
    if len({g.index() for g in gl}) != len(gl):
        raise ValueError("Le portefeuille contient des grilles en double.")
    N = len(gl)
    if N == 0:
        raise ValueError("Portefeuille vide.")
    main_masks = combos_masks()
    M = main_masks.size
    gmask = np.array([g.number_mask for g in gl], dtype=np.uint64)
    gstars = [set(g.stars) for g in gl]
    # Pour chaque paire d'étoiles tirée : nombre de bonnes étoiles de chaque grille.
    s_match = np.array([[len(gs & {a, b}) for gs in gstars] for a, b in STAR_PAIRS], dtype=np.int8)  # (66, N)
    groups = [[np.flatnonzero(s_match[p] == b) for b in range(3)] for p in range(len(STAR_PAIRS))]
    tiers = list(CURRENT_TIERS)

    any_tier = np.zeros(len(tiers), dtype=np.int64)  # nb de tirages avec ≥ 1 gain au rang r
    cum_tier = np.zeros(len(tiers), dtype=np.int64)  # nb de tirages avec ≥ 1 gain de rang ≤ r
    win_count_dist = np.zeros(N + 1, dtype=np.int64)

    n_chunks = (M + CHUNK - 1) // CHUNK
    for ci, start in enumerate(range(0, M, CHUNK)):
        if cancel is not None and cancel.is_set():
            raise AnalysisCancelled()
        block = main_masks[start:start + CHUNK]
        B = block.size
        K = np.bitwise_count(block[None, :] & gmask[:, None]).astype(np.uint8)  # (N, B)
        pad = (-B) % 64
        def packed(mask: np.ndarray) -> np.ndarray:
            if pad:
                mask = np.pad(mask, ((0, 0), (0, pad)))
            return np.packbits(mask, axis=1).view(np.uint64)
        E = {a: packed(K == a) for a in range(1, 6)}  # E[a][i] : bits « grille i a exactement a bons numéros »
        base = (K >= 2).sum(axis=0, dtype=np.int32)
        one = (K == 1)
        for p in range(len(STAR_PAIRS)):
            # Distribution du nombre de grilles gagnantes.
            g2 = groups[p][2]
            cnt = base + one[g2].sum(axis=0, dtype=np.int32) if g2.size else base
            win_count_dist += np.bincount(cnt, minlength=N + 1)[: N + 1]
            # Au moins un gain par rang, et meilleur rang (OU cumulatif dans l'ordre des rangs).
            running = None
            for r, t in enumerate(tiers):
                idx = groups[p][t.stars]
                if idx.size:
                    hit = np.bitwise_or.reduce(E[t.numbers][idx], axis=0)
                    any_tier[r] += int(np.bitwise_count(hit).sum())
                    running = hit if running is None else (running | hit)
                if running is not None:
                    cum_tier[r] += int(np.bitwise_count(running).sum())
        if progress:
            progress((ci + 1) / n_chunks, f"Énumération exacte : bloc {ci + 1}/{n_chunks}")

    total = total_combinations()
    assert int(win_count_dist.sum()) == total
    single = {t.rank: match_probability(t.numbers, t.stars) for t in tiers}
    rows = []
    prev_cum = 0
    for r, t in enumerate(tiers):
        p_any = Fraction(int(any_tier[r]), total)
        p_indep = 1 - (1 - single[t.rank]) ** N
        p_best = Fraction(int(cum_tier[r]) - prev_cum, total)
        prev_cum = int(cum_tier[r])
        rows.append({
            "rank": t.rank,
            "label": t.label,
            "p_at_least_one": probability_payload(p_any),
            "expected_wins": float(single[t.rank] * N),
            "p_best_rank": probability_payload(p_best),
            "p_if_independent": probability_payload(p_indep),
            "union_bound": float(min(1, single[t.rank] * N)),
        })
    p_none = Fraction(int(win_count_dist[0]), total)
    p_any_win = 1 - p_none
    single_any = any_prize_probability()
    dist = [
        {"winning_grids": k, "probability": probability_payload(Fraction(int(c), total)), "draws": int(c)}
        for k, c in enumerate(win_count_dist) if c > 0
    ]
    expected_winning = sum(k * int(c) for k, c in enumerate(win_count_dist)) / total
    return {
        "n_grids": N,
        "method": "Énumération exhaustive des 139 838 160 tirages possibles (calcul exact).",
        "tiers": rows,
        "p_any_win": probability_payload(p_any_win),
        "p_any_win_if_independent": probability_payload(1 - (1 - single_any) ** N),
        "expected_winning_grids": expected_winning,
        "expected_winning_grids_exact": float(single_any * N),
        "winning_grids_distribution": dist,
        "elapsed_s": round(time.perf_counter() - t0, 3),
        "note": (
            "Les colonnes « si indépendance » montrent ce que donnerait l'hypothèse (fausse) d'indépendance entre "
            "grilles d'un même tirage ; l'écart mesure l'effet des recouvrements. Le nombre espéré de gains par rang "
            "ne dépend pas des recouvrements (linéarité de l'espérance), contrairement à P(au moins un gain)."
        ),
    }
