"""Générateurs aléatoires.

* Mode par défaut (pas de graine) : ``secrets.SystemRandom`` — source
  cryptographique du système, non prédictible.
* Mode reproductible (graine fournie) : ``random.Random(seed)`` /
  ``numpy.random.Generator(PCG64(seed))``, destiné aux analyses et
  simulations que l'on souhaite pouvoir rejouer à l'identique.
"""

from __future__ import annotations

import random
import secrets

import numpy as np

MAX_SEED = 2**63 - 1


def py_rng(seed: int | None) -> random.Random:
    if seed is None:
        return secrets.SystemRandom()
    return random.Random(int(seed))


def new_seed() -> int:
    """Graine aléatoire (cryptographique) à enregistrer pour rejouer une expérience."""
    return secrets.randbits(63)


def np_rng(seed: int | None) -> tuple[np.random.Generator, int]:
    """Retourne un générateur NumPy et la graine effectivement utilisée."""
    used = new_seed() if seed is None else int(seed)
    if not 0 <= used <= MAX_SEED:
        raise ValueError("La graine doit être un entier compris entre 0 et 2^63 − 1.")
    return np.random.Generator(np.random.PCG64(used)), used
