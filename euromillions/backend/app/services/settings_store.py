"""Paramètres utilisateur persistés en base (avec valeurs par défaut configurables)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AppSetting, utcnow


def defaults() -> dict[str, Any]:
    s = get_settings()
    return {
        "ticket_price": s.default_ticket_price,
        "ticket_price_source": (
            "Valeur par défaut : 2,50 € par grille (prix pratiqué en France par la FDJ, My Million inclus). "
            "À vérifier auprès de votre opérateur et à modifier si nécessaire."
        ),
        "currency": s.currency,
        "draws_per_week": 2,
        "default_seed": None,
        "show_demo_banner": True,
        "official_source_url": "",
        "last_refresh": None,
    }


EDITABLE_KEYS = {"ticket_price", "ticket_price_source", "currency", "draws_per_week", "default_seed",
                 "show_demo_banner", "official_source_url"}


def get_all(db: Session) -> dict[str, Any]:
    values = defaults()
    for row in db.query(AppSetting).all():
        values[row.key] = row.value
    return values


def get_setting(db: Session, key: str) -> Any:
    row = db.get(AppSetting, key)
    return row.value if row is not None else defaults().get(key)


def set_setting(db: Session, key: str, value: Any) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value, updated_at=utcnow()))
    else:
        row.value = value
        row.updated_at = utcnow()
    db.commit()


def update_settings(db: Session, values: dict[str, Any]) -> dict[str, Any]:
    for key, value in values.items():
        if key not in EDITABLE_KEYS:
            raise ValueError(f"Paramètre non modifiable : {key}")
        if key == "ticket_price" and (not isinstance(value, (int, float)) or not 0 < float(value) <= 100):
            raise ValueError("Le prix d'une grille doit être compris entre 0 et 100.")
        if key == "draws_per_week" and value not in (1, 2):
            raise ValueError("Le nombre de tirages par semaine doit être 1 ou 2.")
        set_setting(db, key, value)
    return get_all(db)
