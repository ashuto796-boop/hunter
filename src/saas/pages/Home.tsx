import { CATALOG } from "../data/catalog";
import { buildPlan } from "../engine/plan";
import { go } from "../router";
import { currentProject, useApp } from "../store";
import { IconArrowRight, IconCompass } from "../ui/Icons";
import { IdeaCard } from "../ui/parts";

const STEPS = [
  { n: "1", title: "Le sondage", text: "10 questions sur ton temps, tes compétences, ton budget et tes objectifs. Trois minutes." },
  { n: "2", title: "Tes 3 idées", text: "Les idées de SaaS qui collent à ta situation, avec la cible, le prix et pourquoi c'est le moment." },
  { n: "3", title: "Ton prompt Claude", text: "Le prompt complet, adapté à ton niveau, pour que Claude construise le produit avec toi." },
  { n: "4", title: "Ton plan 30 jours", text: "Les actions jour par jour et les messages prêts à envoyer pour signer tes premiers clients." },
];

const TEASER = ["devis-artisans", "dpe-bailleurs", "standard-ia"];

function Landing() {
  return (
    <>
      <section className="hero">
        <div className="kicker">Idée · Prompt · Premiers clients</div>
        <h1>
          Trouve le SaaS fait pour toi, <mark>construis-le avec Claude</mark>, signe tes premiers clients.
        </h1>
        <p className="lead">
          Réponds à quelques questions sur ta situation : Tremplin te propose trois idées de SaaS taillées pour ton temps, tes compétences et tes objectifs, le prompt complet à donner à Claude pour le construire, et ton plan d'action des 30 premiers jours.
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => go({ name: "survey" })}>
            Commencer le sondage <IconArrowRight />
          </button>
          <button className="btn btn-ghost btn-lg" onClick={() => go({ name: "explore" })}>
            <IconCompass /> Explorer les {CATALOG.length} idées
          </button>
        </div>
        <p className="fine">Pas de compte à créer : tes réponses restent dans ce navigateur.</p>
      </section>

      <section className="steps">
        {STEPS.map((s) => (
          <div className="step" key={s.n}>
            <div className="step-n">{s.n}</div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        ))}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Quelques idées portées par une tendance</h2>
          <button className="link-btn" onClick={() => go({ name: "explore" })}>
            Tout voir <IconArrowRight />
          </button>
        </div>
        <div className="grid3">
          {TEASER.map((id) => {
            const idea = CATALOG.find((i) => i.id === id)!;
            return <IdeaCard key={id} idea={idea} />;
          })}
        </div>
      </section>
    </>
  );
}

function Dashboard() {
  const state = useApp();
  const project = currentProject(state)!;
  const { profile } = project;
  const chosen = project.matches.find((m) => m.idea.id === project.chosenId)?.idea;
  const hello = profile.firstName ? `Bonjour ${profile.firstName}` : "Bonjour";

  if (!chosen) {
    const top = project.matches.filter((m) => m.batch === 0);
    return (
      <section className="hero hero-compact">
        <div className="kicker">Ton espace</div>
        <h1>{hello}, tes {top.length} idées t'attendent.</h1>
        <p className="lead">Compare-les, ouvre celle qui te parle le plus et choisis-la pour débloquer ton plan d'action.</p>
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => go({ name: "ideas" })}>
            Voir mes idées <IconArrowRight />
          </button>
          <button className="btn btn-ghost btn-lg" onClick={() => go({ name: "survey" })}>
            Refaire le sondage
          </button>
        </div>
      </section>
    );
  }

  const plan = buildPlan(profile, chosen);
  const tasks = plan.weeks.flatMap((w) => w.tasks.map((t) => ({ week: w, task: t, key: `${chosen.id}/${t.id}` })));
  const doneCount = tasks.filter((t) => state.done[t.key]).length;
  const next = tasks.find((t) => !state.done[t.key]);
  const pct = Math.round((100 * doneCount) / tasks.length);

  return (
    <>
      <section className="hero hero-compact">
        <div className="kicker">Ton projet</div>
        <h1>
          {hello}. On avance sur <mark>{chosen.name}</mark>.
        </h1>
        <p className="lead">{chosen.pitch}</p>
      </section>
      <div className="dash">
        <div className="card">
          <div className="card-label">Plan des 30 jours</div>
          <div className="progress-row">
            <div className="progress">
              <div style={{ width: `${pct}%` }} />
            </div>
            <span className="num">
              {doneCount}/{tasks.length}
            </span>
          </div>
          {next ? (
            <div className="next">
              <div className="muted small">
                Prochaine action · {next.week.title} ({next.week.days})
              </div>
              <div className="next-title">{next.task.title}</div>
              <p className="muted">{next.task.detail}</p>
            </div>
          ) : (
            <p className="next-title">Plan terminé. Bravo ! Fais le bilan et garde le canal qui a le mieux marché.</p>
          )}
          <button className="btn btn-primary" onClick={() => go({ name: "idea", id: chosen.id, tab: "plan" })}>
            Ouvrir le plan <IconArrowRight />
          </button>
        </div>
        <div className="card">
          <div className="card-label">Construire avec Claude</div>
          <p>Ton prompt contient tout le contexte du produit, le périmètre de la v1 et la stack adaptée à ton niveau.</p>
          <button className="btn" onClick={() => go({ name: "idea", id: chosen.id, tab: "prompt" })}>
            Voir le prompt <IconArrowRight />
          </button>
        </div>
        <div className="card">
          <div className="card-label">Changer d'idée</div>
          <p>Ce n'est pas la bonne ? Reviens à tes idées ou refais le sondage avec d'autres réponses.</p>
          <div className="row">
            <button className="btn" onClick={() => go({ name: "ideas" })}>
              Mes idées
            </button>
            <button className="btn btn-ghost" onClick={() => go({ name: "survey" })}>
              Refaire le sondage
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function Home() {
  const hasProject = useApp((s) => s.projects.length > 0);
  return <main className="page">{hasProject ? <Dashboard /> : <Landing />}</main>;
}
