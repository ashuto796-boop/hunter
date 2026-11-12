// Real money: the Capital.com account the server copies the AI's trades onto. Its data is published
// sealed; the owner's secret code (kept on this phone only) opens it.
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useGold } from "../store";
import { LiveState, runGapMin } from "../engine/live";
import { unseal } from "../engine/seal";
import { computeStats } from "../engine/stats";
import { dateTime, price, time } from "../ui/format";

const REPO = "https://github.com/ashuto796-boop/hunter";
const PASS_KEY = "aurum.pass";

const loadPass = () => {
  try {
    return localStorage.getItem(PASS_KEY) ?? "";
  } catch {
    return "";
  }
};
const savePass = (p: string) => {
  try {
    if (p) localStorage.setItem(PASS_KEY, p);
    else localStorage.removeItem(PASS_KEY);
  } catch {
    /* private mode: kept for this session only */
  }
};

const money = (x: number, cur: string, sign = false) => {
  const s = Math.abs(x).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = cur === "EUR" ? "€" : cur === "USD" ? "$" : cur;
  return `${sign ? (x >= 0 ? "+" : "−") : x < 0 ? "−" : ""}${s} ${sym}`;
};
const toneOf = (x: number) => (x > 0 ? "up" : x < 0 ? "down" : "");

type Access = "absent" | "locked" | "wrong" | "opening" | "open" | "waiting";

function useRealAccount() {
  const live = useGold((s) => s.live);
  const [pass, setPassState] = useState(loadPass);
  const [state, setState] = useState<LiveState | null>(null);
  const [access, setAccess] = useState<Access>("absent");
  useEffect(() => {
    let alive = true;
    if (!live?.configured) setAccess("absent");
    else if (!live.sealed) setAccess("waiting");
    else if (!pass) setAccess("locked");
    else {
      setAccess("opening");
      unseal<LiveState>(live.sealed, pass).then((s) => {
        if (!alive) return;
        setState(s);
        setAccess(s ? "open" : "wrong");
      });
    }
    return () => {
      alive = false;
    };
  }, [live?.configured, live?.sealed, pass]);
  const setPass = (p: string) => {
    savePass(p);
    setPassState(p);
  };
  return { live, state: access === "open" ? state : null, access, setPass };
}

function Hero({ s, access }: { s: LiveState | null; access: Access }) {
  if (!s) {
    return (
      <section className="hero real-hero">
        <div className="hero-label">ARGENT RÉEL · CAPITAL.COM</div>
        <div className="real-title">{access === "absent" ? "Pas encore relié" : access === "waiting" ? "En attente du serveur" : "Compte verrouillé"}</div>
        <p className="muted" style={{ fontSize: 13.5 }}>
          {access === "absent"
            ? "L'IA trade pour l'instant sur son compte démo. Relie ton compte Capital.com (démo d'abord) : elle copiera chacun de ses trades, 24 h/24."
            : access === "waiting"
              ? "Le compte Capital.com est déclaré sur GitHub ; ses données apparaîtront ici après le prochain passage du serveur."
              : "Les données du compte sont chiffrées. Tape ton code secret pour les voir."}
        </p>
      </section>
    );
  }
  const day = s.nav - s.dayStartNav;
  const total = s.nav - s.startNav;
  const [int, cents] = s.nav.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(",");
  return (
    <section className="hero real-hero">
      <div className="hero-label">
        <span className={`env-badge ${s.env}`}>{s.env === "live" ? "ARGENT RÉEL" : "COMPTE DÉMO"}</span>
        {s.broker === "oanda" ? "OANDA" : "Capital.com"} · {s.currency}
      </div>
      <div className="hero-price num">
        {int}
        <span className="cents">
          ,{cents} {s.currency === "EUR" ? "€" : s.currency === "USD" ? "$" : s.currency}
        </span>
      </div>
      <div className="chips">
        <span className={`chip ${toneOf(day)}`}>
          <span className={`num ${toneOf(day)}`}>{money(day, s.currency, true)}</span>
          <span className="muted">aujourd'hui</span>
        </span>
        <span className={`chip ${toneOf(total)}`}>
          <span className={`num ${toneOf(total)}`}>{money(total, s.currency, true)}</span>
          <span className="muted">depuis le départ</span>
        </span>
        <span className={`chip ${s.status === "actif" ? "up" : s.status === "coupé" ? "down" : ""}`}>
          {s.status === "actif" ? "● Actif" : s.status === "coupé" ? "Coupé" : "En pause"}
        </span>
      </div>
      {s.reason && <p className="note" style={{ marginTop: 8 }}>Nouvelles entrées en pause : {s.reason}.</p>}
    </section>
  );
}

function PassCard({ access, onPass }: { access: Access; onPass: (p: string) => void }) {
  const [txt, setTxt] = useState("");
  return (
    <section className="card">
      <div className="card-title">Code secret</div>
      <form
        className="pass-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (txt.trim()) onPass(txt.trim());
        }}
      >
        <input className="input" type="password" autoComplete="current-password" placeholder="AURUM_PASSPHRASE" value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="Code secret" />
        <button className="btn gold" type="submit">
          Ouvrir
        </button>
      </form>
      <p className="note" style={{ marginTop: 10 }}>
        {access === "wrong" ? "Ce code n'ouvre pas les données : vérifie qu'il est identique au secret AURUM_PASSPHRASE sur GitHub. " : ""}
        Il reste sur ce téléphone et n'est jamais envoyé.
      </p>
    </section>
  );
}

