"""Routes : santé, mathématiques, tâches, paramètres."""

from __future__ import annotations

from datetime import datetime, timezone
from fractions import Fraction

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app import __version__
from app.api.deps import (
    get_portfolio_or_404,
    job_response,
    new_session,
    portfolio_pairs,
    submit_job,
)
from app.config import get_settings
from app.core.probability import (
    FORMULA_NOTES,
    any_prize_probability,
    jackpot_probability,
    portfolio_jackpot_probability,
    probability_payload,
    repeated_draws_probability,
    repeated_draws_probability_float,
    tier_table,
    total_combinations,
)
from app.core.rules import CURRENT_ERA, ERAS, get_era
from app.db import get_db
from app.models import Draw, Portfolio
from app.schemas import ExactAnalysisIn, SettingsIn
from app.security import expensive
from app.services import settings_store
from app.services.jobs import get_job_manager
from app.services.portfolio_exact import exact_portfolio_analysis

router = APIRouter()


@router.get("/health", tags=["Système"])
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "app": get_settings().app_name,
        "version": __version__,
        "time": datetime.now(timezone.utc).isoformat(),
        "draws": db.scalar(select(func.count(Draw.id))),
        "database": "sqlite" if get_settings().database_url.startswith("sqlite") else "sql",
    }


# ---------------------------------------------------------------------------
# Mathématiques
# ---------------------------------------------------------------------------


@router.get("/math/rules", tags=["Mathématiques"])
def rules() -> dict:
    return {
        "eras": [
            {"code": e.code, "label": e.label, "start": e.start.isoformat(), "end": e.end.isoformat() if e.end else None,
             "numbers_max": e.numbers_max, "stars_max": e.stars_max, "total_combinations": e.total_combinations,
             "draw_weekdays": list(e.draw_weekdays)}
            for e in ERAS
        ],
        "current_era": CURRENT_ERA.code,
        "numbers_per_grid": 5,
        "stars_per_grid": 2,
        "total_combinations": total_combinations(),
        "formulas": FORMULA_NOTES,
    }


@router.get("/math/probabilities", tags=["Mathématiques"])
def probabilities(era: str | None = None) -> dict:
    e = get_era(era)
    return {
        "era": e.code,
        "total_combinations": total_combinations(e),
        "jackpot": probability_payload(jackpot_probability(e)),
        "any_prize": probability_payload(any_prize_probability(e)),
        "tiers": tier_table(e),
        "fairness": FORMULA_NOTES["fairness"],
    }


@router.get("/math/portfolio", tags=["Mathématiques"])
def portfolio_probability(n_grids: int = Query(1, ge=0, le=139_838_160), n_draws: int = Query(1, ge=0, le=100_000)) -> dict:
    p = portfolio_jackpot_probability(n_grids)
    if n_draws <= 520:
        horizon = probability_payload(repeated_draws_probability(p, n_draws))
        exact = True
    else:
        v = repeated_draws_probability_float(float(p), n_draws)
        horizon = {"value": v, "percent": f"{v * 100:.6g} %".replace(".", ","), "one_in":
                   f"1 chance sur ≈ {round(1 / v):,}".replace(",", " ") if v > 0 else "aucune chance",
                   "scientific": f"{v:.5E}".replace(".", ","), "fraction": None}
        exact = False
    return {
        "n_grids": n_grids,
        "n_draws": n_draws,
        "single_draw": probability_payload(p),
        "horizon": horizon,
        "horizon_exact": exact,
        "formulas": {"single": FORMULA_NOTES["portfolio"], "repeated": FORMULA_NOTES["repeated"]},
    }


@router.post("/math/exact-portfolio", tags=["Mathématiques"], dependencies=[Depends(expensive)])
def exact_portfolio(body: ExactAnalysisIn, db: Session = Depends(get_db)) -> dict:
    limit = get_settings().exact_portfolio_max_grids
    pid = body.portfolio_id
    if pid is not None:
        grids = portfolio_pairs(get_portfolio_or_404(db, pid))
    elif body.grids:
        grids = [g.pair() for g in body.grids]
    else:
        raise HTTPException(400, "Indiquez un portefeuille ou une liste de grilles.")
    if len(grids) > limit:
        raise HTTPException(400, f"Analyse exacte limitée à {limit} grilles (EM_EXACT_PORTFOLIO_MAX_GRIDS). "
                                 "Utilisez le simulateur Monte-Carlo au-delà.")

    def on_done(job):
        if job.status == "done" and pid is not None:
            with new_session() as s:
                p = s.get(Portfolio, pid)
                if p is not None:
                    p.metrics = {**(p.metrics or {}), "exact": {
                        "p_any_win": job.result["p_any_win"]["value"],
                        "tiers": [{"rank": t["rank"], "p": t["p_at_least_one"]["value"]} for t in job.result["tiers"]],
                        "computed_at": job.finished_at}}
                    s.commit()

    job = submit_job("exact_portfolio", lambda progress, cancel: exact_portfolio_analysis(grids, progress, cancel),
                     on_done, {"n_grids": len(grids), "portfolio_id": pid})
    return job_response(job)


# ---------------------------------------------------------------------------
# Tâches
# ---------------------------------------------------------------------------


@router.get("/jobs", tags=["Tâches"])
def list_jobs(limit: int = Query(50, ge=1, le=200)) -> list[dict]:
    return [j.public(include_result=False) for j in get_job_manager().list(limit)]


@router.get("/jobs/{job_id}", tags=["Tâches"])
def get_job(job_id: str) -> dict:
    job = get_job_manager().get(job_id)
    if job is None:
        raise HTTPException(404, "Tâche introuvable (elle a pu expirer après un redémarrage).")
    return job.public(include_result=job.status == "done")


@router.post("/jobs/{job_id}/cancel", tags=["Tâches"])
def cancel_job(job_id: str) -> dict:
    job = get_job_manager().cancel(job_id)
    if job is None:
        raise HTTPException(404, "Tâche introuvable.")
    return job.public(include_result=False)


# ---------------------------------------------------------------------------
# Paramètres
# ---------------------------------------------------------------------------


@router.get("/settings", tags=["Paramètres"])
def get_settings_route(db: Session = Depends(get_db)) -> dict:
    s = get_settings()
    return {
        **settings_store.get_all(db),
        "limits": {
            "max_grids_per_request": s.max_grids_per_request,
            "max_simulation_draws": s.max_simulation_draws,
            "max_simulation_work": s.max_simulation_work,
            "exact_portfolio_max_grids": s.exact_portfolio_max_grids,
            "max_upload_mb": s.max_upload_mb,
            "allowed_import_hosts": s.allowed_hosts_list,
            "api_key_required": bool(s.api_key),
        },
    }


@router.put("/settings", tags=["Paramètres"])
def put_settings(body: SettingsIn, db: Session = Depends(get_db)) -> dict:
    values = body.model_dump(exclude_unset=True)
    settings_store.update_settings(db, values)
    return get_settings_route(db)


def ticket_price(db: Session, override: float | None) -> float:
    return float(override) if override is not None else float(settings_store.get_setting(db, "ticket_price"))


__all__ = ["router", "ticket_price", "Fraction"]
