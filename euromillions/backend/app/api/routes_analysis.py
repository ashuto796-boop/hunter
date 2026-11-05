"""Routes : simulations, vérification des résultats, budget, jackpot, IA, recherche, audit."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import (
    file_response,
    get_portfolio_or_404,
    job_response,
    new_session,
    portfolio_pairs,
    submit_job,
)
from app.api.routes_core import ticket_price
from app.config import get_settings
from app.core.rules import CURRENT_ERA, era_for_date, get_era
from app.db import get_db
from app.models import Draw, DrawPrize, Experiment, GridResult, Portfolio, Report, ResultCheck, Simulation, utcnow
from app.schemas import JackpotIn, MLRunIn, ResearchIn, ResultCheckIn, SimulationIn
from app.security import expensive
from app.services import settings_store
from app.services.audit import run_audit
from app.services.budget import BudgetInput, budget_analysis
from app.services.export import export_rows, to_json, to_pdf
from app.services.jackpot import JackpotInput, jackpot_analysis
from app.services.jobs import get_job_manager
from app.services.ml_lab import MODELS, run_ml_experiment
from app.services.research import HYPOTHESES, ResearchConfig, run_research
from app.services.results import check_grids
from app.services.simulation import PortfolioInput, SimulationConfig, random_portfolio, run_simulation, simulation_work
from app.services.statistics import load_drawset

router = APIRouter()


# ---------------------------------------------------------------------------
# Simulations Monte-Carlo
# ---------------------------------------------------------------------------


def _sim_out(s: Simulation, include_results: bool = True) -> dict[str, Any]:
    job_id = (s.params or {}).get("job_id")
    job = get_job_manager().get(job_id) if job_id else None
    status = s.status
    if job is not None and s.status in ("pending", "running"):
        status = job.status if job.status != "queued" else "pending"
    out = {"id": s.id, "status": status, "params": s.params, "seed": s.seed, "n_draws": s.n_draws,
           "created_at": s.created_at.isoformat(), "finished_at": s.finished_at.isoformat() if s.finished_at else None,
           "duration_s": s.duration_s, "error": s.error,
           "progress": job.progress if job else (1.0 if s.status == "done" else 0.0),
           "message": job.message if job else ""}
    if include_results:
        out["results"] = s.results
    return out


@router.post("/simulations/run", tags=["Simulations"], dependencies=[Depends(expensive)])
def run_sim(body: SimulationIn, db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    if body.n_draws > settings.max_simulation_draws:
        raise HTTPException(400, f"Au plus {settings.max_simulation_draws:,} tirages simulés.".replace(",", " "))
    pfs: list[PortfolioInput] = []
    for pid in body.portfolio_ids:
        p = get_portfolio_or_404(db, pid)
        if not p.grids:
            raise HTTPException(400, f"Le portefeuille « {p.name} » est vide.")
        pfs.append(PortfolioInput(p.name, portfolio_pairs(p), p.id))
    for ip in body.inline_portfolios:
        pfs.append(PortfolioInput(ip.name, [g.pair() for g in ip.grids]))
    for k, n in enumerate(body.random_baselines):
        pfs.append(PortfolioInput(f"Référence aléatoire ({n} grilles)", random_portfolio(n, (body.seed or 0) + 1000 + k)))
    if not pfs:
        raise HTTPException(400, "Sélectionnez au moins un portefeuille.")
    work = simulation_work(pfs, body.n_draws)
    if work > settings.max_simulation_work:
        raise HTTPException(400, f"Calcul trop lourd ({work:,} évaluations ; limite {settings.max_simulation_work:,}). "
                                 "Réduisez le nombre de tirages ou de grilles.".replace(",", " "))
    from app.core.rng import new_seed

    seed = body.seed if body.seed is not None else new_seed()
    price = ticket_price(db, body.ticket_price)
    cfg = SimulationConfig(pfs, body.n_draws, seed, price, {int(k): v for k, v in body.payouts.items()}, body.jackpot)
    params = {"portfolios": [{"name": p.name, "portfolio_id": p.portfolio_id, "n_grids": len(p.grids)} for p in pfs],
              "ticket_price": price, "payouts": {str(k): v for k, v in body.payouts.items()}, "jackpot": body.jackpot}
    sim = Simulation(status="pending", params=params, seed=seed, n_draws=body.n_draws)
    db.add(sim)
    db.commit()
    sim_id = sim.id

    def on_done(job) -> None:
        with new_session() as s:
            row = s.get(Simulation, sim_id)
            if row is None:
                return
            row.status = job.status if job.status in ("done", "error", "cancelled") else "error"
            row.results = job.result if job.status == "done" else None
            row.error = job.error
            row.duration_s = job.meta.get("duration_s")
            row.finished_at = utcnow()
            s.commit()

    job = submit_job("simulation", lambda progress, cancel: run_simulation(cfg, progress, cancel), on_done,
                     {"simulation_id": sim_id})
    sim.params = {**params, "job_id": job.id}
    sim.status = "running"
    db.commit()
    return job_response(job, simulation_id=sim_id)


@router.get("/simulations", tags=["Simulations"])
def list_sims(db: Session = Depends(get_db)) -> list[dict]:
    return [_sim_out(s, False) for s in db.scalars(select(Simulation).order_by(Simulation.created_at.desc()).limit(100))]


@router.get("/simulations/{sid}", tags=["Simulations"])
def get_sim(sid: int, db: Session = Depends(get_db)) -> dict:
    s = db.get(Simulation, sid)
    if s is None:
        raise HTTPException(404, "Simulation introuvable.")
    return _sim_out(s)


@router.post("/simulations/{sid}/cancel", tags=["Simulations"])
def cancel_sim(sid: int, db: Session = Depends(get_db)) -> dict:
    s = db.get(Simulation, sid)
    if s is None:
        raise HTTPException(404, "Simulation introuvable.")
    job_id = (s.params or {}).get("job_id")
    if job_id:
        get_job_manager().cancel(job_id)
    return _sim_out(s, False)


@router.delete("/simulations/{sid}", tags=["Simulations"], status_code=204)
def delete_sim(sid: int, db: Session = Depends(get_db)) -> None:
    s = db.get(Simulation, sid)
    if s is None:
        raise HTTPException(404, "Simulation introuvable.")
    db.delete(s)
    db.commit()


@router.get("/simulations/{sid}/export", tags=["Simulations"])
def export_sim(sid: int, format: Literal["csv", "xlsx", "json", "pdf"] = "csv", db: Session = Depends(get_db)):
    s = db.get(Simulation, sid)
    if s is None or not s.results:
        raise HTTPException(404, "Simulation introuvable ou non terminée.")
    rows = []
    for p in s.results["portfolios"]:
        for t in p["tiers"]:
            rows.append({"portefeuille": p["name"], "grilles": p["n_grids"], "rang": t["rank"], "combinaison": t["label"],
                         "gains_observes": t["wins"], "gains_attendus": round(t["expected_wins"], 3),
                         "frequence_empirique": t["empirical_frequency"], "probabilite_theorique": t["theoretical_probability"],
                         "dans_ic99": t["within_ci99"]})
    cols = list(rows[0].keys()) if rows else []
    params = {"tirages simulés": s.n_draws, "graine": s.seed, "prix": (s.params or {}).get("ticket_price")}
    content = export_rows(format, "Simulation Monte-Carlo", cols, rows, payload=s.results, params=params,
                          paragraphs=s.results.get("notes", []))
    return file_response(content, format, f"simulation_{sid}")


# ---------------------------------------------------------------------------
# Vérification des résultats
# ---------------------------------------------------------------------------


@router.post("/results/check", tags=["Résultats"])
def check(body: ResultCheckIn, db: Session = Depends(get_db)) -> dict:
    draw = None
    if body.draw_id is not None:
        draw = db.get(Draw, body.draw_id)
        if draw is None:
            raise HTTPException(404, "Tirage introuvable.")
    elif body.draw_date is not None and body.numbers is None:
        draw = db.scalar(select(Draw).where(Draw.draw_date == body.draw_date))
        if draw is None:
            raise HTTPException(404, "Aucun tirage enregistré à cette date : importez-le ou saisissez ses numéros.")
    if draw is not None:
        numbers, stars, era = draw.numbers, draw.stars, get_era(draw.era_code)
        prizes = {p.rank: p.prize_eur for p in draw.prizes if p.prize_eur is not None}
        d_date = draw.draw_date
    else:
        if body.numbers is None or body.stars is None:
            raise HTTPException(400, "Indiquez un tirage enregistré ou les numéros et étoiles du tirage.")
        numbers, stars = body.numbers, body.stars
        d_date = body.draw_date
        era = era_for_date(d_date) if d_date else CURRENT_ERA
        prizes = {}
    grid_ids: list[int | None] = []
    if body.portfolio_id is not None:
        p = get_portfolio_or_404(db, body.portfolio_id)
        grids = portfolio_pairs(p)
        grid_ids = [g.id for g in p.grids]
    elif body.grids:
        grids = [g.pair() for g in body.grids]
        grid_ids = [None] * len(grids)
    else:
        raise HTTPException(400, "Indiquez un portefeuille ou des grilles à vérifier.")
    res = check_grids(grids, numbers, stars, era, prizes)
    res["draw"]["date"] = d_date.isoformat() if d_date else None
    res["draw"]["draw_id"] = draw.id if draw else None
    if body.save:
        rc = ResultCheck(draw_id=draw.id if draw else None, draw_date=d_date, numbers=sorted(numbers), stars=sorted(stars),
                         portfolio_id=body.portfolio_id, summary=res["summary"])
        for line, gid in zip(res["lines"], grid_ids):
            rc.lines.append(GridResult(grid_id=gid, numbers=line["numbers"], stars=line["stars"],
                                       matched_numbers=line["n_matched_numbers"], matched_stars=line["n_matched_stars"],
                                       rank=line["rank"], prize_eur=line["prize"]))
        db.add(rc)
        db.commit()
        res["check_id"] = rc.id
    return res


@router.get("/results/history", tags=["Résultats"])
def check_history(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(ResultCheck).order_by(ResultCheck.checked_at.desc()).limit(200)).all()
    out = []
    for r in rows:
        pname = None
        if r.portfolio_id:
            p = db.get(Portfolio, r.portfolio_id)
            pname = p.name if p else None
        out.append({"id": r.id, "draw_date": r.draw_date.isoformat() if r.draw_date else None, "numbers": r.numbers,
                    "stars": r.stars, "portfolio_id": r.portfolio_id, "portfolio_name": pname, "summary": r.summary,
                    "checked_at": r.checked_at.isoformat()})
    return out


@router.get("/results/history/{cid}", tags=["Résultats"])
def check_detail(cid: int, db: Session = Depends(get_db)) -> dict:
    r = db.get(ResultCheck, cid)
    if r is None:
        raise HTTPException(404, "Vérification introuvable.")
    return {"id": r.id, "draw_date": r.draw_date.isoformat() if r.draw_date else None, "numbers": r.numbers,
            "stars": r.stars, "summary": r.summary, "checked_at": r.checked_at.isoformat(),
            "lines": [{"numbers": l.numbers, "stars": l.stars, "n_matched_numbers": l.matched_numbers,
                       "n_matched_stars": l.matched_stars, "rank": l.rank, "prize": l.prize_eur} for l in r.lines]}


@router.delete("/results/history/{cid}", tags=["Résultats"], status_code=204)
def delete_check(cid: int, db: Session = Depends(get_db)) -> None:
    r = db.get(ResultCheck, cid)
    if r is None:
        raise HTTPException(404, "Vérification introuvable.")
    db.delete(r)
    db.commit()


# ---------------------------------------------------------------------------
# Budget et jackpot
# ---------------------------------------------------------------------------


@router.get("/budget/probabilities", tags=["Budget"])
def budget(
    n_grids: int | None = Query(None, ge=0, le=1_000_000),
    budget_per_draw: float | None = Query(None, ge=0, le=1e7),
    budget_weekly: float | None = Query(None, ge=0, le=1e7),
    budget_monthly: float | None = Query(None, ge=0, le=1e8),
    ticket_price_: float | None = Query(None, alias="ticket_price", gt=0, le=100),
    draws_per_week: int | None = Query(None, ge=1, le=2),
    duration_weeks: int = Query(52, ge=1, le=4160),
    assumed_return_rate: float | None = Query(None, ge=0, le=1),
    portfolio_id: int | None = None,
    db: Session = Depends(get_db),
) -> dict:
    exact_p = None
    note = None
    if portfolio_id is not None:
        p = get_portfolio_or_404(db, portfolio_id)
        n_grids = len(p.grids)
        exact = (p.metrics or {}).get("exact")
        if exact:
            exact_p = exact["p_any_win"]
        else:
            note = "Analyse exacte non encore calculée pour ce portefeuille : lancez-la depuis « Mes grilles »."
    b = BudgetInput(
        ticket_price=ticket_price(db, ticket_price_),
        draws_per_week=draws_per_week or int(settings_store.get_setting(db, "draws_per_week")),
        n_grids=n_grids, budget_per_draw=budget_per_draw, budget_weekly=budget_weekly, budget_monthly=budget_monthly,
        duration_weeks=duration_weeks, assumed_return_rate=assumed_return_rate, exact_p_any_win=exact_p,
    )
    out = budget_analysis(b)
    out["price_source"] = settings_store.get_setting(db, "ticket_price_source")
    if note:
        out["portfolio_note"] = note
    return out


def historical_payouts(db: Session, last_n: int = 200) -> dict[str, Any]:
    """Gains moyens par rang observés dans l'historique importé (époque actuelle), s'ils existent."""
    q = (select(DrawPrize.rank, func.avg(DrawPrize.prize_eur), func.count(DrawPrize.id), func.min(Draw.draw_date),
                func.max(Draw.draw_date))
         .join(Draw, Draw.id == DrawPrize.draw_id)
         .where(Draw.era_code == CURRENT_ERA.code, DrawPrize.prize_eur.is_not(None), DrawPrize.prize_eur > 0,
                DrawPrize.rank >= 2)
         .group_by(DrawPrize.rank))
    rows = db.execute(q).all()
    return {
        "available": bool(rows),
        "payouts": {int(r[0]): float(r[1]) for r in rows},
        "details": [{"rank": int(r[0]), "mean_prize": float(r[1]), "observations": int(r[2]),
                     "from": r[3].isoformat() if r[3] else None, "to": r[4].isoformat() if r[4] else None} for r in rows],
        "note": "Moyennes des rapports publiés dans les données importées (rangs avec au moins un gagnant). "
                "Aucun montant n'est inventé : sans données importées, la liste est vide.",
    }


@router.get("/jackpot/historical-payouts", tags=["Jackpot"])
def get_historical_payouts(db: Session = Depends(get_db)) -> dict:
    return historical_payouts(db)


@router.post("/jackpot/analysis", tags=["Jackpot"])
def jackpot(body: JackpotIn, db: Session = Depends(get_db)) -> dict:
    payouts = {int(k): float(v) for k, v in body.secondary_payouts.items() if 2 <= int(k) <= 13 and v is not None}
    source = "saisie utilisateur"
    if body.use_historical_payouts:
        hp = historical_payouts(db)
        if not hp["available"]:
            raise HTTPException(400, "Aucun barème historique importé : saisissez des gains supposés.")
        payouts = {**hp["payouts"], **payouts}
        source = "moyennes de l'historique importé"
    return jackpot_analysis(JackpotInput(
        jackpot=body.jackpot, n_grids=body.n_grids, ticket_price=ticket_price(db, body.ticket_price),
        other_tickets=body.other_tickets, expected_other_winners=body.expected_other_winners,
        popularity_multiplier=body.popularity_multiplier, secondary_payouts=payouts, payouts_source=source,
    ))


# ---------------------------------------------------------------------------
# Laboratoire IA
# ---------------------------------------------------------------------------


def _exp_out(e: Experiment, full: bool = True) -> dict[str, Any]:
    out = {"id": e.id, "kind": e.kind, "hypothesis_code": e.hypothesis_code, "mode": e.mode, "title": e.title,
           "params": e.params, "seed": e.seed, "period_start": e.period_start.isoformat() if e.period_start else None,
           "period_end": e.period_end.isoformat() if e.period_end else None, "created_at": e.created_at.isoformat()}
    if full:
        out["results"] = e.results
    else:
        r = e.results or {}
        out["summary"] = {k: r.get(k) for k in ("p_value", "reject_h0", "observed", "null_mean",
                                                 "any_model_beats_random", "conclusion")}
    return out


@router.get("/ml/models", tags=["Laboratoire IA"])
def ml_models() -> dict:
    return {"models": MODELS}


@router.post("/ml/run", tags=["Laboratoire IA"], dependencies=[Depends(expensive)])
def ml_run(body: MLRunIn, db: Session = Depends(get_db)) -> dict:
    ds = load_drawset(db, body.date_from, body.date_to)
    if ds.size < 200:
        raise HTTPException(400, "Au moins 200 tirages sont nécessaires pour une expérience de machine learning.")
    from app.core.rng import new_seed

    seed = body.seed if body.seed is not None else new_seed()
    params = body.model_dump(mode="json")

    def on_done(job) -> None:
        if job.status != "done":
            return
        with new_session() as s:
            e = Experiment(kind="ml", hypothesis_code="ml_prediction", mode="exploratory",
                           title="Prédiction des numéros par apprentissage automatique", params=params, seed=seed,
                           period_start=ds.dates[0], period_end=ds.dates[-1], results=job.result)
            s.add(e)
            s.commit()
            job.meta["experiment_id"] = e.id

    job = submit_job("ml", lambda progress, cancel: run_ml_experiment(
        ds, models=list(body.models), train_ratio=body.train_ratio, seed=seed, n_bootstrap=body.n_bootstrap,
        progress=progress, cancel=cancel), on_done, {"draws": ds.size})
    return job_response(job)


@router.get("/ml/experiments", tags=["Laboratoire IA"])
def ml_experiments(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Experiment).where(Experiment.kind == "ml").order_by(Experiment.created_at.desc())).all()
    return [_exp_out(e, False) for e in rows]


# ---------------------------------------------------------------------------
# Mode recherche
# ---------------------------------------------------------------------------


@router.get("/research/hypotheses", tags=["Recherche"])
def hypotheses() -> dict:
    return {"hypotheses": HYPOTHESES}


def _check_confirmatory(db: Session, code: str, start: date, end: date) -> None:
    rows = db.scalars(select(Experiment).where(Experiment.kind == "research", Experiment.hypothesis_code == code)).all()
    for e in rows:
        if e.period_start and e.period_end and not (end < e.period_start or start > e.period_end):
            if e.mode == "exploratory":
                raise HTTPException(409, (
                    f"Test confirmatoire refusé : la période chevauche l'exploration n°{e.id} "
                    f"({e.period_start.isoformat()} → {e.period_end.isoformat()}) de la même hypothèse. "
                    "Choisissez des tirages postérieurs à toute exploration."))
            raise HTTPException(409, f"Cette hypothèse a déjà été testée en confirmatoire sur cette période (n°{e.id}).")


@router.post("/research/experiments", tags=["Recherche"], dependencies=[Depends(expensive)])
def research_run(body: ResearchIn, db: Session = Depends(get_db)) -> dict:
    if body.hypothesis not in HYPOTHESES:
        raise HTTPException(400, "Hypothèse inconnue.")
    ds = load_drawset(db, body.date_from, body.date_to, body.last_n)
    if ds.size < 60:
        raise HTTPException(400, "Au moins 60 tirages sont nécessaires sur la période choisie.")
    start, end = ds.dates[0], ds.dates[-1]
    if body.mode == "confirmatory":
        _check_confirmatory(db, body.hypothesis, start, end)
    from app.core.rng import new_seed

    seed = body.seed if body.seed is not None else new_seed()
    cfg = ResearchConfig(body.hypothesis, body.n_sim, seed, body.alpha, body.params)
    params = {**body.model_dump(mode="json"), "seed": seed}
    title = body.title or HYPOTHESES[body.hypothesis]["title"]

    def on_done(job) -> None:
        if job.status != "done":
            return
        with new_session() as s:
            e = Experiment(kind="research", hypothesis_code=body.hypothesis, mode=body.mode, title=title, params=params,
                           seed=seed, period_start=start, period_end=end, results=job.result)
            s.add(e)
            s.commit()
            job.meta["experiment_id"] = e.id

    job = submit_job("research", lambda progress, cancel: run_research(ds, cfg), on_done,
                     {"hypothesis": body.hypothesis, "mode": body.mode})
    return job_response(job)


@router.get("/research/experiments", tags=["Recherche"])
def research_list(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Experiment).where(Experiment.kind == "research").order_by(Experiment.created_at.desc())).all()
    return [_exp_out(e, False) for e in rows]


@router.get("/research/experiments/{eid}", tags=["Recherche"])
def research_get(eid: int, db: Session = Depends(get_db)) -> dict:
    e = db.get(Experiment, eid)
    if e is None:
        raise HTTPException(404, "Expérience introuvable.")
    return _exp_out(e)


@router.post("/research/experiments/{eid}/reproduce", tags=["Recherche"], dependencies=[Depends(expensive)])
def research_reproduce(eid: int, db: Session = Depends(get_db)) -> dict:
    """Relance une expérience avec ses paramètres et sa graine enregistrés, et compare les résultats."""
    e = db.get(Experiment, eid)
    if e is None or e.kind != "research":
        raise HTTPException(404, "Expérience introuvable.")
    p = e.params
    ds = load_drawset(db, date.fromisoformat(p["date_from"]) if p.get("date_from") else None,
                      date.fromisoformat(p["date_to"]) if p.get("date_to") else None, p.get("last_n"))
    cfg = ResearchConfig(e.hypothesis_code, p["n_sim"], e.seed, p["alpha"], p.get("params"))
    original = e.results

    def run(progress, cancel) -> dict[str, Any]:
        new = run_research(ds, cfg)
        keys = ("observed", "null_mean", "p_value", "units", "period")
        identical = all(new.get(k) == original.get(k) for k in keys)
        return {"identical": identical, "original": {k: original.get(k) for k in keys},
                "reproduced": {k: new.get(k) for k in keys},
                "note": "Résultat identique attendu si l'historique de la période n'a pas changé."}

    return job_response(submit_job("research_reproduce", run, meta={"experiment_id": eid}))


@router.delete("/research/experiments/{eid}", tags=["Recherche"], status_code=204)
def research_delete(eid: int, db: Session = Depends(get_db)) -> None:
    e = db.get(Experiment, eid)
    if e is None:
        raise HTTPException(404, "Expérience introuvable.")
    db.delete(e)
    db.commit()


@router.get("/research/experiments/{eid}/export", tags=["Recherche"])
def research_export(eid: int, format: Literal["json", "pdf"] = "pdf", db: Session = Depends(get_db)):
    e = db.get(Experiment, eid)
    if e is None:
        raise HTTPException(404, "Expérience introuvable.")
    data = _exp_out(e)
    if format == "json":
        return file_response(to_json(data), "json", f"experience_{eid}")
    r = e.results or {}
    rows = [{"Indicateur": k, "Valeur": r.get(k)} for k in ("observed", "null_mean", "null_sd", "null_interval_95",
                                                              "observed_ci95", "p_value", "reject_h0", "units", "period")]
    pdf = to_pdf(f"Expérience n°{eid} — {e.title}", [
        {"title": "Résultats", "paragraphs": [f"Mode : {'confirmatoire' if e.mode == 'confirmatory' else 'exploratoire'}",
                                              r.get("interpretation", ""), r.get("null_model", "")],
         "table": (["Indicateur", "Valeur"], rows)}], {**e.params, "graine": e.seed})
    return file_response(pdf, "pdf", f"experience_{eid}")


# ---------------------------------------------------------------------------
# Audit mathématique
# ---------------------------------------------------------------------------


@router.post("/audit/run", tags=["Audit"], dependencies=[Depends(expensive)])
def audit_run() -> dict:
    def on_done(job) -> None:
        if job.status != "done":
            return
        with new_session() as s:
            rep = Report(kind="audit", title="Audit mathématique", params={}, payload=job.result)
            s.add(rep)
            s.commit()
            job.meta["report_id"] = rep.id

    return job_response(submit_job("audit", lambda progress, cancel: run_audit(progress, cancel), on_done))


@router.get("/audit/reports", tags=["Audit"])
def audit_reports(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Report).where(Report.kind == "audit").order_by(Report.created_at.desc()).limit(50)).all()
    return [{"id": r.id, "created_at": r.created_at.isoformat(), "passed": r.payload.get("passed"),
             "total": r.payload.get("total"), "compliant": r.payload.get("compliant")} for r in rows]


@router.get("/audit/reports/{rid}", tags=["Audit"])
def audit_report(rid: int, db: Session = Depends(get_db)) -> dict:
    r = db.get(Report, rid)
    if r is None or r.kind != "audit":
        raise HTTPException(404, "Rapport introuvable.")
    return {"id": r.id, "created_at": r.created_at.isoformat(), **r.payload}


@router.get("/audit/reports/{rid}/export", tags=["Audit"])
def audit_export(rid: int, format: Literal["json", "pdf"] = "pdf", db: Session = Depends(get_db)):
    r = db.get(Report, rid)
    if r is None or r.kind != "audit":
        raise HTTPException(404, "Rapport introuvable.")
    if format == "json":
        return file_response(to_json(r.payload), "json", f"audit_{rid}")
    rows = [{"Vérification": c["name"], "Résultat": "CONFORME" if c["passed"] else "NON CONFORME",
             "Durée (s)": c["duration_s"]} for c in r.payload["checks"]]
    details = [f"{c['name']} : {c['details']}"[:1500] for c in r.payload["checks"]]
    pdf = to_pdf("Rapport de conformité mathématique", [
        {"title": "Synthèse", "paragraphs": [r.payload["summary"]], "table": (["Vérification", "Résultat", "Durée (s)"], rows)},
        {"title": "Détails", "paragraphs": details}], {"date": r.created_at.isoformat()})
    return file_response(pdf, "pdf", f"audit_{rid}")


__all__ = ["router", "np"]
