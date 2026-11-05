"""Routes : historique des tirages et import."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import draw_out, is_demo_data
from app.config import get_settings
from app.core.grid import validate_grid
from app.core.rules import era_for_date
from app.db import get_db
from app.models import DataSource, Draw, DrawPrize, utcnow
from app.schemas import DrawCreate, UrlImportIn
from app.services import importer
from app.services.settings_store import get_setting, set_setting

router = APIRouter(prefix="/draws", tags=["Tirages"])


@router.get("")
def list_draws(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    date_from: str | None = None,
    date_to: str | None = None,
    order: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
) -> dict:
    q = select(Draw)
    cq = select(func.count(Draw.id))
    if date_from:
        q = q.where(Draw.draw_date >= date_from)
        cq = cq.where(Draw.draw_date >= date_from)
    if date_to:
        q = q.where(Draw.draw_date <= date_to)
        cq = cq.where(Draw.draw_date <= date_to)
    q = q.order_by(Draw.draw_date.desc() if order == "desc" else Draw.draw_date.asc())
    total = db.scalar(cq) or 0
    items = db.scalars(q.offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [draw_out(d) for d in items], "total": total, "page": page, "page_size": page_size,
            "pages": (total + page_size - 1) // page_size}


@router.get("/summary")
def summary(db: Session = Depends(get_db)) -> dict:
    count = db.scalar(select(func.count(Draw.id))) or 0
    first = db.scalar(select(func.min(Draw.draw_date)))
    last = db.scalar(select(func.max(Draw.draw_date)))
    eras = db.execute(select(Draw.era_code, func.count(Draw.id)).group_by(Draw.era_code)).all()
    with_prizes = db.scalar(select(func.count(func.distinct(DrawPrize.draw_id)))) or 0
    return {
        "count": count,
        "first_date": first.isoformat() if first else None,
        "last_date": last.isoformat() if last else None,
        "eras": {e: n for e, n in eras},
        "is_demo": is_demo_data(db),
        "last_refresh": get_setting(db, "last_refresh"),
        "draws_with_prizes": with_prizes,
        "demo_warning": (
            "Données de démonstration FICTIVES : ce ne sont pas des résultats officiels EuroMillions."
            if is_demo_data(db) else None
        ),
    }


@router.get("/sources")
def sources(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(DataSource).order_by(DataSource.imported_at.desc())).all()
    return [{"id": s.id, "name": s.name, "kind": s.kind, "location": s.location, "sha256": s.sha256,
             "is_demo": s.is_demo, "imported_at": s.imported_at.isoformat(), "rows_inserted": s.rows_inserted,
             "rows_rejected": s.rows_rejected, "rows_duplicated": s.rows_duplicated, "notes": s.notes} for s in rows]


@router.get("/{draw_id}")
def get_draw(draw_id: int, db: Session = Depends(get_db)) -> dict:
    d = db.get(Draw, draw_id)
    if d is None:
        raise HTTPException(404, "Tirage introuvable.")
    return draw_out(d)


@router.post("", status_code=201)
def create_draw(body: DrawCreate, db: Session = Depends(get_db)) -> dict:
    if is_demo_data(db):
        raise HTTPException(400, "L'historique actuel est fictif (démonstration) : purgez-le avant d'ajouter des tirages réels.")
    era = era_for_date(body.draw_date)
    validate_grid(body.numbers, body.stars, era)
    if db.scalar(select(Draw.id).where(Draw.draw_date == body.draw_date)):
        raise HTTPException(409, f"Un tirage existe déjà pour le {body.draw_date.isoformat()}.")
    src = db.scalar(select(DataSource).where(DataSource.kind == "manual", DataSource.name == "Saisie manuelle"))
    if src is None:
        src = DataSource(name="Saisie manuelle", kind="manual", imported_at=utcnow())
        db.add(src)
        db.flush()
    n, s = sorted(body.numbers), sorted(body.stars)
    d = Draw(draw_date=body.draw_date, era_code=era.code, n1=n[0], n2=n[1], n3=n[2], n4=n[3], n5=n[4], s1=s[0], s2=s[1],
             stars_max=era.stars_max, jackpot_eur=body.jackpot_eur, source_id=src.id)
    for rank, info in body.prizes.items():
        if not 1 <= int(rank) <= 13:
            raise HTTPException(400, "Rang de gain hors bornes (1 à 13).")
        winners = info.get("winners")
        prize = info.get("prize_eur")
        d.prizes.append(DrawPrize(rank=int(rank), winners=int(winners) if winners is not None else None,
                                  prize_eur=float(prize) if prize is not None else None))
    db.add(d)
    src.rows_inserted += 1
    db.commit()
    set_setting(db, "last_refresh", utcnow().isoformat())
    return draw_out(d)


@router.delete("/{draw_id}", status_code=204)
def delete_draw(draw_id: int, db: Session = Depends(get_db)) -> None:
    d = db.get(Draw, draw_id)
    if d is None:
        raise HTTPException(404, "Tirage introuvable.")
    db.delete(d)
    db.commit()


@router.delete("", status_code=200)
def purge(confirm: bool = Query(False), db: Session = Depends(get_db)) -> dict:
    if not confirm:
        raise HTTPException(400, "Confirmez la purge avec ?confirm=true.")
    n = db.scalar(select(func.count(Draw.id))) or 0
    db.execute(delete(DrawPrize))
    db.execute(delete(Draw))
    db.execute(delete(DataSource))
    db.commit()
    return {"deleted": n}


@router.post("/import/file")
async def import_file(file: UploadFile = File(...), overwrite: bool = Form(False), db: Session = Depends(get_db)) -> dict:
    limit = int(get_settings().max_upload_mb * 1024 * 1024)
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(413, f"Fichier trop volumineux (limite : {get_settings().max_upload_mb:g} Mo).")
    name = (file.filename or "fichier.csv").rsplit("/", 1)[-1].rsplit("\\", 1)[-1][:200]
    kind = "excel" if name.lower().endswith((".xlsx", ".xlsm")) else "csv"
    return importer.import_bytes(db, content, name, kind=kind, overwrite=overwrite)


@router.post("/import/url")
def import_url(body: UrlImportIn, db: Session = Depends(get_db)) -> dict:
    content, filename = importer.fetch_url(body.url)
    return importer.import_bytes(db, content, filename, kind="url", location=body.url, overwrite=body.overwrite,
                                 source_name=f"URL : {filename}")


@router.post("/import/demo")
def import_demo(db: Session = Depends(get_db)) -> dict:
    from pathlib import Path

    from app.config import BACKEND_DIR

    path = Path(BACKEND_DIR) / "data" / "demo_tirages_FICTIFS.csv"
    if not path.exists():
        from app.services.demo_data import generate

        generate(path)
    content = path.read_bytes()
    return importer.import_bytes(db, content, path.name, kind="demo", is_demo=True,
                                 source_name="Démonstration — tirages FICTIFS")
