import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Job, JobStart } from "./types";

/**
 * Suit une tâche de fond : interrogation périodique de /api/jobs/{id} jusqu'à la fin,
 * avec progression et annulation. L'interface n'est jamais bloquée pendant le calcul.
 */
export function useJob<T>(onDone?: (result: T, job: Job<T>) => void) {
  const [job, setJob] = useState<Job<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const poll = useCallback((id: string, delay = 250) => {
    stop();
    timer.current = window.setTimeout(async () => {
      try {
        const j = await api.get<Job<T>>(`/jobs/${id}`);
        setJob(j);
        if (j.status === "done") {
          if (j.result !== undefined) doneRef.current?.(j.result, j);
        } else if (j.status === "error") {
          setError(j.error ?? "Erreur pendant le calcul.");
        } else if (j.status !== "cancelled") {
          poll(id, Math.min(1000, delay * 1.3));
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }, delay);
  }, []);

  const start = useCallback(
    async (fn: () => Promise<JobStart | { result: T }>) => {
      setError(null);
      setJob(null);
      try {
        const res = await fn();
        if ("result" in res) {
          const fake: Job<T> = {
            id: "sync", kind: "sync", status: "done", progress: 1, message: "", error: null,
            created_at: new Date().toISOString(), started_at: null, finished_at: null, meta: {}, result: res.result,
          };
          setJob(fake);
          doneRef.current?.(res.result, fake);
          return res;
        }
        setJob(res.job as Job<T>);
        poll(res.job.id);
        return res;
      } catch (e) {
        setError((e as Error).message);
        return null;
      }
    },
    [poll],
  );

  const cancel = useCallback(async () => {
    if (!job || job.id === "sync") return;
    try {
      const j = await api.post<Job<T>>(`/jobs/${job.id}/cancel`);
      setJob(j);
      poll(job.id, 300);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [job, poll]);

  useEffect(() => stop, []);

  const running = !!job && (job.status === "queued" || job.status === "running");
  return { job, error, running, start, cancel, setError };
}
