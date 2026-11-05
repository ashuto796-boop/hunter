"""Moteur de probabilités exactes.

Tous les calculs internes utilisent des entiers et des fractions exactes
(``fractions.Fraction``). Les conversions en flottants ne servent qu'à
l'affichage.

Hypothèse commune à tout ce module : tirage équitable, c'est-à-dire que les
C(50,5) combinaisons de numéros et les C(S,2) paires d'étoiles sont
équiprobables et tirées indépendamment.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, getcontext
from fractions import Fraction
from math import comb

from app.core.rules import CURRENT_ERA, NUMBERS_PER_GRID, STARS_PER_GRID, Era, PrizeTier, tiers_for_era

getcontext().prec = 50


def total_combinations(era: Era = CURRENT_ERA) -> int:
    """C(50,5) × C(S,2) — 139 838 160 pour l'époque actuelle."""
    return comb(era.numbers_max, NUMBERS_PER_GRID) * comb(era.stars_max, STARS_PER_GRID)


def match_count(numbers_matched: int, stars_matched: int, era: Era = CURRENT_ERA) -> int:
    """Nombre de tirages (sur le total) donnant exactement k bons numéros et s bonnes étoiles
    pour une grille donnée."""
    k, s = numbers_matched, stars_matched
    if not (0 <= k <= NUMBERS_PER_GRID and 0 <= s <= STARS_PER_GRID):
        raise ValueError("Nombre de correspondances hors bornes.")
    n_other = era.numbers_max - NUMBERS_PER_GRID
    s_other = era.stars_max - STARS_PER_GRID
    return (
        comb(NUMBERS_PER_GRID, k)
        * comb(n_other, NUMBERS_PER_GRID - k)
        * comb(STARS_PER_GRID, s)
        * comb(s_other, STARS_PER_GRID - s)
    )


def match_probability(numbers_matched: int, stars_matched: int, era: Era = CURRENT_ERA) -> Fraction:
    """Probabilité exacte d'obtenir exactement k bons numéros et s bonnes étoiles."""
    return Fraction(match_count(numbers_matched, stars_matched, era), total_combinations(era))


def jackpot_probability(era: Era = CURRENT_ERA) -> Fraction:
    return Fraction(1, total_combinations(era))


def tier_probabilities(era: Era = CURRENT_ERA) -> list[tuple[PrizeTier, Fraction]]:
    return [(t, match_probability(t.numbers, t.stars, era)) for t in tiers_for_era(era)]


def any_prize_probability(era: Era = CURRENT_ERA) -> Fraction:
    return sum((p for _, p in tier_probabilities(era)), Fraction(0))


def portfolio_jackpot_probability(n_distinct_grids: int, era: Era = CURRENT_ERA) -> Fraction:
    """P(au moins un jackpot) pour N grilles **distinctes** jouées sur **un même** tirage.

    Les événements « la grille i gagne le jackpot » sont deux à deux
    incompatibles (un seul tirage gagnant), d'où P = N / total, exactement.
    """
    total = total_combinations(era)
    if not 0 <= n_distinct_grids <= total:
        raise ValueError(f"Le nombre de grilles distinctes doit être compris entre 0 et {total}.")
    return Fraction(n_distinct_grids, total)


def repeated_draws_probability(p_single_draw: Fraction, n_draws: int) -> Fraction:
    """P(au moins un succès sur T tirages indépendants) = 1 − (1 − p)^T, exactement.

    Hypothèses : tirages indépendants, même probabilité p à chaque tirage
    (même nombre de grilles distinctes à chaque tirage).
    """
    if n_draws < 0:
        raise ValueError("Le nombre de tirages doit être positif.")
    if not 0 <= p_single_draw <= 1:
        raise ValueError("La probabilité doit être comprise entre 0 et 1.")
    return 1 - (1 - p_single_draw) ** n_draws


def repeated_draws_probability_float(p_single_draw: float, n_draws: int) -> float:
    """Version flottante numériquement stable (log1p/expm1) pour les grands T."""
    import math

    if p_single_draw >= 1:
        return 1.0
    return -math.expm1(n_draws * math.log1p(-p_single_draw))


