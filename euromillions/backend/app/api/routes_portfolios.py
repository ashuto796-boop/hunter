"""Routes : générateur, grilles, portefeuilles, optimiseur, laboratoire de stratégies."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import (
    file_response,
    get_portfolio_or_404,
    grid_out,
    history_counts,
    job_response,
    new_session,
    past_draw_set,
    portfolio_pairs,
    portfolio_summary,
    submit_job,
)
from app.api.routes_core import ticket_price
from app.config import get_settings
from app.core.grid import Grid, grid_index
from app.db import get_db
from app.models import Portfolio, SavedGrid, Strategy
from app.schemas import (
    AutoTuneIn,
    CandidatesIn,
    CompareMethodsIn,
    ExportGridsIn,
    GenerateIn,
    GridIn,
    GridsIn,
    LabCompareIn,
    LabEvaluateIn,
    OptimizeIn,
    PortfolioCompareIn,
    PortfolioCreate,
    PortfolioUpdate,
    SaveGridIn,
    StrategyCreate,
)
from app.security import expensive
from app.services import popularity
from app.services.export import export_portfolio
from app.services.generator import STRATEGIES, GenerationRequest, generate
from app.services.optimizer import METHODS, OptimizerConfig, compare_methods, optimize
from app.services.portfolio import GridConstraints, Weights, portfolio_metrics
from app.services.portfolio_exact import exact_portfolio_analysis
from app.services.simulation import PortfolioInput, SimulationConfig, run_simulation
from app.services.strategy_lab import TUNABLE_METRICS, auto_tune, compare_configs, evaluate_config

router = APIRouter(tags=["Grilles et portefeuilles"])

INDIVIDUAL_NAME = "Mes grilles individuelles"


# ---------------------------------------------------------------------------
# Générateur
# ---------------------------------------------------------------------------


@router.get("/grids/strategies")
def strategies() -> dict:
    return {"strategies": STRATEGIES, "methods": METHODS}


def _generation_request(body: GenerateIn) -> GenerationRequest:
    return GenerationRequest(
        count=body.count, strategy=body.strategy, seed=body.seed,
        constraints=GridConstraints.from_dict(body.constraints.model_dump()),
        weights=Weights.from_dict(body.weights.model_dump()) if body.weights else None,
        method=body.method, time_limit_s=min(body.time_limit_s, get_settings().max_optimizer_seconds),
        max_common=body.max_common, popularity_threshold=body.popularity_threshold,
        historical_mode=body.historical_mode, historical_window=body.historical_window,
        historical_strength=body.historical_strength,
    )


@router.post("/grids/generate", dependencies=[Depends(expensive)])
def generate_grids(body: GenerateIn, db: Session = Depends(get_db)) -> dict:
    """Génère des grilles. Exécution immédiate pour A/D/E (≤ 2 000 grilles), en tâche de fond sinon."""
    if body.count > get_settings().max_grids_per_request:
        raise HTTPException(400, f"Au plus {get_settings().max_grids_per_request} grilles par requête.")
    req = _generation_request(body)
    past = past_draw_set(db)
    history = history_counts(db, body.historical_window) if body.strategy == "E" else None
    if body.strategy in ("A", "D", "E") and body.count <= 2000:
        return {"result": generate(req, history=history, past_draws=past)}
    job = submit_job("generate", lambda progress, cancel: generate(req, history=history, past_draws=past,
                                                                   progress=progress, cancel=cancel),
                     meta={"strategy": body.strategy, "count": body.count})
    return job_response(job)


@router.post("/grids/validate")
def validate(body: GridIn, db: Session = Depends(get_db)) -> dict:
    g = Grid.create(body.numbers, body.stars)
    return {"valid": True, "numbers": list(g.numbers), "stars": list(g.stars), "combo_index": g.index(),
            "pattern": popularity.explain(g.numbers, g.stars, past_draw_set(db))}


@router.post("/grids/metrics")
def metrics(body: GridsIn, db: Session = Depends(get_db)) -> dict:
    w = Weights.from_dict(body.weights.model_dump()) if body.weights else None
    return portfolio_metrics([g.pair() for g in body.grids], w, body.max_common,
                             ticket_price=ticket_price(db, body.ticket_price))


@router.post("/grids/export")
def export_grids(body: ExportGridsIn, db: Session = Depends(get_db)):
    pairs = [(tuple(sorted(g["numbers"])), tuple(sorted(g["stars"]))) for g in body.grids]
    m = portfolio_metrics(pairs, include_matrix=False, ticket_price=ticket_price(db, None))
    return file_response(export_portfolio(body.format, body.name, body.grids, m, body.params), body.format, body.name)


@router.post("/grids/save", status_code=201)
def save_grid(body: SaveGridIn, db: Session = Depends(get_db)) -> dict:
    p = db.scalar(select(Portfolio).where(Portfolio.is_individual.is_(True)))
    if p is None:
        p = Portfolio(name=INDIVIDUAL_NAME, strategy_code="mixte", is_individual=True,
                      ticket_price=ticket_price(db, None))
        db.add(p)
        db.flush()
    idx = grid_index(body.numbers, body.stars)
    if db.scalar(select(SavedGrid.id).where(SavedGrid.portfolio_id == p.id, SavedGrid.combo_index == idx)):
        raise HTTPException(409, "Cette grille est déjà enregistrée.")
    g = _saved_grid(p.id, body, body.strategy_code, body.diversity_score)
    db.add(g)
    db.commit()
    return {"portfolio_id": p.id, "grid": grid_out(g)}


def _saved_grid(pid: int, g: GridIn, strategy: str, diversity: float | None = None) -> SavedGrid:
    n, s = sorted(g.numbers), sorted(g.stars)
    return SavedGrid(portfolio_id=pid, combo_index=grid_index(n, s), n1=n[0], n2=n[1], n3=n[2], n4=n[3], n5=n[4],
                     s1=s[0], s2=s[1], strategy_code=strategy, diversity_score=diversity, label=g.label)


# ---------------------------------------------------------------------------
# Portefeuilles
# ---------------------------------------------------------------------------


@router.get("/portfolios")
def list_portfolios(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Portfolio).order_by(Portfolio.created_at.desc())).all()
    return [portfolio_summary(p) for p in rows]


@router.post("/portfolios", status_code=201)
def create_portfolio(body: PortfolioCreate, db: Session = Depends(get_db)) -> dict:
    keys = {grid_index(g.numbers, g.stars) for g in body.grids}
    if len(keys) != len(body.grids):
        raise HTTPException(400, "Le portefeuille contient des grilles en double.")
    price = ticket_price(db, body.ticket_price)
    m = portfolio_metrics([g.pair() for g in body.grids], include_matrix=False, ticket_price=price)
    p = Portfolio(name=body.name, strategy_code=body.strategy_code, params=body.params, seed=body.seed,
                  metrics={k: v for k, v in m.items() if k not in ("similarity_matrix",)},
                  objective=m.get("objective"), ticket_price=price, notes=body.notes)
    db.add(p)
    db.flush()
    for g in body.grids:
        db.add(_saved_grid(p.id, g, body.strategy_code))
    db.commit()
    db.refresh(p)
    return portfolio_summary(p)


@router.get("/portfolios/{pid}")
def get_portfolio(pid: int, db: Session = Depends(get_db)) -> dict:
    p = get_portfolio_or_404(db, pid)
    m = portfolio_metrics(portfolio_pairs(p), ticket_price=p.ticket_price) if p.grids else None
    return {**portfolio_summary(p), "grids": [grid_out(g) for g in p.grids], "metrics": m,
            "exact": (p.metrics or {}).get("exact")}


@router.patch("/portfolios/{pid}")
def update_portfolio(pid: int, body: PortfolioUpdate, db: Session = Depends(get_db)) -> dict:
    p = get_portfolio_or_404(db, pid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    return portfolio_summary(p)


@router.delete("/portfolios/{pid}", status_code=204)
def delete_portfolio(pid: int, db: Session = Depends(get_db)) -> None:
    db.delete(get_portfolio_or_404(db, pid))
    db.commit()


@router.post("/portfolios/{pid}/grids", status_code=201)
def add_grid(pid: int, body: GridIn, db: Session = Depends(get_db)) -> dict:
    p = get_portfolio_or_404(db, pid)
    g = _saved_grid(p.id, body, p.strategy_code)
    db.add(g)
    try:
        p.metrics = {k: v for k, v in (p.metrics or {}).items() if k != "exact"}
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Cette grille figure déjà dans le portefeuille.") from exc
    return grid_out(g)


@router.delete("/portfolios/{pid}/grids/{grid_id}", status_code=204)
def delete_grid(pid: int, grid_id: int, db: Session = Depends(get_db)) -> None:
    g = db.get(SavedGrid, grid_id)
    if g is None or g.portfolio_id != pid:
        raise HTTPException(404, "Grille introuvable dans ce portefeuille.")
    p = g.portfolio
    db.delete(g)
    p.metrics = {k: v for k, v in (p.metrics or {}).items() if k != "exact"}
    db.commit()


@router.get("/portfolios/{pid}/export")
def export_saved(pid: int, format: Literal["csv", "xlsx", "json", "pdf"] = "csv", db: Session = Depends(get_db)):
    p = get_portfolio_or_404(db, pid)
    grids = [grid_out(g) for g in p.grids]
    m = portfolio_metrics(portfolio_pairs(p), include_matrix=False, ticket_price=p.ticket_price) if grids else {}
    params = {"stratégie": p.strategy_code, "graine": p.seed, "prix_grille": p.ticket_price, **(p.params or {})}
    return file_response(export_portfolio(format, p.name, grids, m, params), format, f"portefeuille_{p.id}")


# ---------------------------------------------------------------------------
# Optimiseur
# ---------------------------------------------------------------------------


def _opt_config(body: OptimizeIn, db: Session, method: str | None = None) -> OptimizerConfig:
    n = body.n_grids
    if body.budget is not None:
        price = ticket_price(db, body.ticket_price)
        n = min(n, int(body.budget // price))
        if n < 1:
            raise HTTPException(400, "Budget insuffisant pour une seule grille.")
    return OptimizerConfig(
        n_grids=n, method=method or body.method, weights=Weights.from_dict(body.weights.model_dump()),
        constraints=GridConstraints.from_dict(body.constraints.model_dump()), max_common=body.max_common,
        time_limit_s=min(body.time_limit_s, get_settings().max_optimizer_seconds),
        max_iterations=body.max_iterations, seed=body.seed, params=dict(body.params),
    )


@router.post("/portfolios/optimize", dependencies=[Depends(expensive)])
def optimize_portfolio(body: OptimizeIn, db: Session = Depends(get_db)) -> dict:
    cfg = _opt_config(body, db)
    past = past_draw_set(db)
    job = submit_job("optimize", lambda progress, cancel: optimize(cfg, progress, cancel, past).as_dict(),
                     meta={"method": cfg.method, "n_grids": cfg.n_grids})
    return job_response(job)


@router.post("/portfolios/compare-methods", dependencies=[Depends(expensive)])
def compare_opt_methods(body: CompareMethodsIn, db: Session = Depends(get_db)) -> dict:
    cfg = _opt_config(body, db)
    past = past_draw_set(db)
    methods = list(dict.fromkeys(body.methods))
    job = submit_job("compare_methods", lambda progress, cancel: compare_methods(cfg, methods, progress, cancel, past),
                     meta={"methods": methods, "n_grids": cfg.n_grids})
    return job_response(job)


@router.post("/portfolios/candidates", dependencies=[Depends(expensive)])
def candidates(body: CandidatesIn, db: Session = Depends(get_db)) -> dict:
    """Génère plusieurs portefeuilles candidats (stratégies/pondérations différentes) pour comparaison."""
    base = _opt_config(body, db)
    past = past_draw_set(db)
    price = ticket_price(db, body.ticket_price)
    specs = body.candidates or [
        {"name": "Aléatoire uniforme (référence)", "strategy": "A"},
        {"name": "Diversification", "strategy": "B"},
        {"name": "Couverture", "strategy": "C"},
        {"name": "Multi-objectifs (vos pondérations)", "strategy": "F"},
    ]

    def run(progress, cancel) -> dict[str, Any]:
        import time as _t

        out = []
        for i, spec in enumerate(specs[:8]):
            t0 = _t.perf_counter()
            req = GenerationRequest(
                count=base.n_grids, strategy=spec.get("strategy", "F"), seed=base.seed, constraints=base.constraints,
                weights=Weights.from_dict(spec.get("weights")) if spec.get("weights") else base.weights,
                method=spec.get("method", base.method), time_limit_s=base.time_limit_s, max_common=base.max_common,
            )
            res = generate(req, past_draws=past, cancel=cancel,
                           progress=lambda f, m, i=i: progress((i + f) / len(specs), m))
            m = res["metrics"]
            out.append({
                "name": spec.get("name") or f"Candidat {i + 1}",
                "strategy": req.strategy,
                "grids": [{"numbers": g["numbers"], "stars": g["stars"]} for g in res["grids"]],
                "diversity": m["diversity"], "pair_coverage": m["pair_coverage"],
                "triple_coverage": m["triple_coverage"], "star_score": m["star_score"],
                "star_usage": m["star_usage"], "popularity": m["popularity"], "duplicates": m["duplicates"],
                "max_common_numbers_observed": m["max_common_numbers_observed"],
                "objective_common": portfolio_metrics([(tuple(g["numbers"]), tuple(g["stars"])) for g in res["grids"]],
                                                      base.weights, base.max_common, include_matrix=False)["objective"],
                "cost": round(len(res["grids"]) * price, 2),
                "p_jackpot": m["probabilities"]["jackpot"],
                "generation_time_s": round(_t.perf_counter() - t0, 3),
                "seed": res["seed"],
            })
        return {"candidates": out, "weights": base.weights.as_dict(),
                "note": "« objective_common » évalue tous les candidats avec VOS pondérations ; ce n'est pas une probabilité de gain."}

    job = submit_job("candidates", run, meta={"n_grids": base.n_grids})
    return job_response(job)


@router.post("/portfolios/compare", dependencies=[Depends(expensive)])
def compare_portfolios(body: PortfolioCompareIn, db: Session = Depends(get_db)) -> dict:
    pa, pb = get_portfolio_or_404(db, body.portfolio_a), get_portfolio_or_404(db, body.portfolio_b)
    ga, gb = portfolio_pairs(pa), portfolio_pairs(pb)
    if not ga or not gb:
        raise HTTPException(400, "Les deux portefeuilles doivent contenir au moins une grille.")
    price = ticket_price(db, body.ticket_price)
    limit = get_settings().exact_portfolio_max_grids
    names = (pa.name, pb.name)

    def run(progress, cancel) -> dict[str, Any]:
        ma = portfolio_metrics(ga, ticket_price=price, include_matrix=False)
        mb = portfolio_metrics(gb, ticket_price=price, include_matrix=False)
        exact = {}
        if body.exact and len(ga) <= limit and len(gb) <= limit:
            exact["a"] = exact_portfolio_analysis(ga, lambda f, m: progress(f * 0.3, m), cancel)
            exact["b"] = exact_portfolio_analysis(gb, lambda f, m: progress(0.3 + f * 0.3, m), cancel)
        sim = run_simulation(SimulationConfig([PortfolioInput(names[0], ga), PortfolioInput(names[1], gb)],
                                              body.n_draws, body.seed, price),
                             lambda f, m: progress(0.6 + 0.4 * f, m), cancel)
        sa, sb = sim["portfolios"]
        p_any_a = exact["a"]["p_any_win"]["value"] if exact else sa["p_any_win_empirical"]
        p_any_b = exact["b"]["p_any_win"]["value"] if exact else sb["p_any_win_empirical"]
        criteria = [
            ("Nombre de grilles", ma["n_grids"], mb["n_grids"], "info"),
            ("Budget par tirage (€)", ma.get("cost"), mb.get("cost"), "lower"),
            ("Probabilité de jackpot", ma["probabilities"]["jackpot"]["value"], mb["probabilities"]["jackpot"]["value"], "higher"),
            ("Couverture des paires", ma["pair_coverage"], mb["pair_coverage"], "higher"),
            ("Couverture des triplets", ma["triple_coverage"], mb["triple_coverage"], "higher"),
            ("Répartition des étoiles", ma["star_score"], mb["star_score"], "higher"),
            ("Similarité moyenne", 1 - ma["diversity"], 1 - mb["diversity"], "lower"),
            ("P(au moins un gain) par tirage", p_any_a, p_any_b, "higher"),
            ("Indice de motif moyen", ma["popularity"], mb["popularity"], "lower"),
        ]
        rows = []
        for label, va, vb, better in criteria:
            if better == "info" or va is None or vb is None or va == vb:
                dom = "égalité" if va == vb else "—"
            elif better == "higher":
                dom = "A" if va > vb else "B"
            else:
                dom = "A" if va < vb else "B"
            rows.append({"criterion": label, "a": va, "b": vb, "better_if": better, "dominant": dom})
        return {
            "a": {"id": pa.id, "name": names[0], "metrics": ma, "exact": exact.get("a"), "simulation": sa},
            "b": {"id": pb.id, "name": names[1], "metrics": mb, "exact": exact.get("b"), "simulation": sb},
            "criteria": rows,
            "seed": sim["seed"],
            "n_draws": body.n_draws,
            "note": (
                "Le portefeuille dominant est indiqué critère par critère. Aucun « meilleur portefeuille » global n'est "
                "désigné : cela dépend de l'objectif choisi. Plus de grilles = plus de chances ET plus de dépense."
            ),
        }

    job = submit_job("compare_portfolios", run, meta={"a": pa.id, "b": pb.id})
    return job_response(job)


# ---------------------------------------------------------------------------
# Laboratoire de stratégies
# ---------------------------------------------------------------------------


@router.get("/strategies")
def list_strategies(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Strategy).order_by(Strategy.created_at.desc())).all()
    return [{"id": s.id, "name": s.name, "code": s.code, "description": s.description, "params": s.params,
             "created_at": s.created_at.isoformat()} for s in rows]


@router.post("/strategies", status_code=201)
def create_strategy(body: StrategyCreate, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(Strategy.id).where(Strategy.name == body.name)):
        raise HTTPException(409, "Une stratégie porte déjà ce nom.")
    Weights.from_dict((body.params or {}).get("weights"))
    GridConstraints.from_dict((body.params or {}).get("constraints"))
    s = Strategy(name=body.name, code=body.code, description=body.description, params=body.params)
    db.add(s)
    db.commit()
    return {"id": s.id, "name": s.name, "code": s.code, "description": s.description, "params": s.params,
            "created_at": s.created_at.isoformat()}


@router.delete("/strategies/{sid}", status_code=204)
def delete_strategy(sid: int, db: Session = Depends(get_db)) -> None:
    s = db.get(Strategy, sid)
    if s is None:
        raise HTTPException(404, "Stratégie introuvable.")
    db.delete(s)
    db.commit()


@router.post("/strategy-lab/evaluate", dependencies=[Depends(expensive)])
def lab_evaluate(body: LabEvaluateIn) -> dict:
    return evaluate_config(body.n_grids, Weights.from_dict(body.weights.model_dump()),
                           GridConstraints.from_dict(body.constraints.model_dump()), body.max_common, body.method,
                           body.time_limit_s, body.seed)


@router.post("/strategy-lab/compare", dependencies=[Depends(expensive)])
def lab_compare(body: LabCompareIn) -> dict:
    job = submit_job("lab_compare", lambda progress, cancel: compare_configs(
        body.configs, body.n_grids, body.time_limit_s, body.seed, progress, cancel), meta={"configs": len(body.configs)})
    return job_response(job)


@router.post("/strategy-lab/auto-tune", dependencies=[Depends(expensive)])
def lab_auto_tune(body: AutoTuneIn) -> dict:
    job = submit_job("auto_tune", lambda progress, cancel: auto_tune(
        body.target, body.n_grids, body.trials, body.time_per_trial_s, body.min_diversity,
        GridConstraints.from_dict(body.constraints.model_dump()), body.max_common, body.seed, progress, cancel),
        meta={"target": body.target})
    return job_response(job)


@router.get("/strategy-lab/metrics")
def lab_metrics() -> dict:
    return {"metrics": TUNABLE_METRICS}


__all__ = ["router", "new_session", "Query"]
