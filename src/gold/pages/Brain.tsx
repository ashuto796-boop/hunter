import { useGold } from "../store";
import { MODULE_IDS, MODULE_INFO } from "../engine/modules";
import { REGIME_LABEL, learnedMult } from "../engine/brain";
import { time, tone } from "../ui/format";
import { Regime } from "../engine/types";

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

      <section className="card">
        <div className="card-title">
          <span>Les 7 spécialistes</span>
          <span className="num" style={{ textTransform: "none", letterSpacing: 0 }}>
            {training ? `${training.stats.n} trades d'expérience` : `${experience.toFixed(0)} pts d'expérience`}
          </span>
        </div>
        <p className="note" style={{ marginBottom: 4 }}>
          Chaque spécialiste vote. Leur poids dépend du régime de marché et de leurs propres résultats : ceux qui perdent sont écoutés de moins en moins.
        </p>
        <div>
          {MODULE_IDS.map((id) => {
            const info = MODULE_INFO[id];
            const s = brain[id];
            const w = learnedMult(s);
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
                  <span>poids ×{w.toFixed(2)}</span>
                  <span>
                    {s.n ? `${Math.max(1, Math.round(s.n))} trades · ${((s.wins / s.n) * 100).toFixed(0)} % · ` : "aucun trade · "}
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