# ---------------------------------------------------------------------------
# Formatage des probabilités
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProbabilityDisplay:
    numerator: int
    denominator: int
    fraction: str
    percent: str
    scientific: str
    one_in: str
    value: float


def _fmt_int(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def _fmt_decimal(value: Decimal, digits: int) -> str:
    return format(value, f".{digits}g")


def format_probability(p: Fraction, significant: int = 6) -> ProbabilityDisplay:
    """Représente une probabilité exacte sous plusieurs formats.

    * fraction irréductible ;
    * pourcentage (chiffres significatifs) ;
    * notation scientifique ;
    * « 1 chance sur N » (N = 1/p, arrondi à l'entier le plus proche si non entier).
    """
    if p < 0 or p > 1:
        raise ValueError("Une probabilité doit être comprise entre 0 et 1.")
    num, den = p.numerator, p.denominator
    dec = Decimal(num) / Decimal(den)
    if num == 0:
        percent = "0 %"
        scientific = "0"
        one_in = "aucune chance"
    else:
        pct = dec * 100
        percent = f"{_fmt_decimal(pct, significant)} %".replace(".", ",")
        scientific = f"{dec:.{max(significant - 1, 0)}E}".replace(".", ",")
        inverse = Fraction(den, num)
        if inverse.denominator == 1:
            one_in = f"1 chance sur {_fmt_int(inverse.numerator)}"
        else:
            approx = Decimal(den) / Decimal(num)
            if approx < 10:
                one_in = f"1 chance sur {str(round(approx, 2)).replace('.', ',')}"
            else:
                one_in = f"1 chance sur ≈ {_fmt_int(int(approx.to_integral_value()))}"
    return ProbabilityDisplay(
        numerator=num,
        denominator=den,
        fraction=f"{_fmt_int(num)} / {_fmt_int(den)}",
        percent=percent,
        scientific=scientific,
        one_in=one_in,
        value=float(dec),
    )


def probability_payload(p: Fraction) -> dict:
    d = format_probability(p)
    return {
        "numerator": d.numerator,
        "denominator": d.denominator,
        "fraction": d.fraction,
        "percent": d.percent,
        "scientific": d.scientific,
        "one_in": d.one_in,
        "value": d.value,
    }


def tier_table(era: Era = CURRENT_ERA) -> list[dict]:
    """Table complète des rangs de gains avec probabilités exactes."""
    rows = []
    for tier, p in tier_probabilities(era):
        rows.append(
            {
                "rank": tier.rank,
                "numbers": tier.numbers,
                "stars": tier.stars,
                "label": tier.label,
                "winning_combinations": match_count(tier.numbers, tier.stars, era),
                "probability": probability_payload(p),
            }
        )
    return rows


FORMULA_NOTES: dict[str, str] = {
    "total": "C(50,5) × C(12,2) = 2 118 760 × 66 = 139 838 160 combinaisons (époque actuelle).",
    "tier": "P(k numéros, s étoiles) = C(5,k)·C(45,5−k)/C(50,5) × C(2,s)·C(10,2−s)/C(12,2).",
    "portfolio": (
        "Pour N grilles distinctes sur un même tirage : P(jackpot) = N / 139 838 160. "
        "Exact car au plus une grille peut correspondre au tirage gagnant. "
        "Ne s'applique pas aux rangs secondaires, où plusieurs grilles peuvent gagner simultanément."
    ),
    "repeated": (
        "Pour T tirages indépendants avec N grilles distinctes par tirage : "
        "P(au moins un jackpot) = 1 − (1 − N/139 838 160)^T. Hypothèses : tirages indépendants "
        "et équitables, même nombre de grilles distinctes à chaque tirage, règles inchangées."
    ),
    "fairness": (
        "Sous l'hypothèse d'un tirage équitable, chaque grille valide a exactement la même "
        "probabilité de gagner le jackpot. Aucun score de ce logiciel n'est une probabilité de sortie."
    ),
}
