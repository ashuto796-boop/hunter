from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP = tempfile.mkdtemp(prefix="em_tests_")
# EM_TEST_DATABASE_URL permet d'exécuter la suite contre PostgreSQL (base dédiée et vide).
os.environ["EM_DATABASE_URL"] = os.environ.get("EM_TEST_DATABASE_URL") or f"sqlite:///{Path(_TMP, 'test.db').as_posix()}"
os.environ["EM_RATE_LIMIT_PER_MINUTE"] = "100000"
os.environ.pop("EM_API_KEY", None)

from app.config import get_settings  # noqa: E402

get_settings.cache_clear()

from app.services.jobs import get_job_manager  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def demo_loaded(client):
    client.delete("/api/draws", params={"confirm": True})
    r = client.post("/api/draws/import/demo")
    assert r.status_code == 200, r.text
    return r.json()


def wait_job(client, payload_or_id, timeout: float = 120.0) -> dict:
    job_id = payload_or_id if isinstance(payload_or_id, str) else payload_or_id["job"]["id"]
    get_job_manager().wait(job_id, timeout)
    r = client.get(f"/api/jobs/{job_id}")
    assert r.status_code == 200
    job = r.json()
    assert job["status"] == "done", job
    return job["result"]


@pytest.fixture
def demo_drawset():
    from datetime import datetime

    from app.core.rules import era_for_date
    from app.services.statistics import DrawSet

    path = Path(__file__).resolve().parent.parent / "data" / "demo_tirages_FICTIFS.csv"
    if not path.exists():
        from app.services.demo_data import generate

        generate(path)
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or line.startswith("date"):
            continue
        p = line.split(";")
        d = datetime.strptime(p[0], "%d/%m/%Y").date()
        e = era_for_date(d)
        rows.append((d, [int(x) for x in p[1:6]], [int(x) for x in p[6:8]], e.stars_max, e.code))
    return DrawSet.from_rows(rows)
