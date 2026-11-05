"""Vérification de grilles contre un tirage officiel."""

from __future__ import annotations

from typing import Any, Sequence

from app.core.grid import Grid, validate_grid
from app.core.rules import Era, rank_for_matches


def check_grids(
    grids: Sequence[tuple[Sequence[int], Sequence[int]]],
    draw_numbers: Sequence[int],
    draw_stars: Sequence[int],
    era: Era,
    prizes: dict[int, float | None] | None = None,
) -> dict[str, Any]:
    """Compare chaque grille au tirage. Les gains ne sont affichés que s'ils figurent dans le barème importé."""
    validate_grid(list(draw_numbers), list(draw_stars), era)
    dn, dstar = set(draw_numbers), set(draw_stars)
    prizes = prizes or {}
    lines = []
    by_rank: dict[int, int] = {}
    total_known = 0.0
    unknown_amounts = 0
    for numbers, stars in grids:
        g = Grid.create(numbers, stars, era)
        mn = sorted(dn & set(g.numbers))
        ms = sorted(dstar & set(g.stars))
        rank = rank_for_matches(len(mn), len(ms), era)
        prize = None
        if rank is not None:
            by_rank[rank] = by_rank.get(rank, 0) + 1
            prize = prizes.get(rank)
            if prize is None:
                unknown_amounts += 1
            else:
                total_known += prize
        lines.append({
            "numbers": list(g.numbers),
            "stars": list(g.stars),
            "matched_numbers": mn,
            "matched_stars": ms,
            "n_matched_numbers": len(mn),
            "n_matched_stars": len(ms),
            "rank": rank,
            "prize": prize,
            "prize_known": prize is not None,
        })
    winners = sum(by_rank.values())
    return {
        "draw": {"numbers": sorted(draw_numbers), "stars": sorted(draw_stars), "era": era.code},
        "lines": lines,
        "summary": {
            "grids": len(lines),
            "winning_grids": winners,
            "by_rank": {str(k): v for k, v in sorted(by_rank.items())},
            "total_known_prizes": round(total_known, 2),
            "wins_with_unknown_amount": unknown_amounts,
            "prize_table_available": bool(prizes),
        },
        "note": (
            "Les montants proviennent exclusivement du barème importé avec le tirage. "
            "En son absence, le rang est indiqué sans montant (aucun gain n'est inventé)."
        ),
    }
