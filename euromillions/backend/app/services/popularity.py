"""Indice heuristique de « motif populaire ».

IMPORTANT : la popularité réelle des combinaisons (quelles grilles les joueurs
choisissent) n'est pas publiée. Cet indice ne mesure donc **pas** un taux de
popularité : il signale seulement la présence de motifs connus pour être
fréquemment joués (dates, suites, alignements…). Les pondérations ci-dessous
sont des choix de conception documentés, pas des estimations statistiques.

Éviter ces motifs ne change pas la probabilité de gagner ; cela pourrait
seulement, *si* ces motifs sont réellement plus joués, réduire le partage
d'un gain éventuel.
"""

from __future__ import annotations

from typing import Iterable, Sequence

# Pondérations des motifs (choix de conception, voir documentation).
WEIGHTS = {
    "dates": 0.30,
    "arithmetic": 0.35,
    "run3": 0.10,
    "run4": 0.20,
    "same_row": 0.15,
    "same_column": 0.15,
    "multiples_of_5": 0.15,
    "past_draw": 0.30,
}

DESCRIPTIONS = {
    "dates": "Tous les numéros ≤ 31 (dates de naissance ou anniversaires).",
    "arithmetic": "Suite arithmétique (écart constant : 1-2-3-4-5, 5-10-15-20-25, diagonales…).",
    "run3": "Au moins trois numéros consécutifs.",
    "run4": "Au moins quatre numéros consécutifs.",
    "same_row": "Au moins quatre numéros sur une même ligne du bulletin (hypothèse : lignes de 10 numéros).",
    "same_column": "Au moins trois numéros dans une même colonne (même chiffre des unités).",
    "multiples_of_5": "Au moins quatre multiples de 5.",
    "past_draw": "Les cinq numéros reproduisent un tirage passé de l'historique importé.",
}

DISCLAIMER = (
    "Indice heuristique de motif (0 à 1), pas une popularité mesurée : aucune donnée publique ne permet de "
    "connaître les combinaisons choisies par les joueurs. Il ne modifie en rien la probabilité de gain."
)


def _longest_run(nums: Sequence[int]) -> int:
    best = cur = 1
    for a, b in zip(nums, nums[1:]):
        cur = cur + 1 if b == a + 1 else 1
        best = max(best, cur)
    return best


def pattern_flags(numbers: Sequence[int], past_draws: frozenset[tuple[int, ...]] | None = None) -> list[str]:
    nums = sorted(numbers)
    flags: list[str] = []
    if nums[-1] <= 31:
        flags.append("dates")
    diffs = {b - a for a, b in zip(nums, nums[1:])}
    if len(diffs) == 1:
        flags.append("arithmetic")
    run = _longest_run(nums)
    if run >= 4 and "arithmetic" not in flags:
        flags.append("run4")
    elif run == 3:
        flags.append("run3")
    rows: dict[int, int] = {}
    cols: dict[int, int] = {}
    for n in nums:
        rows[(n - 1) // 10] = rows.get((n - 1) // 10, 0) + 1
        cols[n % 10] = cols.get(n % 10, 0) + 1
    if max(rows.values()) >= 4:
        flags.append("same_row")
    if max(cols.values()) >= 3:
        flags.append("same_column")
    if sum(1 for n in nums if n % 5 == 0) >= 4:
        flags.append("multiples_of_5")
    if past_draws and tuple(nums) in past_draws:
        flags.append("past_draw")
    return flags


def pattern_score(numbers: Sequence[int], past_draws: frozenset[tuple[int, ...]] | None = None) -> float:
    return min(1.0, sum(WEIGHTS[f] for f in pattern_flags(numbers, past_draws)))


def explain(numbers: Sequence[int], stars: Iterable[int] = (), past_draws: frozenset[tuple[int, ...]] | None = None) -> dict:
    flags = pattern_flags(numbers, past_draws)
    return {
        "score": min(1.0, sum(WEIGHTS[f] for f in flags)),
        "patterns": [{"code": f, "weight": WEIGHTS[f], "description": DESCRIPTIONS[f]} for f in flags],
        "disclaimer": DISCLAIMER,
    }
