import { useState } from "react";
import { DOMAINS, GOALS, HOURS, TECH, labelOf } from "../data/questions";
import { generateBatch } from "../generate";
import { go } from "../router";
import { appendMatches, currentProject, deleteProject, useApp, useFlash } from "../store";
import { Match } from "../types";
import { IconArrowRight, IconSparkle, IconTrash } from "../ui/Icons";
import { Empty, IdeaCard } from "../ui/parts";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function Ideas() {
  const state = useApp();
  const notice = useFlash((s) => s.notice);
  const [busy, setBusy] = useState(false);
  const project = currentProject(state);

  if (!project)
    return (
      <main className="page">
        <Empty
          title="Pas encore d'idées"
          text="Réponds au sondage : en trois minutes, tu obtiens trois idées de SaaS adaptées à ta situation."
          action={
            <button className="btn btn-primary btn-lg" onClick={() => go({ name: "survey" })}>
              Commencer le sondage <IconArrowRight />
            </button>
          }
        />
      </main>
    );

  const { profile } = project;
  const batches = new Map<number, Match[]>();
  for (const m of project.matches) batches.set(m.batch, [...(batches.get(m.batch) ?? []), m]);
  const order = [...batches.keys()].sort((a, b) => (a === -1 ? 1 : b === -1 ? -1 : a - b));
  const nextBatch = Math.max(0, ...project.matches.map((m) => m.batch)) + 1;

  async function more() {
    setBusy(true);
    useFlash.setState({ notice: null });
    const res = await generateBatch(profile, project!.matches.map((m) => m.idea), nextBatch);
    if (res.matches.length) appendMatches(project!.id, res.matches);
    useFlash.setState({ notice: res.notice ?? (res.matches.length ? null : "Tu as déjà vu toutes les idées du catalogue qui te correspondent.") });
    setBusy(false);
  }

  const summary = [
    labelOf(HOURS, profile.hours) + " par semaine",
    labelOf(TECH, profile.tech),
    labelOf(GOALS, profile.goal),
    profile.domains.map((d) => labelOf(DOMAINS, d)).join(", "),
  ].filter(Boolean);

  return (
    <main className="page">
      <section className="hero hero-compact">
        <div className="kicker">
          {project.source === "claude" ? (
            <>
              <IconSparkle /> Imaginées par Claude
            </>
          ) : (
            "Sélectionnées pour toi"
          )}
        </div>
        <h1>{profile.firstName ? `${profile.firstName}, voici tes 3 idées de SaaS` : "Tes 3 idées de SaaS"}</h1>
        <p className="lead">Classées selon ta compatibilité. Ouvre une idée pour voir le détail, le prompt Claude et ton plan des 30 jours, puis choisis celle que tu lances.</p>
        <div className="chips">
          {summary.map((s) => (
            <span className="chip chip-soft" key={s}>
              {s}
            </span>
          ))}
          <button className="chip chip-link" onClick={() => go({ name: "survey" })}>
            Modifier mes réponses
          </button>
        </div>
      </section>

      {notice && <p className="notice">{notice}</p>}

      {order.map((b) => (
        <section className="section" key={b}>
          {b !== 0 && <h2 className="section-title">{b === -1 ? "Ajoutées depuis l'exploration" : "Nouvelles pistes"}</h2>}
          <div className="grid3">
            {batches.get(b)!.map((m, i) => (
              <div key={m.idea.id} className={project.chosenId === m.idea.id ? "chosen" : undefined}>
                {project.chosenId === m.idea.id && <div className="chosen-tag">Ton projet</div>}
                <IdeaCard idea={m.idea} match={m} rank={b === 0 ? i + 1 : undefined} />
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="center-actions">
        <button className="btn btn-lg" onClick={more} disabled={busy}>
          {busy ? "Recherche en cours…" : "Proposer 3 autres idées"}
        </button>
        <button className="btn btn-ghost btn-lg" onClick={() => go({ name: "explore" })}>
          Explorer tout le catalogue
        </button>
      </div>

      {state.projects.length > 1 && (
        <section className="section">
          <h2 className="section-title">Mes sondages précédents</h2>
          <div className="history">
            {state.projects.map((p) => (
              <div className={`history-row ${p.id === project.id ? "on" : ""}`} key={p.id}>
                <button className="history-main" onClick={() => useApp.setState({ currentId: p.id })}>
                  <span className="history-date">{dateFmt.format(p.createdAt)}</span>
                  <span className="muted">
                    {p.matches
                      .filter((m) => m.batch === 0)
                      .map((m) => m.idea.name)
                      .join(" · ")}
                  </span>
                </button>
                <button
                  className="icon-btn"
                  aria-label="Supprimer ce sondage"
                  onClick={() => {
                    if (confirm("Supprimer ce sondage et ses idées ?")) deleteProject(p.id);
                  }}
                >
                  <IconTrash />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
