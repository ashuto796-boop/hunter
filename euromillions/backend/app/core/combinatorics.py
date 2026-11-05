"""Tables combinatoires vectorisées (NumPy), mises en cache.

La table des C(50,5) = 2 118 760 combinaisons de numéros permet :
* de calculer des distributions théoriques **exactes** de n'importe quelle
  caractéristique d'un tirage (somme, parité, écarts…) par énumération complète ;
* de tirer des combinaisons uniformément par simple tirage d'indice ;
* d'évaluer exactement un portefeuille contre tous les tirages possibles.
"""

from __future__ import annotations

import itertools
from functools import lru_cache
from math import comb

import numpy as np

from app.core.rules import NUMBERS_PER_GRID, STARS_PER_GRID


@lru_cache(maxsize=4)
def combos_table(n: int = 50, k: int = NUMBERS_PER_GRID) -> np.ndarray:
    """Toutes les combinaisons triées de k parmi 1..n, en ordre colexicographique.

    Ligne i = combinaison de rang colexicographique i (cohérent avec
    ``app.core.grid.combination_rank``).
    """
    total = comb(n, k)
    flat = np.fromiter(
        itertools.chain.from_iterable(itertools.combinations(range(1, n + 1), k)),
        dtype=np.int8,
        count=total * k,
    ).reshape(total, k)
    # itertools produit l'ordre lexicographique ; on le convertit en colex
    # (tri sur la plus grande valeur d'abord) pour la cohérence avec le rang.
    order = np.lexsort(tuple(flat[:, j] for j in range(k)))
    table = flat[order]
    table.setflags(write=False)
    return table


@lru_cache(maxsize=4)
def combos_masks(n: int = 50, k: int = NUMBERS_PER_GRID) -> np.ndarray:
    table = combos_table(n, k).astype(np.int64)
    masks = np.zeros(table.shape[0], dtype=np.uint64)
    for j in range(k):
        masks |= np.left_shift(np.uint64(1), (table[:, j] - 1).astype(np.uint64))
    masks.setflags(write=False)
    return masks


def star_pairs_table(stars_max: int) -> np.ndarray:
    return combos_table(stars_max, STARS_PER_GRID)


def star_pairs_masks(stars_max: int) -> np.ndarray:
    return combos_masks(stars_max, STARS_PER_GRID)


def popcount(arr: np.ndarray) -> np.ndarray:
    return np.bitwise_count(arr)


def masks_from_rows(rows: np.ndarray) -> np.ndarray:
    """Masques binaires (uint64) à partir d'une matrice d'entiers 1-indexés."""
    rows = np.asarray(rows, dtype=np.int64)
    masks = np.zeros(rows.shape[0], dtype=np.uint64)
    for j in range(rows.shape[1]):
        masks |= np.left_shift(np.uint64(1), (rows[:, j] - 1).astype(np.uint64))
    return masks
