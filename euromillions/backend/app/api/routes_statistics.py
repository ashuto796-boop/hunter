"""Routes : statistiques descriptives et tests."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import DrawFilters, cached_stat, file_response
from app.db import get_db
from app.services import statistics as S
from app.services.export import export_rows

router = APIRouter(prefix="/statistics", tags=["Statistiques"])

Kind = Literal["numbers", "stars"]


@router.get("")
def overview(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "overview", f, (), lambda ds: {**S.overview(ds), "tests": S.statistical_tests(ds) if ds.size else None})


@router.get("/numbers")
def numbers(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "numbers", f, (), S.number_frequencies)


@router.get("/stars")
def stars(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "stars", f, (), S.star_frequencies)


@router.get("/hot-cold")
def hot_cold(kind: Kind = "numbers", window: int | None = Query(50, ge=5, le=100_000), top: int = Query(10, ge=1, le=25),
             f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "hot_cold", f, (kind, window, top), lambda ds: S.hot_cold(ds, kind, window, top))


@router.get("/gaps")
def gaps(kind: Kind = "numbers", f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "gaps", f, (kind,), lambda ds: S.gaps(ds, kind))


@router.get("/pairs")
def pairs(top: int = Query(25, ge=1, le=200), f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "pairs", f, (top,), lambda ds: S.pairs(ds, top))


@router.get("/triples")
def triples(top: int = Query(25, ge=1, le=200), f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "triples", f, (top,), lambda ds: S.triples(ds, top))


@router.get("/star-pairs")
def star_pairs(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "star_pairs", f, (), S.star_pairs)


@router.get("/cooccurrence")
def cooccurrence(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "cooc", f, (), S.cooccurrence_matrix)


@router.get("/parity")
def parity(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "parity", f, (), S.parity)


@router.get("/sums")
def sums(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "sums", f, (), S.sums)


@router.get("/decades")
def decades(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "decades", f, (), S.decades)


@router.get("/spacing")
def spacing(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "spacing", f, (), S.spacing)


@router.get("/consecutive")
def consecutive(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "consecutive", f, (), S.consecutive)


@router.get("/repeats")
def repeats(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "repeats", f, (), S.repeats)


@router.get("/entropy")
def entropy(n_sim: int = Query(400, ge=50, le=5000), seed: int | None = Query(12345, ge=0),
            window: int = Query(100, ge=20, le=2000), f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "entropy", f, (n_sim, seed, window), lambda ds: S.entropy(ds, n_sim, seed, window))


@router.get("/tests")
def tests(f: DrawFilters = Depends(), db: Session = Depends(get_db)) -> dict:
    return cached_stat(db, "tests", f, (), S.statistical_tests)


@router.get("/history")
def history(values: str = Query("1,2,3", max_length=200), kind: Kind = "numbers", f: DrawFilters = Depends(),
            db: Session = Depends(get_db)) -> dict:
    vals = [int(v) for v in values.split(",") if v.strip().isdigit()][:10]
    return cached_stat(db, "history", f, (tuple(vals), kind), lambda ds: S.history_curve(ds, vals, kind))


@router.get("/export")
def export(section: Literal["numbers", "stars", "pairs", "triples", "tests"] = "numbers",
           format: Literal["csv", "xlsx", "json", "pdf"] = "csv", f: DrawFilters = Depends(),
           db: Session = Depends(get_db)):
    params = {"période_début": f.date_from, "période_fin": f.date_to, "derniers_tirages": f.last_n, "époque": f.era}
    if section in ("numbers", "stars"):
        data = cached_stat(db, section, f, (), S.number_frequencies if section == "numbers" else S.star_frequencies)
        cols = ["value", "count", "frequency", "expected", "deviation", "z_score", "p_value", "q_value_bh", "rank",
                "current_gap"]
        title = "Fréquences des numéros" if section == "numbers" else "Fréquences des étoiles"
        rows = data["items"]
        paragraphs = [data["warning"], data["multiple_testing"] if section == "numbers" else data["exposure_note"]]
    elif section == "pairs":
        data = cached_stat(db, "pairs", f, (100,), lambda ds: S.pairs(ds, 100))
        cols = ["a", "b", "count", "expected", "p_value", "q_value_bh"]
        title, rows, paragraphs = "Paires les plus fréquentes", data["most_frequent"], [data["warning"]]
    elif section == "triples":
        data = cached_stat(db, "triples", f, (100,), lambda ds: S.triples(ds, 100))
        cols = ["values", "count", "expected", "p_value", "q_value_bh"]
        title, rows, paragraphs = "Triplets les plus fréquents", data["most_frequent"], [data["warning"]]
    else:
        data = cached_stat(db, "tests", f, (), S.statistical_tests)
        cols = ["code", "name", "statistic", "df", "p_value", "q_value_bh", "p_bonferroni", "reject_h0_5pct_bh"]
        title, rows, paragraphs = "Tests statistiques", data["tests"], [data["interpretation"]]
    content = export_rows(format, title, cols, rows, payload=data, params=params, paragraphs=paragraphs)
    return file_response(content, format, f"statistiques_{section}")
