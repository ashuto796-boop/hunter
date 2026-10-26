import { useGold } from "../store";
import { MODULE_IDS, MODULE_INFO } from "../engine/modules";
import { REGIME_LABEL, contextMult, learnedMult } from "../engine/brain";
import { time, tone } from "../ui/format";
import { Intermarket, Regime } from "../engine/types";

function peerText(v: number | null, up: string, down: string) {
  if (v === null) return { text: "indisponible", cls: "muted" };
  if (Math.abs(v) < 0.25) return { text: "neutre", cls: "muted" };
  return v > 0 ? { text: up, cls: "up" } : { text: down, cls: "down" };
}

function Radar({ im }: { im: Intermarket | null }) {
  const silver = peerText(im?.silver ?? null, "haussier", "baissier");
  const usd = peerText(im?.usd ?? null, "dollar faible", "dollar fort");
  const total = peerText(im?.score ?? null, "favorable à l'or", "défavorable à l'or");
  return (
    <section className="card">
      <div className="card-title">Radar intermarché (H1)</div>
      {!im ? (
        <div className="empty" style={{ padding: "4px 0" }}>
          Données intermarché indisponibles : le radar reste neutre et n'influence pas les décisions.
        </div>
      ) : (
        <>
          <div className="peer">
            <div>
              <div className="row-title">Argent (XAG)</div>
              <div className="row-sub">Le métal jumeau : il doit confirmer</div>
            </div>
            <span className={`chip ${silver.cls}`}>{silver.text}</span>
          </div>
          <div className="peer">
            <div>
              <div className="row-title">Dollar (via EUR/USD)</div>
              <div className="row-sub">Un dollar faible pousse l'or</div>
            </div>
            <span className={`chip ${usd.cls}`}>{usd.text}</span>
          </div>
          <div className="peer">
            <div className="row-title">Verdict pour l'or</div>
            <span className={`chip ${total.cls}`}>
              {total.text} {im.score >= 0 ? "+" : ""}
              {(im.score * 100).toFixed(0)}
            </span>
          </div>
          <p className="note" style={{ marginTop: 8 }}>
            Ajuste la confiance de ±8 % au maximum : une confirmation, jamais un déclencheur.
          </p>
        </>
      )}
    </section>
  );
}

const REGIME_HELP: Record<Regime, string> = {
  TREND_UP: "Le marché monte proprement : je privilégie les replis et le momentum à l'achat, je me méfie des ventes.",
  TREND_DOWN: "Le marché baisse proprement : je privilégie les replis et le momentum à la vente, je me méfie des achats.",
  RANGE: "Pas de direction claire : je chasse les faux mouvements aux extrêmes et les retours à la moyenne.",
  SQUEEZE: "La volatilité est comprimée : une explosion se prépare, je guette la cassure acceptée.",
  VOLATILE: "Volatilité extrême : je réduis fortement mon exposition, les mèches sont imprévisibles.",
};

export function Brain() {
  const d = useGold((s) => s.decision);
  const brain = useGold((s) => s.brain);
  const ctx = useGold((s) => s.ctx);
  const thoughts = useGold((s) => s.thoughts);
  const training = useGold((s) => s.training);
  const experience = MODULE_IDS.reduce((a, id) => a + brain[id].n, 0);

  return (
    <div className="page">
      <section className="card">
        <div className="card-title">
          <span>État du marché</span>
          {d && <span className="chip gold">{REGIME_LABEL[d.regime]}</span>}
        </div>
        <p style={{ fontSize: 14 }}>{d ? REGIME_HELP[d.regime] : "Analyse en cours…"}</p>
        {d && (
          <div className="grid3" style={{ marginTop: 14 }}>
            <div>
              <div className="kv-label">Score achat</div>
              <div className="kv-val num up">{d.scoreLong}</div>
            </div>
            <div>
              <div className="kv-label">Score vente</div>
              <div className="kv-val num down">{d.scoreShort}</div>
            </div>
            <div>
              <div className="kv-label">Biais H1/H4</div>
              <div className={`kv-val num ${tone(d.bias)}`}>
                {d.bias >= 0 ? "+" : ""}
                {(d.bias * 100).toFixed(0)} %
              </div>
            </div>
          </div>
        )}
      </section>

      <Radar im={d?.intermarket ?? null} />

      <section className="card">
        <div className="card-title">
          <span>Les 7 spécialistes</span>
          <span className="num" style={{ textTransform: "none", letterSpacing: 0 }}>
            {training ? `${training.stats.n} trades d'expérience` : `${experience.toFixed(0)} pts d'expérience`}
          </span>
        </div>
        <p className="note" style={{ marginBottom: 4 }}>
          Chaque spécialiste vote. Son poids dépend du régime de marché et de ses propres résultats dans ce régime : celui qui perd en range mais gagne en tendance n'est écouté qu'en tendance.
        </p>
        <div>
          {MODULE_IDS.map((id) => {
            const info = MODULE_INFO[id];
            const s = brain[id];
            const w = d ? contextMult(brain, ctx, id, d.regime) : learnedMult(s);
            const vote = d?.votes.filter((v) => v.id === id).sort((a, b) => b.weight - a.weight)[0];
            const avgR = s.n ? s.sumR / s.n : 0;
            return (
              <div className="module" key={id}>
                <div className="module-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="row-title">{info.name}</div>
                    <div className="row-sub">{info.style}</div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    {vote ? (
                      <span className={`chip ${vote.dir === 1 ? "up" : "down"}`}>
                        {vote.dir === 1 ? "▲ Achat" : "▼ Vente"} {Math.round(vote.strength * 100)}
                      </span>
                    ) : (
                      <span className="chip muted">—</span>
                    )}
                  </div>
                </div>
                <div className="bar" title="Poids appris">
                  <div style={{ width: `${(w / 1.6) * 100}%` }} />
                </div>
                <div className="row-sub num" style={{ marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                  <span>
                    poids ×{w.toFixed(2)}
                    {d && <span className="muted"> en {REGIME_LABEL[d.regime].toLowerCase()}</span>}
                  </span>
                  <span>
                    {s.n ? `${Math.max(1, Math.round(s.n))} trade${Math.round(s.n) > 1 ? "s" : ""} · ${((s.wins / s.n) * 100).toFixed(0)} % · ` : "aucun trade · "}
                    <span className={tone(avgR)}>
                      {avgR >= 0 ? "+" : ""}
                      {avgR.toFixed(2)}R moy.
                    </span>
                  </span>
                </div>
                {vote && (
                  <ul className="reasons" style={{ marginTop: 10, paddingTop: 10 }}>
                    {vote.reasons.slice(0, 3).map((r, k) => (
                      <li key={k}>
                        <span className="ic pro">›</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-title">Monologue intérieur</div>
        {thoughts.length === 0 && <div className="empty">L'IA n'a encore rien dit.</div>}
        <div>
          {thoughts
            .slice()
            .reverse()
            .slice(0, 60)
            .map((t, k) => (
              <div className={`thought ${t.kind}`} key={`${t.t}-${k}`}>
                <div className="thought-time num">{time(t.t)}</div>
                <div className={`thought-dot ${t.kind}`} />
                <div className="thought-text">{t.text}</div>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
