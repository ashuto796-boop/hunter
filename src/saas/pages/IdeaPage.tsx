import { useEffect } from "react";
import { DEFAULT_PROFILE } from "../data/questions";
import { eur, priceLabel, slug } from "../engine/format";
import { revenueTarget } from "../engine/match";
import { buildPlan } from "../engine/plan";
import { buildLandingPrompt, buildPrompt } from "../engine/prompt";
import { go, IdeaTab } from "../router";
import { chooseIdea, currentProject, findIdea, matchFor, toggleTask, useApp } from "../store";
import { Idea, Plan, Profile } from "../types";
import { IconAlert, IconArrowLeft, IconArrowRight, IconCheck, IconDownload, IconExternal, IconTrend } from "../ui/Icons";
import { CopyButton, Empty, IdeaChips, ScoreRing, Section } from "../ui/parts";
import { download } from "../ui/util";

const TABS: { id: IdeaTab; label: string }[] = [
  { id: "idee", label: "L'idée" },
  { id: "prompt", label: "Prompt Claude" },
  { id: "plan", label: "Plan 30 jours" },
];

function planMarkdown(idea: Idea, plan: Plan, done: Record<string, boolean>): string {
  const out = [`# Plan des 30 jours — ${idea.name}`, "", idea.pitch, "", "## Objectifs à J+30", ""];
  plan.targets.forEach((t) => out.push(`- ${t.label} : ${t.value}`));
  for (const w of plan.weeks) {
    out.push("", `## ${w.title} (${w.days})`, "", `Objectif : ${w.goal}`, "");
    w.tasks.forEach((t) => out.push(`- [${done[`${idea.id}/${t.id}`] ? "x" : " "}] **${t.title}** (${t.minutes} min) — ${t.detail}`));
  }
  out.push("", "## Modèles de messages");
  plan.templates.forEach((t) => out.push("", `### ${t.title}`, "", t.body));
  return out.join("\n") + "\n";
}

