"""Configuration de l'application (variables d'environnement préfixées EM_)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EM_", env_file=".env", extra="ignore")

    app_name: str = "EuroMillions Quantum Analytics"
    environment: str = "development"
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'data' / 'euromillions.db').as_posix()}"
    auto_migrate: bool = True
    frontend_dist: str | None = None  # chemin vers frontend/dist pour servir l'interface depuis l'API

    # Sécurité
    api_key: str | None = Field(default=None, description="Si défini, exigé dans l'en-tête X-API-Key.")
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080"
    rate_limit_per_minute: int = 30  # endpoints coûteux uniquement

    # Import
    max_upload_mb: float = 10.0
    max_import_rows: int = 100_000
    allowed_import_hosts: str = "www.fdj.fr,media.fdj.fr"
    url_timeout_s: float = 20.0

    # Limites de calcul
    max_grids_per_request: int = 10_000
    max_simulation_draws: int = 5_000_000
    max_simulation_work: int = 2_000_000_000  # tirages × grilles
    max_concurrent_jobs: int = 2
    max_optimizer_seconds: float = 120.0
    exact_portfolio_max_grids: int = 100

    # Jeu (valeurs configurables, à vérifier auprès de l'opérateur)
    default_ticket_price: float = 2.50
    currency: str = "EUR"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def allowed_hosts_list(self) -> list[str]:
        return [h.strip().lower() for h in self.allowed_import_hosts.split(",") if h.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
