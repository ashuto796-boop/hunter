import { useCallback, useEffect, useMemo, useState } from "react";
import cfg from "../../server/ecom/config.json";
import { DEFAULT_URL, REPO_URL, ago, eur, loadState, store, type Loaded } from "./data";
import { goalPlan } from "./shared/finance";
import { PROFILE, ROSTER, type AgentProfile } from "./shared/roster";
import type { AgentId, AgentReport, EcomState, ProductIdea, Task } from "./shared/types";

type Tab = "today" | "team" | "products" | "content" | "plan";
const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Aujourd'hui" },
  { id: "team", label: "Équipe" },
  { id: "products", label: "Produits" },
  { id: "content", label: "Contenu" },
  { id: "plan", label: "Plan" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (store.get("ecom.tab") as Tab) || "today");
  const [pass, setPass] = useState(() => store.get("ecom.pass"));
  const [url, setUrl] = useState(() => store.get("ecom.url") || DEFAULT_URL);
  const [data, setData] = useState<Loaded | null>(null);
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [settings, setSettings] = useState(false);

  const refresh = useCallback(async () => setData(await loadState(url, pass)), [url, pass]);
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 5 * 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);
  useEffect(() => store.set("ecom.tab", tab), [tab]);

  const state = data?.kind === "ok" ? data.state : null;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">V</span>
          <div>
            <strong>Vitrine</strong>
            <small>{state ? `${state.shop?.name ?? "Boutique pas encore connectée"} · ${ago(state.at)}` : "Ta boutique, tenue par 10 agents"}</small>
          </div>
        </div>
        <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Réglages">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab !== "plan" && tab !== "team" && !state && <Status data={data} onUnlock={(p) => { store.set("ecom.pass", p); setPass(p); }} goPlan={() => setTab("plan")} />}
        {tab === "today" && state && <Today state={state} openAgent={setAgent} />}
        {tab === "team" && <Team state={state} openAgent={setAgent} />}
        {tab === "products" && state && <Products state={state} />}
        {tab === "content" && state && <Content state={state} openAgent={setAgent} />}
        {tab === "plan" && <Plan />}
      </main>

      {agent && <AgentSheet profile={PROFILE[agent]} report={state?.agents[agent]} onClose={() => setAgent(null)} />}
      {settings && (
        <Settings
          pass={pass}
          url={url}
          onClose={() => setSettings(false)}
          onSave={(p, u) => {
            store.set("ecom.pass", p);
            store.set("ecom.url", u === DEFAULT_URL ? "" : u);
            setPass(p);
            setUrl(u || DEFAULT_URL);
            setSettings(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Status({ data, onUnlock, goPlan }: { data: Loaded | null; onUnlock: (p: string) => void; goPlan: () => void }) {
  const [p, setP] = useState("");
  if (!data) return <div className="card muted">Chargement…</div>;
  if (data.kind === "none")
    return (
      <div className="card">
        <h2>Les agents n'ont pas encore travaillé</h2>
        <p>Il faut d'abord leur donner les accès (5 minutes sur GitHub). Tout est expliqué étape par étape dans l'onglet Plan.</p>
        <button className="btn" onClick={goPlan}>Voir les étapes</button>
      </div>
    );
  if (data.kind === "error")
    return (
      <div className="card">
        <h2>Rapports injoignables</h2>
        <p className="muted">Raison : {data.message}. Nouvel essai automatique dans 5 minutes.</p>
      </div>
    );
  if (data.kind === "locked")
    return (
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          onUnlock(p.trim());
        }}
      >
        <h2>Ouvre les rapports</h2>
        <p>Les données de ta boutique sont chiffrées. Tape la phrase secrète que tu as mise dans le secret GitHub <code>ECOM_PASSPHRASE</code>. Dernier passage des agents : {ago(data.at)}.</p>
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="Phrase secrète" autoComplete="current-password" />
        <button className="btn" type="submit" disabled={p.trim().length < 8}>Ouvrir</button>
      </form>
    );
  return null;
}

function Progress({ state }: { state: EcomState }) {
  const k = state.kpis;
  const goal = k?.goal ?? cfg.goalNetMonthEur;
  const pace = k?.netMonthPace ?? 0;
  const pct = Math.max(0, Math.min(100, (pace / goal) * 100));
  return (
    <section className="card goal">
      <div className="goal-head">
        <span>Bénéfice net, rythme sur 30 jours</span>
        <span className="muted">objectif {eur(goal)} / mois</span>
      </div>
      <div className={`goal-num ${pace < 0 ? "neg" : ""}`}>{k ? eur(pace) : "—"}</div>
      <div className="bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {k ? (
        <div className="tiles">
          <Tile label="Commandes" value={String(k.orders)} />
          <Tile label="Chiffre d'affaires" value={eur(k.revenue)} />
          <Tile label="Panier moyen" value={eur(k.avgBasket, 2)} />
          <Tile label="ROAS minimum" value={k.breakEvenRoas ? `× ${k.breakEvenRoas.toLocaleString("fr-FR")}` : "—"} hint="Chaque euro de pub doit rapporter au moins autant de ventes, sinon tu perds de l'argent." />
          <Tile label="Ventes / jour pour l'objectif" value={k.ordersPerDayNeeded ? k.ordersPerDayNeeded.toLocaleString("fr-FR") : "—"} />
          <Tile label="En retard d'envoi" value={String(k.unfulfilledLate)} warn={k.unfulfilledLate > 0} />
        </div>
      ) : (
        <p className="muted small">Les chiffres arrivent dès que Shopify est connecté.</p>
      )}
      {k && (
        <details className="breakdown">
          <summary>Où part l'argent (30 jours)</summary>
          <dl>
            <dt>Ventes (hors remboursements)</dt><dd>{eur(k.revenue)}</dd>
            {k.revenueHt !== k.revenue && (<><dt>Ventes HT</dt><dd>{eur(k.revenueHt)}</dd></>)}
            <dt>Produits + livraison fournisseur{k.cogsEstimated ? " (en partie estimé)" : ""}</dt><dd>− {eur(k.cogs)}</dd>
            <dt>Frais de paiement</dt><dd>− {eur(k.fees)}</dd>
            <dt>Publicité</dt><dd>− {eur(k.adSpend)}</dd>
            <dt>Charges sociales micro-entreprise</dt><dd>− {eur(k.social)}</dd>
            <dt>Abonnements</dt><dd>− {eur(k.fixed)}</dd>
            <dt><strong>Bénéfice net estimé</strong></dt><dd><strong>{eur(k.net)}</strong></dd>
          </dl>
        </details>
      )}
    </section>
  );
}

function Tile({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className={`tile ${warn ? "warn" : ""}`} title={hint}>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

function Today({ state, openAgent }: { state: EcomState; openAgent: (id: AgentId) => void }) {
  const ceo = state.agents.ceo;
  const mine = useMemo(() => {
    const own = (ceo?.todo ?? []).filter((t) => t.who === "toi");
    if (own.length) return own;
    return ROSTER.flatMap((a) => state.agents[a.id]?.todo ?? []).filter((t) => t.who === "toi").sort((a, b) => a.priority - b.priority).slice(0, 5);
  }, [ceo, state]);
  return (
    <>
      <section className="card brief" onClick={() => openAgent("ceo")} role="button" tabIndex={0}>
        <div className="who">
          <Avatar p={PROFILE.ceo} />
          <div>
            <strong>Brief d'Adam</strong>
            <small>{ceo ? ago(ceo.at) : "pas encore écrit"}</small>
          </div>
        </div>
        <p>{ceo?.summary || ceo?.note || "Le directeur écrira ici le brief du jour."}</p>
      </section>

      <section className="card">
        <h3>Tes actions du jour</h3>
        {mine.length ? <Tasks tasks={mine} /> : <p className="muted">Rien pour toi aujourd'hui.</p>}
      </section>

      <Progress state={state} />

      <section className="card">
        <h3>L'équipe</h3>
        <div className="mini-team">
          {ROSTER.map((a) => (
            <button key={a.id} className="mini" onClick={() => openAgent(a.id)}>
              <Avatar p={a} />
              <span>{a.name}</span>
              <Dot r={state.agents[a.id]} />
            </button>
          ))}
        </div>
      </section>

      {state.log.length > 0 && (
        <section className="card">
          <h3>Journal</h3>
          <ul className="log">
            {state.log.slice(0, 12).map((l, i) => (
              <li key={i}>
                <small>{ago(l.at)}</small> {l.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Tasks({ tasks }: { tasks: Task[] }) {
  const [done, setDone] = useState<string[]>(() => {
    try {
      return JSON.parse(store.get("ecom.done") || "[]") as string[];
    } catch {
      return [];
    }
  });
  const toggle = (t: string) => {
    const next = done.includes(t) ? done.filter((x) => x !== t) : [...done, t].slice(-200);
    setDone(next);
    store.set("ecom.done", JSON.stringify(next));
  };
  return (
    <ul className="tasks">
      {tasks.map((t, i) => (
        <li key={i} className={done.includes(t.text) ? "done" : ""}>
          <label>
            <input type="checkbox" checked={done.includes(t.text)} onChange={() => toggle(t.text)} />
            <span>
              {t.text}
              <small>
                {PROFILE[t.agent]?.name ?? ""} · {t.priority === 1 ? "aujourd'hui" : t.priority === 2 ? "cette semaine" : "plus tard"}
              </small>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function Avatar({ p, big }: { p: AgentProfile; big?: boolean }) {
  return (
    <span className={`avatar ${big ? "big" : ""}`} style={{ background: p.color }} aria-hidden="true">
      {p.name[0]}
    </span>
  );
}

function Dot({ r }: { r?: AgentReport }) {
  const s = r?.status ?? "none";
  const label = s === "ok" ? "à jour" : s === "waiting" ? "en attente d'un accès" : s === "error" ? "en échec" : "pas encore passé";
  return <span className={`dot ${s}`} title={label} aria-label={label} />;
}

function Team({ state, openAgent }: { state: EcomState | null; openAgent: (id: AgentId) => void }) {
  return (
    <>
      <p className="lead">Dix agents, un poste chacun. Ils travaillent seuls chaque matin, dans cet ordre, et chacun lit les rapports des précédents. Ils proposent ; toi seul paies, publies et lances.</p>
      {ROSTER.map((a, i) => {
        const r = state?.agents[a.id];
        return (
          <button key={a.id} className="card agent" onClick={() => openAgent(a.id)}>
            <div className="who">
              <Avatar p={a} big />
              <div>
                <small className="muted">{String(i + 1).padStart(2, "0")} · {a.role}</small>
                <strong>{a.name}</strong>
              </div>
              <Dot r={r} />
            </div>
            <p>{r?.summary || r?.note || a.mission}</p>
            <div className="chips">
              {a.tools.map((t) => (
                <span key={t} className="chip">{t}</span>
              ))}
              <span className="chip">tous les {a.everyHours >= 48 ? `${Math.round(a.everyHours / 24)} j` : "jours"}</span>
            </div>
          </button>
        );
      })}
    </>
  );
}

function AgentSheet({ profile, report, onClose }: { profile: AgentProfile; report?: AgentReport; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={profile.name}>
        <div className="who">
          <Avatar p={profile} big />
          <div>
            <small className="muted">{profile.role}</small>
            <strong>{profile.name}</strong>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <p className="muted small">{profile.mission}</p>
        {report ? (
          <>
            <p className="small muted">
              Rapport {ago(report.at)}
              {report.model ? ` · ${report.model}` : ""}
            </p>
            {report.note && <p className={`note ${report.status}`}>{report.note}</p>}
            {report.summary && <p className="summary">{report.summary}</p>}
            {report.todo.length > 0 && (
              <>
                <h4>Tâches</h4>
                <Tasks tasks={report.todo} />
              </>
            )}
            {report.sections.map((s, i) => (
              <div key={i}>
                <h4>{s.title}</h4>
                <ul className="items">
                  {s.items.map((x, j) => (
                    <li key={j}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        ) : (
          <p className="note waiting">Pas encore de rapport : cet agent travaillera au prochain passage.</p>
        )}
      </div>
    </div>
  );
}

const STATUS_ORDER: ProductIdea["status"][] = ["en vente", "brouillon", "sourcé", "idée", "écarté"];

function Products({ state }: { state: EcomState }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = [...state.products].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.score - a.score);
  if (!list.length) return <div className="card muted">Yanis, le chasseur de produits, n'a encore rien proposé. Ses idées arrivent après son premier passage.</div>;
  return (
    <>
      <p className="lead">Le chemin d'un produit : idée (Yanis) → sourcé (Léa) → brouillon dans Shopify (Maxime) → en vente quand tu le publies.</p>
      {list.map((p) => (
        <article key={p.key} className={`card product ${p.status === "écarté" ? "faded" : ""}`}>
          <button className="product-head" onClick={() => setOpen(open === p.key ? null : p.key)} aria-expanded={open === p.key}>
            <span className={`score s${Math.floor(p.score / 25)}`}>{p.score}</span>
            <span className="grow">
              <strong>{p.name}</strong>
              <small>{p.problem}</small>
            </span>
            <span className={`chip st-${p.status.replace(/\s/g, "")}`}>{p.status}</span>
          </button>
          <div className="tiles three">
            <Tile label="Prix de vente" value={eur(p.priceEur, 2)} />
            <Tile label="Coût livré" value={eur(p.costEur, 2)} />
            <Tile label="Marge avant pub" value={eur(p.marginEur, 2)} warn={p.marginEur < 10} />
          </div>
          {open === p.key && (
            <div className="product-body">
              <p><b>Pourquoi maintenant :</b> {p.why}</p>
              <p><b>Angle :</b> {p.angle}</p>
              <p><b>ROAS minimum :</b> × {p.breakEvenRoas.toLocaleString("fr-FR")}</p>
              {p.risks.length > 0 && (
                <>
                  <h4>Risques</h4>
                  <ul className="items">{p.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </>
              )}
              {p.suppliers.length > 0 && (
                <>
                  <h4>Fournisseurs</h4>
                  <ul className="items">
                    {p.suppliers.map((s, i) => (
                      <li key={i}>
                        <b>{s.name}</b> : {eur(s.unitCostEur, 2)} + port {eur(s.shipEur, 2)}, {s.shipDays}. {s.note}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {p.listing && (
                <>
                  <h4>Fiche produit {p.shopifyId ? "(brouillon dans Shopify)" : "(prête, Shopify pas encore connecté)"}</h4>
                  <div className="listing">
                    <strong>{p.listing.title}</strong>
                    <div className="listing-html" dangerouslySetInnerHTML={{ __html: sanitize(p.listing.descriptionHtml) }} />
                  </div>
                </>
              )}
            </div>
          )}
        </article>
      ))}
    </>
  );
}

// The listing is written by the model from web research: keep only plain formatting tags.
function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set(["P", "UL", "OL", "LI", "STRONG", "B", "EM", "I", "H3", "H4", "BR"]);
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!allowed.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        walk(el);
        return;
      }
      for (const a of Array.from(child.attributes)) child.removeAttribute(a.name);
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

function Content({ state, openAgent }: { state: EcomState; openAgent: (id: AgentId) => void }) {
  return (
    <>
      <p className="lead">Les vidéos de la semaine écrites par Nathan. Tu les tournes au téléphone, sans montrer ton visage. Les campagnes payantes sont préparées par Sofia.</p>
      <button className="card agent" onClick={() => openAgent("ads")}>
        <div className="who">
          <Avatar p={PROFILE.ads} />
          <div>
            <small className="muted">Publicité</small>
            <strong>Le plan de Sofia</strong>
          </div>
        </div>
        <p>{state.agents.ads?.summary || state.agents.ads?.note || "Pas encore de plan."}</p>
      </button>
      {state.ads && <AdsTable ads={state.ads} />}
      {state.calendar.length ? (
        state.calendar.map((c, i) => (
          <article key={i} className="card post">
            <div className="post-head">
              <span className="day">{c.day}</span>
              <span className="chip">{c.platform}</span>
              <span className="chip">{c.format}</span>
            </div>
            <p className="hook">« {c.hook} »</p>
            <details>
              <summary>Script et légende</summary>
              <p className="pre">{c.script}</p>
              <p className="pre caption">{c.caption}</p>
              <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(c.caption).catch(() => undefined)}>Copier la légende</button>
            </details>
          </article>
        ))
      ) : (
        <div className="card muted">Le planning arrive après le premier passage de Nathan.</div>
      )}
    </>
  );
}

const VERDICT: Record<string, string> = { couper: "Couper", augmenter: "Augmenter", attendre: "Attendre" };

function AdsTable({ ads }: { ads: NonNullable<EcomState["ads"]> }) {
  return (
    <section className="card">
      <h3>Tes pubs, 7 derniers jours</h3>
      {ads.errors.map((e, i) => (
        <p key={i} className="note error">{e}</p>
      ))}
      {ads.platforms.map((p) => (
        <div key={p.name} className="ads">
          <div className="tiles three">
            <Tile label={`${p.name} · dépense`} value={eur(p.spend7)} />
            <Tile label="Achats" value={String(p.purchases7)} />
            <Tile label="ROAS" value={p.roas7 != null ? `× ${p.roas7.toLocaleString("fr-FR")}` : "—"} />
          </div>
          {p.ads.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Pub</th><th>Dépense</th><th>Achats</th><th>ROAS</th><th>Décision</th></tr>
                </thead>
                <tbody>
                  {p.ads.map((a, i) => (
                    <tr key={i}>
                      <td>{a.name}</td>
                      <td>{eur(a.spend)}</td>
                      <td>{a.purchases}</td>
                      <td>{a.roas != null ? `× ${a.roas.toLocaleString("fr-FR")}` : "—"}</td>
                      <td><span className={`chip v-${a.verdict ?? "attendre"}`}>{VERDICT[a.verdict ?? "attendre"]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      <p className="muted small">Décision calculée par le code à partir du ROAS minimum. Les agents ne touchent jamais à tes pubs : c'est toi qui coupes ou augmentes.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function Plan() {
  const [basket, setBasket] = useState(39);
  const [costPct, setCostPct] = useState(30);
  const [cpa, setCpa] = useState(12);
  const p = goalPlan(cfg.goalNetMonthEur, basket, costPct, cpa, cfg);
  return (
    <>
      <section className="card truth">
        <h2>D'abord, la vérité sur les 10 000 €</h2>
        <p>La vidéo que tu as vue est une publicité : voitures, billets et cartons servent à vendre une formation. Personne, ni moi ni ces agents, ne peut te garantir 10 000 € par mois. La plupart des boutiques de dropshipping ne dépassent jamais le stade du test. Celles qui y arrivent ont trouvé un produit gagnant après plusieurs échecs, et leur propriétaire y passe du temps chaque jour.</p>
        <p>Ce que l'équipe change : la recherche, les calculs, les textes, les fiches, les vidéos à tourner et le suivi sont faits pour toi chaque matin, avec des chiffres vrais. Tu gardes les décisions qui engagent ton argent.</p>
      </section>

      <section className="card">
        <h2>Ce que 10 000 € net demandent</h2>
        <label className="range">
          <span>Panier moyen <b>{eur(basket)}</b></span>
          <input type="range" min={15} max={120} value={basket} onChange={(e) => setBasket(+e.target.value)} />
        </label>
        <label className="range">
          <span>Coût du produit livré <b>{costPct} % du prix</b></span>
          <input type="range" min={10} max={60} value={costPct} onChange={(e) => setCostPct(+e.target.value)} />
        </label>
        <label className="range">
          <span>Pub dépensée par vente <b>{eur(cpa)}</b></span>
          <input type="range" min={0} max={40} value={cpa} onChange={(e) => setCpa(+e.target.value)} />
        </label>
        {p.ordersDay ? (
          <div className="tiles">
            <Tile label="Reste par commande" value={eur(p.perOrder, 2)} />
            <Tile label="Commandes par jour" value={String(p.ordersDay)} />
            <Tile label="Chiffre d'affaires / mois" value={eur(p.revenueMonth)} />
            <Tile label="Pub / mois" value={eur(p.adsMonth)} />
          </div>
        ) : (
          <p className="note error">Avec ces chiffres, chaque vente fait perdre {eur(-p.perOrder, 2)} : aucun volume n'y mènera. Il faut un prix plus haut, un produit moins cher ou une pub plus efficace.</p>
        )}
        <p className="muted small">Calcul complet : frais de paiement {cfg.paymentFeePct.toLocaleString("fr-FR")} % + {eur(cfg.paymentFeeFixedEur, 2)}, charges micro-entreprise {cfg.socialChargesPct.toLocaleString("fr-FR")} %, abonnements {cfg.fixedCostsMonthEur} € par mois{cfg.vatPct ? `, TVA ${cfg.vatPct} %` : ", sans TVA (franchise)"}.</p>
      </section>

      <section className="card">
        <h2>Un chemin réaliste</h2>
        <ol className="steps">
          <li><b>Semaines 1-2 · Mise en place.</b> Statut de micro-entreprise, boutique Shopify, pages légales (Hugo), accès des agents.</li>
          <li><b>Semaines 3-6 · Tests.</b> 3 à 5 produits testés avec 20 à 40 € de pub par jour chacun et des vidéos sans visage. On coupe vite ce qui ne vend pas. Ce mois-là, on perd souvent de l'argent : c'est le prix de l'information.</li>
          <li><b>Mois 2-4 · Premier gagnant.</b> Un produit vend au-dessus du ROAS minimum : on augmente la pub de 20 % par jour, on passe à un fournisseur avec entrepôt en Europe, on améliore la fiche.</li>
          <li><b>Mois 4-12 · Montée.</b> Si un produit tient, 1 000 puis 3 000 € net par mois sont des paliers réalistes ; 10 000 € demandent environ 25 à 45 ventes par jour, de la trésorerie et souvent une vraie marque.</li>
        </ol>
        <p className="muted small">Budget conseillé pour démarrer : 1 500 à 3 000 € (abonnement, échantillons, pub de test), que tu peux te permettre de perdre.</p>
      </section>

      <Setup />
    </>
  );
}

function Setup() {
  return (
    <section className="card">
      <h2>Mettre l'équipe au travail</h2>
      <ol className="steps">
        <li><b>Statut.</b> Déclare une micro-entreprise (activité « vente à distance ») sur <a href="https://autoentrepreneur.urssaf.fr" target="_blank" rel="noreferrer">autoentrepreneur.urssaf.fr</a>. C'est gratuit ; vendre sans statut est du travail dissimulé.</li>
        <li><b>Boutique.</b> Crée ta boutique sur Shopify (essai gratuit), sans la publier.</li>
        <li><b>Accès Shopify pour les agents.</b> Dans le <i>Dev Dashboard</i> de Shopify, crée une app, donne-lui les droits <code>read_products</code>, <code>write_products</code>, <code>read_orders</code>, <code>read_legal_policies</code>, installe-la sur ta boutique et note son <i>Client ID</i> et son <i>Client secret</i>.</li>
        <li><b>Clé Claude.</b> Crée une clé API sur <a href="https://platform.claude.com" target="_blank" rel="noreferrer">platform.claude.com</a> (compte avec quelques dollars de crédit : l'équipe coûte environ 10 à 30 $ par mois).</li>
        <li>
          <b>Secrets GitHub.</b> Sur <a href={`${REPO_URL}/settings/secrets/actions`} target="_blank" rel="noreferrer">la page des secrets du dépôt</a>, ajoute :
          <ul>
            <li><code>ECOM_PASSPHRASE</code> : une phrase secrète à toi (8 caractères ou plus) ;</li>
            <li><code>ANTHROPIC_API_KEY</code> : ta clé Claude ;</li>
            <li><code>SHOPIFY_STORE</code> : <i>ta-boutique.myshopify.com</i> ;</li>
            <li><code>SHOPIFY_CLIENT_ID</code> et <code>SHOPIFY_CLIENT_SECRET</code> (ou <code>SHOPIFY_TOKEN</code> si tu as déjà un jeton <i>shpat_</i>).</li>
          </ul>
        </li>
        <li><b>Premier passage.</b> Onglet <a href={`${REPO_URL}/actions/workflows/ecom-agents.yml`} target="_blank" rel="noreferrer">Actions › Boutique : les 10 agents</a> › <i>Run workflow</i>. Ensuite l'équipe travaille seule chaque matin vers 7 h.</li>
        <li>
          <b>Plus tard, pour aller plus loin (facultatif).</b> Ajoute ces secrets quand tu en es là :
          <ul>
            <li><code>CJ_API_KEY</code> : ta clé CJ Dropshipping (CJ › Authorization › API). Léa verra les vrais prix, le stock en Europe et le port ;</li>
            <li><code>META_ACCESS_TOKEN</code> et <code>META_AD_ACCOUNT_ID</code> : lecture de tes pubs Facebook / Instagram ;</li>
            <li><code>TIKTOK_ACCESS_TOKEN</code> et <code>TIKTOK_ADVERTISER_ID</code> : lecture de tes pubs TikTok.</li>
          </ul>
          Avec les pubs branchées, Sofia dit chaque jour quelle pub couper ou augmenter, et Camille compte ta vraie dépense pub.
        </li>
        <li><b>Ici.</b> Tape la même phrase secrète dans l'app : tu verras le brief, tes 3 actions du jour et les rapports.</li>
        <li><b>Piloter.</b> Dans <a href={`${REPO_URL}/edit/main/server/ecom/config.json`} target="_blank" rel="noreferrer">server/ecom/config.json</a>, indique ta niche, tes consignes et chaque semaine ta dépense pub réelle (<code>adSpendMonthEur</code>).</li>
      </ol>
      <p className="muted small">Ce que les agents ne feront jamais seuls : payer, publier un produit, lancer une pub, commander chez un fournisseur, répondre à un client. Ils créent des brouillons et te disent quoi faire.</p>
    </section>
  );
}

function Settings({ pass, url, onSave, onClose }: { pass: string; url: string; onSave: (p: string, u: string) => void; onClose: () => void }) {
  const [p, setP] = useState(pass);
  const [u, setU] = useState(url);
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(p.trim(), u.trim());
        }}
      >
        <div className="who">
          <strong className="grow">Réglages</strong>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <label className="field">
          <span>Phrase secrète (ECOM_PASSPHRASE)</span>
          <input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="field">
          <span>Adresse des rapports</span>
          <input value={u} onChange={(e) => setU(e.target.value)} />
        </label>
        <p className="muted small">La phrase reste sur ce téléphone. Les rapports sont chiffrés sur GitHub : sans elle, personne ne peut les lire.</p>
        <button className="btn" type="submit">Enregistrer</button>
      </form>
    </div>
  );
}
