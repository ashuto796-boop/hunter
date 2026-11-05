"""Sécurité : clé d'API optionnelle et limitation de débit des endpoints coûteux."""

from __future__ import annotations

import hmac
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.config import get_settings


def require_api_key(request: Request) -> None:
    """Si EM_API_KEY est défini, exige l'en-tête X-API-Key (comparaison à temps constant)."""
    expected = get_settings().api_key
    if not expected or request.url.path == "/api/health":
        return
    provided = request.headers.get("x-api-key", "")
    if not hmac.compare_digest(provided.encode(), expected.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Clé d'API manquante ou invalide.")


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_s: float = 60.0) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "Trop de calculs lancés en peu de temps ; patientez une minute.",
                )
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


rate_limiter = RateLimiter()


def expensive(request: Request) -> None:
    """Dépendance FastAPI pour les endpoints coûteux (simulations, optimisation, ML…)."""
    client = request.client.host if request.client else "inconnu"
    rate_limiter.check(f"{client}", get_settings().rate_limit_per_minute)
