"""Point d'entrée FastAPI : EuroMillions Quantum Analytics."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import routes_analysis, routes_core, routes_draws, routes_portfolios, routes_statistics
from app.config import get_settings
from app.db import Base, get_engine, init_engine
from app.security import require_api_key

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s : %(message)s")
log = logging.getLogger("euromillions")


def run_migrations() -> None:
    """Applique les migrations Alembic (ou crée le schéma si Alembic est indisponible)."""
    settings = get_settings()
    backend_dir = Path(__file__).resolve().parent.parent
    ini = backend_dir / "alembic.ini"
    if ini.exists():
        from alembic import command
        from alembic.config import Config

        cfg = Config(str(ini))
        cfg.attributes["skip_logging"] = True
        cfg.set_main_option("script_location", str(backend_dir / "alembic"))
        cfg.set_main_option("sqlalchemy.url", settings.database_url)
        command.upgrade(cfg, "head")
    else:  # pragma: no cover
        Base.metadata.create_all(get_engine())


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_engine()
    if get_settings().auto_migrate:
        run_migrations()
    log.info("EuroMillions Quantum Analytics %s démarré", __version__)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="EuroMillions Quantum Analytics — API",
        version=__version__,
        description=(
            "API d'analyse statistique de l'EuroMillions. Rappel : chaque grille valide a exactement la même "
            "probabilité de gagner le jackpot (1 sur 139 838 160) ; aucun score de cette API n'est une probabilité "
            "de sortie."
        ),
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-API-Key"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    @app.exception_handler(ValueError)
    async def value_error_handler(_request: Request, exc: ValueError):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_request: Request, exc: RequestValidationError):
        errors = []
        for e in exc.errors():
            loc = " → ".join(str(x) for x in e.get("loc", []) if x != "body")
            msg = e.get("msg", "valeur invalide").replace("Value error, ", "")
            errors.append(f"{loc} : {msg}" if loc else msg)
        return JSONResponse(status_code=422, content={"detail": "Requête invalide. " + " ; ".join(errors[:10]),
                                                      "errors": errors})

    @app.exception_handler(Exception)
    async def unhandled(_request: Request, exc: Exception):  # pragma: no cover - filet de sécurité
        log.error("Erreur interne : %s", exc.__class__.__name__)
        return JSONResponse(status_code=500, content={"detail": "Erreur interne du serveur."})

    deps = [Depends(require_api_key)]
    app.include_router(routes_core.router, prefix="/api", dependencies=deps)
    app.include_router(routes_draws.router, prefix="/api", dependencies=deps)
    app.include_router(routes_statistics.router, prefix="/api", dependencies=deps)
    app.include_router(routes_portfolios.router, prefix="/api", dependencies=deps)
    app.include_router(routes_analysis.router, prefix="/api", dependencies=deps)

    # Service optionnel de l'interface compilée (exécution locale en un seul processus).
    dist = Path(settings.frontend_dist) if settings.frontend_dist else None
    if dist and (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            target = (dist / path).resolve()
            if path and target.is_file() and dist.resolve() in target.parents:
                return FileResponse(target)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
