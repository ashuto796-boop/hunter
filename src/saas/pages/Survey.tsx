import { useEffect, useRef, useState } from "react";
import { CATALOG } from "../data/catalog";
import { DEFAULT_PROFILE, STEPS } from "../data/questions";
import { generateBatch } from "../generate";
import { go } from "../router";
import { createProject, useApp, useFlash } from "../store";
import { Domain, Profile } from "../types";
import { IconArrowLeft, IconArrowRight, IconCheck } from "../ui/Icons";

function isAnswered(profile: Partial<Profile>, i: number): boolean {
  const step = STEPS[i];
  if (step.optional) return true;
  const v = profile[step.key];
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === "string" && v.trim().length > 0;
}

export function Survey() {
  const draft = useApp((s) => s.draft);
  const step = useApp((s) => Math.min(s.step, STEPS.length - 1));
  const useClaude = useApp((s) => s.useClaude && s.apiKey.trim().length > 0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const q = STEPS[step];
  const answered = isAnswered(draft, step);
  const last = step === STEPS.length - 1;

  useEffect(() => {
    window.scrollTo({ top: 0 });
    inputRef.current?.focus();
  }, [step]);

  const set = (patch: Partial<Profile>) => useApp.setState((s) => ({ draft: { ...s.draft, ...patch } }));
  const setStep = (n: number) => useApp.setState({ step: Math.max(0, Math.min(STEPS.length - 1, n)) });

  async function finish() {
    setBusy(true);
    const profile: Profile = { ...DEFAULT_PROFILE, ...draft, firstName: (draft.firstName ?? "").trim(), problem: (draft.problem ?? "").trim() };
    const started = Date.now();
    const batch = await generateBatch(profile, [], 0);
    // A short beat so the transition reads as a step, not a flicker
    await new Promise((r) => setTimeout(r, Math.max(0, 700 - (Date.now() - started))));
    createProject(profile, batch.matches, batch.source);
    useFlash.setState({ notice: batch.notice ?? null });
    setBusy(false);
    go({ name: "ideas" }, true);
  }

  function next() {
    if (!answered) return;
    if (last) void finish();
    else setStep(step + 1);
  }

  if (busy)
    return (
      <main className="page survey">
        <div className="thinking">
          <div className="pulse" />
          <h1>{useClaude ? "Claude imagine tes 3 idées…" : `On compare ton profil à ${CATALOG.length} idées…`}</h1>
          <p className="muted">
            {useClaude
              ? "Il tient compte de ton temps, de ton niveau, de ton réseau et du problème que tu as décrit. Compte une à deux minutes."
              : "Expérience, cible, temps disponible, objectif : chaque critère compte."}
          </p>
        </div>
      </main>
    );

  return (
    <main className="page survey">
      <div className="survey-top">
        <button className="icon-btn" onClick={() => (step === 0 ? go({ name: "home" }) : setStep(step - 1))} aria-label="Retour">
          <IconArrowLeft />
        </button>
        <div className="progress" aria-label={`Question ${step + 1} sur ${STEPS.length}`}>
          <div style={{ width: `${((step + (answered ? 1 : 0.4)) / STEPS.length) * 100}%` }} />
        </div>
        <span className="num muted small">
          {step + 1}/{STEPS.length}
        </span>
      </div>

      <form
        className="question"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        <h1>{q.title}</h1>
        <p className="lead">{q.subtitle}</p>

        {q.kind === "text" && (
          <input
            ref={inputRef}
            className="input input-lg"
            value={String(draft[q.key] ?? "")}
            placeholder={q.placeholder}
            autoComplete="given-name"
            maxLength={40}
            onChange={(e) => set({ [q.key]: e.target.value })}
          />
        )}

        {q.kind === "textarea" && (
          <textarea
            ref={inputRef}
            className="input textarea"
            value={String(draft[q.key] ?? "")}
            placeholder={q.placeholder}
            maxLength={600}
            rows={4}
            onChange={(e) => set({ [q.key]: e.target.value })}
          />
        )}

        {q.kind === "single" && (
          <div className="options" role="radiogroup">
            {q.options!.map((o) => {
              const on = draft[q.key] === o.value;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  key={o.value}
                  className={`option ${on ? "on" : ""}`}
                  onClick={() => {
                    set({ [q.key]: o.value });
                    window.setTimeout(() => setStep(step + 1), 180);
                  }}
                >
                  <span className="option-text">
                    <span className="option-label">{o.label}</span>
                    {o.hint && <span className="option-hint">{o.hint}</span>}
                  </span>
                  <span className="option-dot">{on && <IconCheck />}</span>
                </button>
              );
            })}
          </div>
        )}

        {q.kind === "multi" && (
          <>
            <div className="options options-grid">
              {q.options!.map((o) => {
                const list = draft.domains ?? [];
                const on = list.includes(o.value as Domain);
                const full = !on && list.length >= (q.max ?? 99);
                return (
                  <button
                    type="button"
                    key={o.value}
                    aria-pressed={on}
                    disabled={full}
                    className={`option option-sm ${on ? "on" : ""}`}
                    onClick={() => set({ domains: on ? list.filter((d) => d !== o.value) : [...list, o.value as Domain] })}
                  >
                    <span className="option-label">{o.label}</span>
                    <span className="option-dot">{on && <IconCheck />}</span>
                  </button>
                );
              })}
            </div>
            <p className="muted small">
              {(draft.domains ?? []).length}/{q.max} sélectionné{(draft.domains ?? []).length > 1 ? "s" : ""}
            </p>
          </>
        )}

        {(q.kind !== "single" || last) && (
          <div className="survey-actions">
            <button type="submit" className="btn btn-primary btn-lg" disabled={!answered}>
              {last ? (useClaude ? "Générer mes idées avec Claude" : "Voir mes 3 idées") : "Continuer"} <IconArrowRight />
            </button>
            {q.optional && !String(draft[q.key] ?? "").trim() && <span className="muted small">Tu peux passer cette question.</span>}
          </div>
        )}
        {q.kind === "single" && answered && !last && (
          <div className="survey-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(step + 1)}>
              Continuer <IconArrowRight />
            </button>
          </div>
        )}
      </form>
    </main>
  );
}
