"""Règles du jeu EuroMillions et leurs évolutions historiques.

Les règles sont décrites par « époques » (eras). Les numéros principaux ont
toujours été tirés parmi 1 à 50 ; le nombre d'étoiles a changé :

* 13/02/2004 → 06/05/2011 : 2 étoiles parmi 1 à 9, tirage le vendredi.
* 10/05/2011 → 23/09/2016 : 2 étoiles parmi 1 à 11, tirages mardi et vendredi.
* depuis le 27/09/2016    : 2 étoiles parmi 1 à 12, tirages mardi et vendredi.

Ces dates sont des données de configuration : elles peuvent être vérifiées et
corrigées ici sans toucher au reste du code.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from math import comb

NUMBERS_MAX = 50
NUMBERS_PER_GRID = 5
STARS_PER_GRID = 2
GAME_START = date(2004, 2, 13)


@dataclass(frozen=True)
class Era:
    code: str
    label: str
    start: date
    end: date | None  # inclus ; None = en cours
    numbers_max: int
    stars_max: int
    draw_weekdays: tuple[int, ...]  # 0 = lundi … 4 = vendredi

    def contains(self, d: date) -> bool:
        return d >= self.start and (self.end is None or d <= self.end)

    @property
    def total_combinations(self) -> int:
        return comb(self.numbers_max, NUMBERS_PER_GRID) * comb(self.stars_max, STARS_PER_GRID)


ERAS: tuple[Era, ...] = (
    Era("E2004", "2004-2011 : étoiles 1 à 9", date(2004, 2, 13), date(2011, 5, 9), 50, 9, (4,)),
    Era("E2011", "2011-2016 : étoiles 1 à 11", date(2011, 5, 10), date(2016, 9, 26), 50, 11, (1, 4)),
    Era("E2016", "Depuis 2016 : étoiles 1 à 12", date(2016, 9, 27), None, 50, 12, (1, 4)),
)

CURRENT_ERA: Era = ERAS[-1]
ERAS_BY_CODE: dict[str, Era] = {e.code: e for e in ERAS}


def era_for_date(d: date) -> Era:
    """Retourne l'époque de règles applicable à une date de tirage."""
    if d < GAME_START:
        raise ValueError(f"La date {d.isoformat()} est antérieure au premier tirage EuroMillions (13/02/2004).")
    for era in ERAS:
        if era.contains(d):
            return era
    # Les intervalles couvrent toute la chronologie ; ceci ne devrait jamais arriver.
    raise ValueError(f"Aucune époque de règles pour la date {d.isoformat()}.")


def get_era(code: str | None) -> Era:
    if code is None:
        return CURRENT_ERA
    try:
        return ERAS_BY_CODE[code]
    except KeyError as exc:
        raise ValueError(f"Époque inconnue : {code}") from exc


@dataclass(frozen=True)
class PrizeTier:
    rank: int
    numbers: int
    stars: int

    @property
    def label(self) -> str:
        return f"{self.numbers} + {self.stars}"


# Rangs officiels de l'époque actuelle (13 rangs). L'ordre coïncide avec l'ordre
# des probabilités exactes croissantes (vérifié par les tests).
CURRENT_TIERS: tuple[PrizeTier, ...] = (
    PrizeTier(1, 5, 2),
    PrizeTier(2, 5, 1),
    PrizeTier(3, 5, 0),
    PrizeTier(4, 4, 2),
    PrizeTier(5, 4, 1),
    PrizeTier(6, 3, 2),
    PrizeTier(7, 4, 0),
    PrizeTier(8, 2, 2),
    PrizeTier(9, 3, 1),
    PrizeTier(10, 3, 0),
    PrizeTier(11, 1, 2),
    PrizeTier(12, 2, 1),
    PrizeTier(13, 2, 0),
)

WINNING_MATCHES: frozenset[tuple[int, int]] = frozenset((t.numbers, t.stars) for t in CURRENT_TIERS)


@lru_cache(maxsize=None)
def tiers_for_era(era: Era) -> tuple[PrizeTier, ...]:
    """Rangs de gains d'une époque.

    Pour l'époque actuelle : barème officiel à 13 rangs. Pour les époques
    antérieures, l'ordre des rangs est déduit des probabilités exactes
    (le rang 2+0 n'existait pas avant mai 2011). Ces barèmes historiques sont
    fournis à titre indicatif et doivent être confirmés par la source officielle.
    """
    if era.code == CURRENT_ERA.code:
        return CURRENT_TIERS
    from app.core.probability import match_count  # import local : évite un cycle

    matches = [(t.numbers, t.stars) for t in CURRENT_TIERS]
    if era.code == "E2004":
        matches = [m for m in matches if m != (2, 0)]
    ordered = sorted(matches, key=lambda m: match_count(m[0], m[1], era))
    return tuple(PrizeTier(i + 1, k, s) for i, (k, s) in enumerate(ordered))


def rank_for_matches(numbers_matched: int, stars_matched: int, era: Era = CURRENT_ERA) -> int | None:
    """Rang de gain pour un nombre de bons numéros et d'étoiles (None = pas de gain)."""
    for tier in tiers_for_era(era):
        if tier.numbers == numbers_matched and tier.stars == stars_matched:
            return tier.rank
    return None
