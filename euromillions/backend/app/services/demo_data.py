"""Génère le jeu de données de DÉMONSTRATION (tirages FICTIFS).

Les dates suivent le calendrier réel des tirages (vendredi seul jusqu'en mai 2011,
puis mardi et vendredi) afin d'exercer la gestion des époques de règles, mais
les numéros sont tirés au hasard avec une graine fixe : CE NE SONT PAS DE VRAIS
RÉSULTATS. Le fichier porte la mention DEMO-FICTIF sur chaque ligne.

"""

from __future__ import annotations

import random
import sys
from datetime import date, timedelta
from pathlib import Path

SEED = 20040213
END = date(2026, 10, 30)
MARKER = "DEMO-FICTIF"


def demo_dates() -> list[date]:
    out = []
    d = date(2004, 2, 13)
    while d <= END:
        if d < date(2011, 5, 10):
            if d.weekday() == 4:
                out.append(d)
        elif d.weekday() in (1, 4):
            out.append(d)
        d += timedelta(days=1)
    return out


def stars_max(d: date) -> int:
    if d < date(2011, 5, 10):
        return 9
    if d < date(2016, 9, 27):
        return 11
    return 12


def generate(path: Path) -> int:
    rng = random.Random(SEED)
    lines = [
        "# DONNÉES DE DÉMONSTRATION FICTIVES — générées aléatoirement (graine 20040213).",
        "# Ce ne sont PAS des résultats officiels EuroMillions. Ne pas utiliser comme historique réel.",
        "date;n1;n2;n3;n4;n5;e1;e2;source",
    ]
    dates = demo_dates()
    for d in dates:
        nums = sorted(rng.sample(range(1, 51), 5))
        sts = sorted(rng.sample(range(1, stars_max(d) + 1), 2))
        lines.append(";".join([d.strftime("%d/%m/%Y"), *map(str, nums), *map(str, sts), MARKER]))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(dates)
