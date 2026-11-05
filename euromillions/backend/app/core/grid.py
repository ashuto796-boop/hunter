"""Représentation, validation et indexation combinatoire des grilles."""

from __future__ import annotations

from dataclasses import dataclass, field
from math import comb
from typing import Iterable, Sequence

from app.core.rules import CURRENT_ERA, NUMBERS_PER_GRID, STARS_PER_GRID, Era


class GridValidationError(ValueError):
    """Grille non conforme aux règles du jeu."""


@dataclass(frozen=True, order=True)
class Grid:
    numbers: tuple[int, ...]
    stars: tuple[int, ...]
    era_code: str = field(default=CURRENT_ERA.code, compare=False)

    @staticmethod
    def create(numbers: Iterable[int], stars: Iterable[int], era: Era = CURRENT_ERA) -> "Grid":
        nums = tuple(sorted(int(n) for n in numbers))
        sts = tuple(sorted(int(s) for s in stars))
        validate_grid(nums, sts, era)
        return Grid(nums, sts, era.code)

    @property
    def number_mask(self) -> int:
        return numbers_to_mask(self.numbers)

    @property
    def star_mask(self) -> int:
        return numbers_to_mask(self.stars)

    def index(self, era: Era = CURRENT_ERA) -> int:
        return grid_index(self.numbers, self.stars, era)

    def key(self) -> str:
        return "-".join(f"{n:02d}" for n in self.numbers) + "|" + "-".join(f"{s:02d}" for s in self.stars)

    def as_dict(self) -> dict:
        return {"numbers": list(self.numbers), "stars": list(self.stars)}


def validate_grid(numbers: Sequence[int], stars: Sequence[int], era: Era = CURRENT_ERA) -> None:
    """Lève GridValidationError si la grille n'est pas conforme."""
    if len(numbers) != NUMBERS_PER_GRID:
        raise GridValidationError(f"Une grille doit comporter exactement {NUMBERS_PER_GRID} numéros.")
    if len(stars) != STARS_PER_GRID:
        raise GridValidationError(f"Une grille doit comporter exactement {STARS_PER_GRID} étoiles.")
    for n in numbers:
        if isinstance(n, bool) or not isinstance(n, int):
            raise GridValidationError("Les numéros doivent être des entiers.")
        if not 1 <= n <= era.numbers_max:
            raise GridValidationError(f"Numéro {n} hors bornes (1 à {era.numbers_max}).")
    for s in stars:
        if isinstance(s, bool) or not isinstance(s, int):
            raise GridValidationError("Les étoiles doivent être des entiers.")
        if not 1 <= s <= era.stars_max:
            raise GridValidationError(f"Étoile {s} hors bornes (1 à {era.stars_max}).")
    if len(set(numbers)) != NUMBERS_PER_GRID:
        raise GridValidationError("Les 5 numéros doivent être distincts.")
    if len(set(stars)) != STARS_PER_GRID:
        raise GridValidationError("Les 2 étoiles doivent être distinctes.")


def is_valid_grid(numbers: Sequence[int], stars: Sequence[int], era: Era = CURRENT_ERA) -> bool:
    try:
        validate_grid(numbers, stars, era)
    except GridValidationError:
        return False
    return True


def numbers_to_mask(values: Iterable[int]) -> int:
    mask = 0
    for v in values:
        mask |= 1 << (v - 1)
    return mask


def mask_to_numbers(mask: int) -> tuple[int, ...]:
    out = []
    i = 1
    while mask:
        if mask & 1:
            out.append(i)
        mask >>= 1
        i += 1
    return tuple(out)


# ---------------------------------------------------------------------------
# Système de numération combinatoire (ordre colexicographique)
# ---------------------------------------------------------------------------


def combination_rank(sorted_values: Sequence[int]) -> int:
    """Rang colexicographique d'une combinaison triée de valeurs 1-indexées."""
    return sum(comb(v - 1, i + 1) for i, v in enumerate(sorted_values))


def combination_unrank(rank: int, k: int, n: int) -> tuple[int, ...]:
    """Inverse de combination_rank pour des combinaisons de k éléments parmi 1..n."""
    if not 0 <= rank < comb(n, k):
        raise ValueError("Rang de combinaison hors bornes.")
    values: list[int] = []
    x = n - 1
    for i in range(k, 0, -1):
        while comb(x, i) > rank:
            x -= 1
        values.append(x + 1)
        rank -= comb(x, i)
        x -= 1
    return tuple(sorted(values))


def grid_index(numbers: Sequence[int], stars: Sequence[int], era: Era = CURRENT_ERA) -> int:
    """Indice unique de la grille dans [0, C(50,5)·C(S,2)). Bijection exacte."""
    star_space = comb(era.stars_max, STARS_PER_GRID)
    return combination_rank(sorted(numbers)) * star_space + combination_rank(sorted(stars))


def grid_from_index(index: int, era: Era = CURRENT_ERA) -> Grid:
    star_space = comb(era.stars_max, STARS_PER_GRID)
    main_rank, star_rank = divmod(index, star_space)
    numbers = combination_unrank(main_rank, NUMBERS_PER_GRID, era.numbers_max)
    stars = combination_unrank(star_rank, STARS_PER_GRID, era.stars_max)
    return Grid(numbers, stars, era.code)


def count_matches(grid: Grid, draw_numbers: Sequence[int], draw_stars: Sequence[int]) -> tuple[int, int]:
    return len(set(grid.numbers) & set(draw_numbers)), len(set(grid.stars) & set(draw_stars))