function Positions({ s }: { s: LiveState }) {
  return (
    <section className="card">
      <div className="card-title">
        <span>Positions ouvertes</span>
        <span className="chip">{s.open.length}</span>
      </div>
      {s.open.length === 0 ? (
        <div className="empty">Aucune position réelle en ce moment.</div>
      ) : (
        <div className="list">
          {s.open.map((l) => (
            <div className="row" key={l.clientId}>
              <div className={`side-dot ${l.units > 0 ? "up" : "down"}`}>{l.units > 0 ? "A" : "V"}</div>
              <div className="row-main">
                <div className="row-title">
                  {l.units > 0 ? "Achat" : "Vente"} {Math.abs(l.units)} oz · {l.leg === "a" ? "objectif 1R" : "objectif final"}
                </div>
                <div className="row-sub num">
                  entrée {price(l.price)} · stop {l.sl ? price(l.sl) : "—"} · obj. {l.tp ? price(l.tp) : "—"}
                </div>
              </div>
              <div className={`row-right num ${toneOf(l.pl)}`}>{money(l.pl, s.currency, true)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const KIND_ICON: Record<string, string> = { ordre: "↗", clôture: "✓", stop: "⇡", ignoré: "·", erreur: "!", info: "i", coupure: "■" };

function Activity({ s }: { s: LiveState }) {
  const [all, setAll] = useState(false);
  const items = [...s.log].reverse();
  const shown = all ? items : items.slice(0, 8);
  return (
    <section className="card">
      <div className="card-title">
        <span>Activité du compte</span>
        <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>
          maj {time(s.updatedAt)}
        </span>
      </div>
      {shown.length === 0 ? (
        <div className="empty">Rien pour l'instant : l'IA attend un setup propre.</div>
      ) : (
        <div className="timeline">
          {shown.map((e, i) => (
            <div className={`tl-item ${e.kind}`} key={i}>
              <span className="tl-icon">{KIND_ICON[e.kind]}</span>
              <div>
                <div className="tl-text">{e.text}</div>
                <div className="tl-time">{dateTime(e.t)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {items.length > 8 && (
        <button className="btn block" style={{ marginTop: 10 }} onClick={() => setAll(!all)}>
          {all ? "Moins" : `Tout voir (${items.length})`}
        </button>
      )}
      {s.closed.length > 0 && (
        <>
          <div className="card-title" style={{ marginTop: 16 }}>
            Trades réels fermés
          </div>
          <div className="list">
            {s.closed.slice(0, 10).map((c) => (
              <div className="row" key={c.clientId}>
                <div className={`side-dot ${c.units > 0 ? "up" : "down"}`}>{c.units > 0 ? "A" : "V"}</div>
                <div className="row-main">
                  <div className="row-title num">
                    {Math.abs(c.units)} oz · {price(c.open)} → {c.close ? price(c.close) : "—"}
                  </div>
                  <div className="row-sub">{dateTime(c.t)}</div>
                </div>
                <div className={`row-right num ${toneOf(c.pl)}`}>{money(c.pl, s.currency, true)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Check({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className={`check ${ok ? "ok" : ""}`}>
      <span className="check-mark">{ok ? "✓" : ""}</span>
      <span className="check-label">{label}</span>
      <span className="check-val num">{value}</span>
    </div>
  );
}

// Advice before real money: evidence from the demo account and from the practice account
function Readiness({ s }: { s: LiveState | null }) {
  const trades = useGold((x) => x.trades);
  const trader = useGold((x) => x.trader);
  const remote = useGold((x) => x.remote);
  const fwd = useMemo(() => trades.filter((t) => !t.replay), [trades]);
  const st = useMemo(() => computeStats(fwd, trader.capital), [fwd, trader.capital]);
  const gap = s ? runGapMin(s.runTimes) : remote && remote.runs > 1 ? (remote.updatedAt - remote.startedAt) / 60000 / (remote.runs - 1) : null;
  const checks = [
    { ok: fwd.length >= 30, label: "30 trades de l'IA en démo, en direct", value: `${fwd.length}/30` },
    { ok: fwd.length >= 10 && st.pf >= 1.2, label: "Gains ≥ 1,2 × pertes", value: fwd.length ? (Number.isFinite(st.pf) ? st.pf.toFixed(2) : "∞") : "—" },
    { ok: fwd.length >= 10 && st.pnl > 0, label: "Résultat net positif", value: fwd.length ? `${st.netPct >= 0 ? "+" : ""}${(st.netPct * 100).toFixed(1)} %` : "—" },
    { ok: fwd.length >= 10 && st.maxDD < 0.08, label: "Pire repli sous 8 %", value: fwd.length ? `${(st.maxDD * 100).toFixed(1)} %` : "—" },
    { ok: gap !== null && gap <= 20, label: "Serveur toutes les 20 min", value: gap === null ? "—" : `${Math.round(gap)} min` },
  ];
  const done = checks.filter((c) => c.ok).length;
  return (
    <section className="card">
      <div className="card-title">
        <span>Indicateurs de confiance</span>
        <span className={`chip ${done === checks.length ? "up" : ""}`}>
          {done}/{checks.length}
        </span>
      </div>
      <div className="ready-bar" aria-hidden>
        <div style={{ width: `${(done / checks.length) * 100}%` }} />
      </div>
      <div className="checks">
        {checks.map((c) => (
          <Check key={c.label} {...c} />
        ))}
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        À titre indicatif, rien ne bloque l'argent réel : ces chiffres montrent ce que l'IA a prouvé jusqu'ici. Plus il y a de vert, plus ses résultats sont
        solides.
      </p>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="step">
      <div className="step-n">{n}</div>
      <div>
        <div className="step-title">{title}</div>
        <div className="step-body">{children}</div>
      </div>
    </div>
  );
}

function Setup({ open }: { open: boolean }) {
  return (
    <section className="card">
      <details open={open}>
        <summary className="card-title" style={{ marginBottom: 0, cursor: "pointer" }}>
          Relier un compte Capital.com
        </summary>
        <div className="steps">
          <Step n={1} title="Compte Capital.com">
            Sur capital.com, ouvre un compte (vérification d'identité). Un compte démo est fourni avec : commence par lui, sans argent réel.
          </Step>
          <Step n={2} title="Clé API">
            Active la double authentification (2FA), puis Paramètres → « Intégrations API » → génère une clé. Choisis un mot de passe propre à cette clé et note la
            clé : elle n'est affichée qu'une fois.
          </Step>
          <Step n={3} title="5 secrets sur GitHub">
            <span className="mono-list">CAPITAL_API_KEY · CAPITAL_IDENTIFIER · CAPITAL_PASSWORD · CAPITAL_ENV · AURUM_PASSPHRASE</span>
            L'identifiant est l'e-mail de connexion, le mot de passe est celui de la clé API. CAPITAL_ENV = demo pour le compte démo, live pour l'argent réel.
            AURUM_PASSPHRASE est un code secret à toi (8 caractères ou plus) : il chiffre les données du compte. Ne les envoie jamais dans une discussion.
            <a className="btn block" style={{ marginTop: 10 }} href={`${REPO}/settings/secrets/actions/new`} target="_blank" rel="noreferrer">
              Ajouter un secret sur GitHub
            </a>
          </Step>
          <Step n={4} title="Le même code ici">
            Tape ton code secret dans cette page : il reste sur le téléphone.
          </Step>
          <Step n={5} title="C'est parti">
            Au passage suivant du serveur (15 min au plus), le compte apparaît ici et l'IA copie ses trades, avec stop et objectif posés chez Capital.com. Petit
            compte accepté dès 100 € environ : elle prend alors la plus petite position permise. Arrêt pour la journée à −30 %, tout est coupé à −60 %. Elle ne
            touche jamais aux positions que tu ouvres toi-même.
          </Step>
        </div>
      </details>
    </section>
  );
}

function AiNow() {
  const p = useGold((s) => s.price);
  const d = useGold((s) => s.decision);
  return (
    <button className="card ai-now" onClick={() => useGold.setState({ tab: "live" })}>
      <div>
        <div className="kv-label">OR · XAU/USD</div>
        <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>
          {price(p)}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
        <div className="kv-label">L'IA en ce moment</div>
        <div className="ai-now-verdict">{d?.verdict ?? "—"}</div>
      </div>
      <span className="ai-now-arrow" aria-hidden>
        ›
      </span>
    </button>
  );
}

export function Real() {
  const { live, state, access, setPass } = useRealAccount();
  const remote = useGold((s) => s.remote);
  return (
    <div className="page">
      <Hero s={state} access={access} />
      {!remote && (
        <div className="banner warn">
          <span>⚠️</span>
          <span>Le trading réel passe par le serveur 24/7 : active-le dans Réglages.</span>
        </div>
      )}
      {live?.note && (
        <div className="banner warn">
          <span>⚠️</span>
          <span>{live.note}</span>
        </div>
      )}
      {(access === "locked" || access === "wrong") && <PassCard access={access} onPass={setPass} />}
      <AiNow />
      {state && <Positions s={state} />}
      {state && <Activity s={state} />}
      {access === "absent" && <Setup open />}
      <Readiness s={state} />
      {access !== "absent" && <Setup open={false} />}
      {state && (
        <button className="btn block" onClick={() => confirm("Oublier le code secret sur ce téléphone ?") && setPass("")}>
          Verrouiller (oublier le code sur ce téléphone)
        </button>
      )}
      <p className="disclaimer">
        Le trading de l'or avec effet de levier peut faire perdre plus vite qu'on ne le pense. L'IA applique des coupe-circuits (perte du jour, perte totale), mais aucun
        résultat passé ne garantit l'avenir.
      </p>
    </div>
  );
}
