import { useState } from "react";
import { useGold } from "../store";
import { bot } from "../bot";
import { MODULE_IDS, MODULE_INFO } from "../engine/modules";
import { EquityChart } from "../ui/EquityChart";
import { TradeRow } from "./Trades";
import { dateTime, pct, rr, tone, usd } from "../ui/format";

export function Lab() {
  const tr = useGold((s) => s.training);
  const days = useGold((s) => s.settings.trainDays);
  const capital = useGold((s) => s.settings.capital);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const rerun = (d?: number) => {
    setBusy(true);
    setTimeout(() => {
      if (d && d !== days) bot.updateSettings({ trainDays: d });
      else bot.retrain();
      setBusy(false);
    }, 30);
  };

  if (!tr) return <div className="page"><div className="empty">Entraînement en cours…</div></div>;
  const s = tr.stats;
  const pf = Number.isFinite(s.pf) ? s.pf.toFixed(2) : "∞";

  return (
    <div className="page">
      <section className="card">
        <div className="card-title">
          <span>Entraînement / backtest</span>
          <span className="chip">{tr.source === "sim" ? "données simulées" : tr.source === "paxg" ? "PAXG réel" : "XAU réel"}</span>
        </div>
        <p style={{ fontSize: 14, marginBottom: 12 }}>
          L'IA a revécu <b>{tr.days.toFixed(0)} jours</b> d'or bougie par bougie ({tr.candles.toLocaleString("fr-FR")} bougies), sans jamais voir le futur, avec spread et glissement inclus.
        </p>
        <div className={`pnl-big num ${tone(s.pnl)}`}>{pct(s.netPct, true, 1)}</div>
        <div className="muted num" style={{ fontSize: 13, marginBottom: 12 }}>
          {usd(s.pnl, true)} sur {capital.toLocaleString("fr-FR")} $ · {dateTime(tr.from)} → {dateTime(tr.to)}
        </div>
        <EquityChart points={tr.curve} />
      </section>

      <div className="grid3">
        <div className="stat">
          <div className="stat-label">Trades</div>
          <div className="stat-val num">{s.n}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Réussite</div>
          <div className="stat-val num">{(s.winRate * 100).toFixed(0)} %</div>
        </div>
        <div className="stat">
          <div className="stat-label">Profit factor</div>
          <div className={`stat-val num ${s.pf >= 1 ? "up" : "down"}`}>{pf}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Drawdown max</div>
          <div className="stat-val num down">{(s.maxDD * 100).toFixed(1)} %</div>
        </div>
        <div className="stat">
          <div className="stat-label">Moy. / trade</div>
          <div className={`stat-val num ${tone(s.avgR)}`}>{rr(s.avgR)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Gain/perte (R)</div>
          <div className="stat-val num" style={{ fontSize: 15 }}>
            <span className="up">{s.avgWinR.toFixed(1)}</span>
            <span className="muted"> / </span>
            <span className="down">{s.avgLossR.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-title">Performance par spécialiste</div>
        <div className="list">
          {MODULE_IDS.filter((id) => s.perModule[id].n > 0)
            .sort((a, b) => s.perModule[b].pnl - s.perModule[a].pnl)
            .map((id) => {
              const p = s.perModule[id];
              return (
                <div className="row" key={id}>
                  <div className="row-main">
                    <div className="row-title">{MODULE_INFO[id].name}</div>
                    <div className="row-sub num">
                      {p.n} trades · {(p.winRate * 100).toFixed(0)} % réussite
                    </div>
                  </div>
                  <div className="row-right">
                    <div className={`row-title num ${tone(p.pnl)}`}>{usd(p.pnl, true)}</div>
                    <div className={`row-sub num ${tone(p.avgR)}`}>{rr(p.avgR)} moy.</div>
                  </div>
                </div>
              );
            })}
          {s.n === 0 && <div className="empty">Aucun trade sur la période : les conditions n'ont jamais été assez bonnes.</div>}
        </div>
      </section>

      <section className="card">
        <div className="card-title">Relancer l'entraînement</div>
        <div className="seg" style={{ marginBottom: 12 }}>
          {[30, 60, 90, 180].map((d) => (
            <button key={d} className={d === days ? "on" : ""} onClick={() => rerun(d)} disabled={busy}>
              {d} jours
            </button>
          ))}
        </div>
        <button className="btn gold block" onClick={() => rerun()} disabled={busy}>
          {busy ? "Entraînement…" : "Ré-entraîner l'IA maintenant"}
        </button>
        <p className="note" style={{ marginTop: 10 }}>
          Plus de jours = plus d'expérience mais un marché plus ancien. Un changement de durée recharge l'historique.
        </p>
      </section>

      {tr.trades.length > 0 && (
        <section className="card">
          <div className="card-title">Trades simulés</div>
          <div className="list">
            {(showAll ? tr.trades : tr.trades.slice(0, 15)).map((t) => (
              <TradeRow t={t} key={`bt${t.id}`} />
            ))}
          </div>
          {tr.trades.length > 15 && (
            <button className="btn block" style={{ marginTop: 10 }} onClick={() => setShowAll(!showAll)}>
              {showAll ? "Réduire" : `Voir les ${tr.trades.length} trades`}
            </button>
          )}
        </section>
      )}

      <p className="note">
        Les résultats passés, même simulés honnêtement, ne garantissent pas les résultats futurs. Laisse tourner l'IA plusieurs semaines en démo avant d'envisager de l'argent réel.
      </p>
    </div>
  );
}
