"""Génère le fichier de démonstration (tirages FICTIFS). Usage : python scripts/generate_demo_data.py [sortie]"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.demo_data import generate  # noqa: E402

if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "demo_tirages_FICTIFS.csv"
    n = generate(target)
    print(f"{n} tirages fictifs écrits dans {target}")
