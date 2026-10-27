import { useState } from "react";
import { CLAUDE_MODEL } from "../engine/model";
import { currentProject, resetAll, useApp } from "../store";
import { IconDownload, IconExternal, IconSparkle } from "../ui/Icons";
import { download } from "../ui/util";

export function Settings() {
  const state = useApp();
  const project = currentProject(state);
  const [show, setShow] = useState(false);
  const key = state.apiKey.trim();
  const keyLooksWrong = key.length > 0 && !key.startsWith("sk-ant-");

  return (
    <main className="page narrow">
      <section className="hero hero-compact">
        <div className="kicker">Réglages</div>
        <h1>Tes réglages</h1>
      </section>

      {project && (
        <section className="card form-card">
          <h2 className="card-title">Profil</h2>
          <label className="field">
            <span>Prénom</span>
            <input
              className="input"
              value={project.profile.firstName}
              maxLength={40}
              onChange={(e) =>
                useApp.setState((s) => ({
                  projects: s.projects.map((p) => (p.id === project.id ? { ...p, profile: { ...p.profile, firstName: e.target.value } } : p)),
                  draft: { ...s.draft, firstName: e.target.value },
                }))
              }
            />
          </label>
          <p className="muted small">Utilisé dans ton prompt et tes messages de prospection.</p>
        </section>
      )}

      <section className="card form-card">
        <h2 className="card-title">
          <IconSparkle /> Mode Claude
        </h2>
        <p>
          Avec ta propre clé API Claude, tes idées ne sont plus choisies dans le catalogue : Claude (<code>{CLAUDE_MODEL}</code>) les invente sur mesure à partir de toutes tes réponses, y compris le problème que tu décris.
        </p>
        <label className="toggle">
          <input type="checkbox" checked={state.useClaude} onChange={(e) => useApp.setState({ useClaude: e.target.checked })} />
          <span className="toggle-ui" aria-hidden="true" />
          <span>Générer mes idées avec Claude</span>
        </label>
        <label className="field">
          <span>Clé API Anthropic</span>
          <div className="row nowrap">
            <input
              className="input"
              type={show ? "text" : "password"}
              value={state.apiKey}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => useApp.setState({ apiKey: e.target.value })}
            />
            <button className="btn btn-ghost" type="button" onClick={() => setShow(!show)}>
              {show ? "Masquer" : "Afficher"}
            </button>
          </div>
        </label>
        {keyLooksWrong && <p className="notice">Une clé API Anthropic commence par « sk-ant- ».</p>}
        {state.useClaude && !key && <p className="notice">Ajoute ta clé pour activer le mode Claude. Sans clé, le catalogue est utilisé.</p>}
        <ul className="bullets small muted">
          <li>La clé reste dans ce navigateur et n'est envoyée qu'à api.anthropic.com, directement depuis ton appareil.</li>
          <li>Chaque génération de 3 idées coûte quelques dizaines de centimes, facturés sur ton compte Anthropic.</li>
          <li>Utilise de préférence une clé dédiée avec une limite de dépense, et ne l'active pas sur un ordinateur partagé.</li>
        </ul>
        <a className="btn btn-ghost" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
          <IconExternal /> Créer une clé
        </a>
      </section>

      <section className="card form-card">
        <h2 className="card-title">Mes données</h2>
        <p className="muted">Pas de compte, pas de serveur : tes réponses, tes idées et ta progression sont enregistrées uniquement dans ce navigateur.</p>
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              const data = { ...useApp.getState(), apiKey: undefined };
              download("tremplin-donnees.json", JSON.stringify(data, null, 2), "application/json");
            }}
          >
            <IconDownload /> Exporter (.json)
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm("Effacer toutes tes réponses, idées, progression et ta clé API ?")) resetAll();
            }}
          >
            Tout effacer
          </button>
        </div>
      </section>
    </main>
  );
}