function IdeaTabView({ idea, profile, personal }: { idea: Idea; profile: Profile; personal: boolean }) {
  const state = useApp();
  const project = currentProject(state);
  const match = matchFor(idea, state);
  const { mrr, clients } = revenueTarget(profile, idea);
  const chosen = project?.chosenId === idea.id;

  return (
    <div className="detail">
      <div className="detail-main">
        <Section title="Le problème">
          <p>{idea.problem}</p>
        </Section>
        <Section title="La solution">
          <p>{idea.solution}</p>
        </Section>
        <Section title="Pourquoi maintenant" icon={<IconTrend />}>
          <p>{idea.whyNow}</p>
        </Section>
        <Section title="Le MVP">
          <ol className="numbered">
            {idea.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ol>
        </Section>
        <Section title="Où trouver tes 10 premiers clients">
          <ul className="bullets">
            {idea.channels.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Section>
        <Section title="Ce qu'ils utilisent aujourd'hui">
          <p>{idea.alternatives}</p>
        </Section>
      </div>

      <aside className="detail-side">
        <div className="card">
          <div className="card-label">Cible</div>
          <p>{idea.target}</p>
        </div>
        <div className="card">
          <div className="card-label">Modèle économique</div>
          <div className="big">{priceLabel(idea)}</div>
          <p className="muted">
            {personal ? `Pour ton objectif de ${eur(mrr)} par mois` : `Pour ${eur(mrr)} par mois`} : <strong className="ink">{clients}</strong> {idea.recurring ? "clients abonnés" : "ventes par mois"}.
          </p>
        </div>
        {match && (match.reasons.length > 0 || match.warnings.length > 0) && (
          <div className="card">
            <div className="card-label">Pour toi</div>
            {match.reasons.length > 0 && (
              <ul className="reasons">
                {match.reasons.map((r) => (
                  <li key={r}>
                    <IconCheck />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
            {match.warnings.length > 0 && (
              <ul className="reasons warn">
                {match.warnings.map((r) => (
                  <li key={r}>
                    <IconAlert />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!match && idea.caution && (
          <div className="card">
            <div className="card-label">Point d'attention</div>
            <ul className="reasons warn">
              <li>
                <IconAlert />
                <span>{idea.caution}</span>
              </li>
            </ul>
          </div>
        )}
        {project ? (
          chosen ? (
            <div className="card card-accent">
              <div className="card-label">Ton projet</div>
              <p>C'est l'idée que tu lances. Ton plan d'action est prêt.</p>
              <button className="btn btn-primary" onClick={() => go({ name: "idea", id: idea.id, tab: "plan" })}>
                Ouvrir le plan <IconArrowRight />
              </button>
            </div>
          ) : (
            <button
              className="btn btn-primary btn-lg btn-block"
              onClick={() => {
                chooseIdea(idea);
                go({ name: "idea", id: idea.id, tab: "plan" });
              }}
            >
              Je choisis cette idée <IconArrowRight />
            </button>
          )
        ) : (
          <button className="btn btn-primary btn-lg btn-block" onClick={() => go({ name: "survey" })}>
            Faire le sondage pour personnaliser <IconArrowRight />
          </button>
        )}
      </aside>
    </div>
  );
}

function PromptTabView({ idea, profile }: { idea: Idea; profile: Profile }) {
  const prompt = buildPrompt(profile, idea);
  const landing = buildLandingPrompt(profile, idea);
  return (
    <div className="stack">
      <div className="card how">
        <div className="card-label">Comment l'utiliser</div>
        <ol className="numbered">
          <li>Copie le prompt ci-dessous.</li>
          <li>
            Colle-le dans {profile.tech === "none" || profile.tech === "nocode" ? "Claude Code (claude.ai/code ou l'application de bureau)" : "Claude Code ou claude.ai"} et envoie-le tel quel.
          </li>
          <li>Claude te propose d'abord le modèle de données et les étapes : valide-les, puis avancez étape par étape.</li>
        </ol>
        <div className="row">
          <CopyButton text={prompt} label="Copier le prompt" className="btn btn-primary" />
          <a className="btn" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
            <IconExternal /> Ouvrir Claude
          </a>
          <button className="btn btn-ghost" onClick={() => download(`prompt-${slug(idea.name)}.md`, prompt + "\n")}>
            <IconDownload /> .md
          </button>
        </div>
      </div>
      <pre className="prompt">{prompt}</pre>

      <Section title="Bonus : le prompt de ta page d'attente">
        <p className="muted">À utiliser dès la semaine 1, avant de construire le produit, pour recueillir des inscriptions.</p>
        <pre className="prompt prompt-sm">{landing}</pre>
        <CopyButton text={landing} label="Copier ce prompt" />
      </Section>
    </div>
  );
}

function PlanTabView({ idea, profile }: { idea: Idea; profile: Profile }) {
  const done = useApp((s) => s.done);
  const plan = buildPlan(profile, idea);
  const keys = plan.weeks.flatMap((w) => w.tasks.map((t) => `${idea.id}/${t.id}`));
  const doneCount = keys.filter((k) => done[k]).length;

  return (
    <div className="stack">
      <div className="targets">
        {plan.targets.map((t) => (
          <div className="target" key={t.label}>
            <div className="target-value">{t.value}</div>
            <div className="target-label">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="progress-row">
          <div className="progress">
            <div style={{ width: `${(100 * doneCount) / keys.length}%` }} />
          </div>
          <span className="num">
            {doneCount}/{keys.length}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => download(`plan-30-jours-${slug(idea.name)}.md`, planMarkdown(idea, plan, done))}>
            <IconDownload /> .md
          </button>
        </div>
      </div>

      {plan.weeks.map((w, wi) => {
        const minutes = w.tasks.reduce((a, t) => a + t.minutes, 0);
        return (
          <section className="week" key={w.id}>
            <div className="week-head">
              <div className="week-n">S{wi + 1}</div>
              <div>
                <h2>{w.title}</h2>
                <div className="muted small">
                  {w.days} · environ {Math.round(minutes / 60)} h
                </div>
              </div>
            </div>
            <p className="week-goal">{w.goal}</p>
            <ul className="tasks">
              {w.tasks.map((t) => {
                const key = `${idea.id}/${t.id}`;
                const on = !!done[key];
                return (
                  <li key={t.id} className={on ? "done" : undefined}>
                    <button className="task-check" role="checkbox" aria-checked={on} aria-label={t.title} onClick={() => toggleTask(key)}>
                      {on && <IconCheck />}
                    </button>
                    <div className="task-body">
                      <div className="task-title">
                        {t.title} <span className="task-min">{t.minutes} min</span>
                      </div>
                      <p>{t.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <Section title="Messages prêts à envoyer">
        <p className="muted">Remplace ce qui est entre crochets. Les meilleurs messages sont courts et parlent du problème, pas du produit.</p>
        <div className="templates">
          {plan.templates.map((t) => (
            <div className="card template" key={t.id}>
              <div className="template-head">
                <div>
                  <div className="template-title">{t.title}</div>
                  <div className="muted small">{t.hint}</div>
                </div>
                <CopyButton text={t.body} className="btn btn-sm" />
              </div>
              <pre className="template-body">{t.body}</pre>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

export function IdeaPage({ id, tab }: { id: string; tab: IdeaTab }) {
  const state = useApp();
  const idea = findIdea(id, state);
  const project = currentProject(state);
  const profile = project?.profile ?? DEFAULT_PROFILE;
  const match = idea ? matchFor(idea, state) : null;
  const inProject = !!project?.matches.some((m) => m.idea.id === id);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [id, tab]);

  if (!idea)
    return (
      <main className="page">
        <Empty
          title="Idée introuvable"
          text="Elle a peut-être été supprimée avec un ancien sondage."
          action={
            <button className="btn btn-primary" onClick={() => go({ name: "ideas" })}>
              Mes idées
            </button>
          }
        />
      </main>
    );

  return (
    <main className="page">
      <button className="back" onClick={() => go(inProject ? { name: "ideas" } : { name: "explore" })}>
        <IconArrowLeft /> {inProject ? "Mes idées" : "Explorer"}
      </button>
      <header className="idea-head">
        <div className="idea-head-row">
          <h1>{idea.name}</h1>
          {match && <ScoreRing value={match.score} size={64} />}
        </div>
        <p className="lead">{idea.pitch}</p>
        <IdeaChips idea={idea} />
      </header>

      {!project && (
        <p className="notice">
          Ce prompt et ce plan sont génériques. <button className="link-inline" onClick={() => go({ name: "survey" })}>Fais le sondage</button> pour qu'ils tiennent compte de ton temps, de ton niveau et de ton réseau.
        </p>
      )}

      <nav className="tabs" aria-label="Sections de l'idée">
        {TABS.map((t) => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? "on" : ""}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => go({ name: "idea", id, tab: t.id }, true)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "idee" && <IdeaTabView idea={idea} profile={profile} personal={!!project} />}
      {tab === "prompt" && <PromptTabView idea={idea} profile={profile} />}
      {tab === "plan" && <PlanTabView idea={idea} profile={profile} />}
    </main>
  );
}
