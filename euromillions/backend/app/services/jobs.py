"""Gestionnaire de tâches longues exécutées en arrière-plan (progression + annulation)."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

log = logging.getLogger("euromillions.jobs")

JobFn = Callable[[Callable[[float, str], None], threading.Event], Any]


class TooManyJobs(RuntimeError):
    pass


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"  # queued | running | done | error | cancelled
    progress: float = 0.0
    message: str = ""
    result: Any = None
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    started_at: str | None = None
    finished_at: str | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    meta: dict[str, Any] = field(default_factory=dict)

    def public(self, include_result: bool = True) -> dict[str, Any]:
        out = {
            "id": self.id, "kind": self.kind, "status": self.status, "progress": round(self.progress, 4),
            "message": self.message, "error": self.error, "created_at": self.created_at,
            "started_at": self.started_at, "finished_at": self.finished_at, "meta": self.meta,
        }
        if include_result:
            out["result"] = self.result
        return out


class JobManager:
    def __init__(self, max_workers: int = 2, max_pending: int = 20, keep: int = 200):
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="em-job")
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self.max_pending = max_pending
        self.keep = keep

    def submit(self, kind: str, fn: JobFn, on_done: Callable[[Job], None] | None = None,
               meta: dict[str, Any] | None = None) -> Job:
        with self._lock:
            pending = sum(1 for j in self._jobs.values() if j.status in ("queued", "running"))
            if pending >= self.max_pending:
                raise TooManyJobs("Trop de calculs en cours ; réessayez dans un instant.")
            job = Job(id=uuid.uuid4().hex, kind=kind, meta=meta or {})
            self._jobs[job.id] = job
            self._trim()

        def progress(frac: float, message: str = "") -> None:
            job.progress = max(0.0, min(1.0, float(frac)))
            if message:
                job.message = message

        def run() -> None:
            if job.cancel_event.is_set():
                job.status = "cancelled"
                job.finished_at = datetime.now(timezone.utc).isoformat()
                return
            job.status = "running"
            job.started_at = datetime.now(timezone.utc).isoformat()
            t0 = time.perf_counter()
            try:
                job.result = fn(progress, job.cancel_event)
                job.status = "cancelled" if job.cancel_event.is_set() else "done"
                job.progress = 1.0 if job.status == "done" else job.progress
            except Exception as exc:
                if job.cancel_event.is_set():
                    job.status = "cancelled"
                else:
                    job.status = "error"
                    job.error = str(exc) or exc.__class__.__name__
                    log.warning("Tâche %s (%s) en erreur : %s", job.id, kind, exc.__class__.__name__)
            finally:
                job.finished_at = datetime.now(timezone.utc).isoformat()
                job.meta["duration_s"] = round(time.perf_counter() - t0, 3)
                if on_done:
                    try:
                        on_done(job)
                    except Exception:  # pragma: no cover - journalisation seulement
                        log.exception("Erreur dans le rappel de fin de tâche %s", job.id)

        self._pool.submit(run)
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> Job | None:
        job = self._jobs.get(job_id)
        if job and job.status in ("queued", "running"):
            job.cancel_event.set()
            job.message = "Annulation demandée…"
        return job

    def list(self, limit: int = 50) -> list[Job]:
        return sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)[:limit]

    def _trim(self) -> None:
        if len(self._jobs) > self.keep:
            done = [j for j in self._jobs.values() if j.status not in ("queued", "running")]
            done.sort(key=lambda j: j.created_at)
            for j in done[: len(self._jobs) - self.keep]:
                del self._jobs[j.id]

    def wait(self, job_id: str, timeout: float = 60.0) -> Job | None:
        """Attente active (utilisée par les tests et le mode synchrone)."""
        t0 = time.time()
        while time.time() - t0 < timeout:
            job = self._jobs.get(job_id)
            if job is None or job.status in ("done", "error", "cancelled"):
                return job
            time.sleep(0.02)
        return self._jobs.get(job_id)


_manager: JobManager | None = None


def get_job_manager() -> JobManager:
    global _manager
    if _manager is None:
        from app.config import get_settings

        _manager = JobManager(max_workers=get_settings().max_concurrent_jobs)
    return _manager
