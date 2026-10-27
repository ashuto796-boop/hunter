import { useMemo, useState } from "react";
import { CATALOG } from "../data/catalog";
import { DOMAINS, MARKET_LABEL } from "../data/questions";
import { normalize, scoreIdea } from "../engine/match";
import { currentProject, useApp } from "../store";
import { Domain, Market } from "../types";
import { IconSearch } from "../ui/Icons";
import { IdeaCard } from "../ui/parts";

export function Explore() {
  const project = useApp((s) => currentProject(s));
  const [q, setQ] = useState("");
  const [domain, setDomain] = useState<Domain | "all">("all");
  const [market, setMarket] = useState<Market | "all">("all");

  const list = useMemo(() => {
    const needle = normalize(q).trim();
    const items = CATALOG.filter(
      (i) =>
        (domain === "all" || i.domains.includes(domain)) &&
        (market === "all" || i.market === market) &&
        (!needle || normalize(`${i.name} ${i.pitch} ${i.target} ${i.tags.join(" ")}`).includes(needle))
    ).map((idea) => ({ idea, match: project ? scoreIdea(project.profile, idea) : null }));
    if (project) items.sort((a, b) => b.match!.score - a.match!.score);
    return items;
  }, [q, domain, market, project]);

  const used = new Set(CATALOG.flatMap((i) => i.domains));

  return (
    <main className="page">
      <section className="hero hero-compact">
        <div className="kicker">Catalogue</div>
        <h1>{CATALOG.length} idées de SaaS portées par une tendance</h1>
        <p className="lead">
          Réglementation qui change, nouvel usage, technologie qui devient abordable : chaque idée s'appuie sur une raison d'exister maintenant.
          {project ? " Elles sont triées selon ta compatibilité." : ""}
        </p>
      </section>

      <div className="filters">
        <label className="search">
          <IconSearch />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher : facture, restaurant…" aria-label="Rechercher une idée" />
        </label>
        <div className="seg" role="group" aria-label="Cible">
          {(["all", "b2b", "freelance", "b2c"] as const).map((m) => (
            <button key={m} className={market === m ? "on" : undefined} aria-pressed={market === m} onClick={() => setMarket(m)}>
              {m === "all" ? "Tous" : MARKET_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="chips chips-scroll">
          <button className={`chip chip-filter ${domain === "all" ? "on" : ""}`} aria-pressed={domain === "all"} onClick={() => setDomain("all")}>
            Tous les secteurs
          </button>
          {DOMAINS.filter((d) => used.has(d.value)).map((d) => (
            <button key={d.value} className={`chip chip-filter ${domain === d.value ? "on" : ""}`} aria-pressed={domain === d.value} onClick={() => setDomain(d.value)}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {list.length ? (
        <div className="grid3">
          {list.map(({ idea, match }) => (
            <IdeaCard key={idea.id} idea={idea} match={match} />
          ))}
        </div>
      ) : (
        <p className="muted center">Aucune idée ne correspond à ces filtres.</p>
      )}
    </main>
  );
}
