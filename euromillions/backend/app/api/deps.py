"""Dépendances et utilitaires communs aux routes."""

from __future__ import annotations

import threading
from datetime import date
from typing import Any, Callable

import numpy as np
from fastapi import Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db, session_factory
from app.models import DataSource, Draw, Portfolio, SavedGrid
from app.services.export import MEDIA_TYPES
from app.services.jobs import Job, get_job_manager
from app.services.statistics import DrawSet, load_drawset


class DrawFilters:
    def __init__(
        self,
        date_from: date | None = Query(default=None, description="Date de début (incluse)"),
        date_to: date | None = Query(default=None, description="Date de fin (incluse)"),
        last_n: int | None = Query(default=None, ge=1, le=100_000, description="N derniers tirages"),
        era: str | None = Query(default=None, description="Époque de règles : E2004, E2011, E2016"),
    ):
        self.date_from, self.date_to, self.last_n, self.era = date_from, date_to, last_n, era

    def key(self) -> tuple:
        return (self.date_from, self.date_to, self.last_n, self.era)


def data_version(db: Session) -> tuple:
    return tuple(db.execute(select(func.count(Draw.id), func.max(Draw.id), func.max(Draw.created_at))).one())


_stats_cache: dict[tuple, Any] = {}
_cache_lock = threading.Lock()


def cached_stat(db: Session, name: str, filters: DrawFilters, extra: tuple, fn: Callable[[DrawSet], Any]) -> Any:
    key = (name, data_version(db), filters.key(), extra)
    with _cache_lock:
        if key in _stats_cache:
            return _stats_cache[key]
    ds = load_drawset(db, filters.date_from, filters.date_to, filters.last_n, filters.era)
    value = fn(ds)
    with _cache_lock:
        if len(_stats_cache) > 256:
            _stats_cache.clear()
        _stats_cache[key] = value
    return value


def get_drawset(filters: DrawFilters = Depends(), db: Session = Depends(get_db)) -> DrawSet:
    return load_drawset(db, filters.date_from, filters.date_to, filters.last_n, filters.era)


def past_draw_set(db: Session) -> frozenset[tuple[int, ...]]:
    rows = db.execute(select(Draw.n1, Draw.n2, Draw.n3, Draw.n4, Draw.n5)).all()
    return frozenset(tuple(r) for r in rows)


def history_counts(db: Session, window: int | None) -> dict[str, Any]:
    ds = load_drawset(db, last_n=window)
    if ds.size == 0:
        return {"draws": 0}
    current = ds.subset(ds.stars_max == 12)
    return {
        "draws": ds.size,
        "number_counts": np.bincount(ds.numbers.ravel().astype(int) - 1, minlength=50).tolist(),
        "star_counts": np.bincount(current.stars.ravel().astype(int) - 1, minlength=12).tolist()
        if current.size else [0] * 12,
    }


def is_demo_data(db: Session) -> bool:
    return db.scalar(select(DataSource.id).where(DataSource.is_demo.is_(True)).limit(1)) is not None


def draw_out(d: Draw) -> dict[str, Any]:
    return {
        "id": d.id,
        "draw_date": d.draw_date.isoformat(),
        "weekday": ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][d.draw_date.weekday()],
        "numbers": d.numbers,
        "stars": d.stars,
        "era_code": d.era_code,
        "stars_max": d.stars_max,
        "jackpot_eur": d.jackpot_eur,
        "source_id": d.source_id,
        "prizes": [{"rank": p.rank, "winners": p.winners, "prize_eur": p.prize_eur} for p in d.prizes],
    }


def grid_out(g: SavedGrid) -> dict[str, Any]:
    return {
        "id": g.id, "numbers": g.numbers, "stars": g.stars, "combo_index": g.combo_index,
        "strategy": g.strategy_code, "diversity_score": g.diversity_score, "label": g.label,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }


def portfolio_summary(p: Portfolio) -> dict[str, Any]:
    return {
        "id": p.id, "name": p.name, "strategy_code": p.strategy_code, "n_grids": len(p.grids),
        "seed": p.seed, "objective": p.objective, "ticket_price": p.ticket_price, "is_individual": p.is_individual,
        "notes": p.notes, "created_at": p.created_at.isoformat() if p.created_at else None,
        "params": p.params,
        "has_exact_analysis": bool((p.metrics or {}).get("exact")),
    }


def get_portfolio_or_404(db: Session, pid: int) -> Portfolio:
    p = db.get(Portfolio, pid)
    if p is None:
        raise HTTPException(404, f"Portefeuille {pid} introuvable.")
    return p


def portfolio_pairs(p: Portfolio) -> list[tuple[tuple[int, ...], tuple[int, ...]]]:
    return [(tuple(g.numbers), tuple(g.stars)) for g in p.grids]


def file_response(content: bytes, fmt: str, basename: str) -> Response:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in basename)[:80] or "export"
    return Response(content, media_type=MEDIA_TYPES[fmt],
                    headers={"Content-Disposition": f'attachment; filename="{safe}.{fmt}"'})


def job_response(job: Job, **extra: Any) -> dict[str, Any]:
    return {"job": job.public(include_result=False), **extra}


def submit_job(kind: str, fn, on_done=None, meta: dict[str, Any] | None = None) -> Job:
    from app.services.jobs import TooManyJobs

    try:
        return get_job_manager().submit(kind, fn, on_done, meta)
    except TooManyJobs as exc:
        raise HTTPException(429, str(exc)) from exc


def new_session() -> Session:
    return session_factory()()
