import { useMemo, useState } from "react";
import { useGold } from "../store";
import { bot } from "../bot";
import { MODULE_IDS, MODULE_INFO } from "../engine/modules";
import { EquityChart } from "../ui/EquityChart";
import { TradeRow } from "./Trades";
import { dateTime, pct, rr, tone, usd } from "../ui/format";
import { Session, Trade } from "../engine/types";
import { SESSION_LABEL } from "../engine/context";
import { monteCarlo, rSummary } from "../engine/stats";

function MonteCarloCard({ trades, capital }: { trades: Trade[]; capital: number }) {
  const mc = useMemo(() => {
    const chrono = [...trades].sort((a, b) => a.closeTime - b.closeTime);
    if (chrono.length < 10) return null;
    const days = (chrono[chrono.length - 1].closeTime - chrono[0].openTime) / 864e5;
    return monteCarlo(chrono, capital, days);
  }, [trades, capital]);
  if (!mc) return null;
  const max = Math.max(...mc.bins.map((b) => b.count));
  const lo = mc.bins[0].from;
  const hi = mc.bins[mc.bins.length - 1].to;
  const x = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  return (
    <section className="card">
      <div className="card-title">
        <span>Monte-Carlo 30 j</span>
        <span className="num" style={{ textTransform: "none", letterSpacing: 0 }}>
          ≈ {mc.tradesPerRun} trades
        </span>
      </div>
      <div className="mc">
        {mc.bins.map((b, k) => (
          <div
            key={k}
            className="mc-bar"
            style={{ height: `${(b.count / max) * 100}%`, background: (b.from + b.to) / 2 >= 0 ? "var(--up)" : "var(--down)" }}
          />
        ))}
        {[mc.p5, mc.median, mc.p95].map((v, k) => (
          <div key={k} className={`mc-mark ${k === 1 ? "mid" : ""}`} style={{ left: x(v) }} />
        ))}
      </div>
      <div className="progress-legend num" style={{ marginTop: 6 }}>
        <span>{pct(lo, true, 1)}</span>
        <span>0 %</span>
        <span>{pct(hi, true, 1)}</span>
      </div>
      <div className="grid2" style={{ marginTop: 14 }}>
        <div>
          <div className="kv-label">Résultat médian</div>
          <div className={`kv-val num ${tone(mc.median)}`}>{pct(mc.median, true, 1)}</div>
        </div>
        <div>
          <div className="kv-label">9 cas sur 10 entre</div>
          <div className="kv-val num">
            {pct(mc.p5, true, 1)} et {pct(mc.p95, true, 1)}
          </div>
        </div>
        <div>
          <div className="kv-label">Chance de finir positif</div>
          <div className="kv-val num">{(mc.probProfit * 100).toFixed(0)} %</div>
        </div>
        <div>
          <div className="kv-label">Risque d'un creux de −10 %</div>
          <div className={`kv-val num ${mc.probDD10 > 0.1 ? "down" : ""}`}>{(mc.probDD10 * 100).toFixed(0)} %</div>
        </div>
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        2 000 futurs possibles, en tirant au hasard parmi les trades simulés : on voit l'éventail des issues, pas une seule courbe chanceuse. Ça suppose que le marché à venir ressemble au passé.
      </p>
    </section>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;

const SESSIONS: Session[] = ["ASIE", "LONDRES", "OVERLAP", "NEW_YORK"];

function SessionStats({ trades }: { trades: Trade[] }) {
  const rows = SESSIONS.map((sess) => ({ sess, ...rSummary(trades.filter((t) => t.session === sess)) })).filter((r) => r.n > 0);
  if (!rows.length) return null;
  return (
    <section className="card">
      <div className="card-title">Performance par session</div>
      <div className="list">
        {rows.map((r) => (
          <div className="row" key={r.sess}>
            <div className="row-main">
              <div className="row-title">{SESSION_LABEL[r.sess]}</div>
              <div className="row-sub num">
                {plural(r.n, "trade")} · {(r.winRate * 100).toFixed(0)} % réussite
              </div>
            </div>
            <div className={`row-title num ${tone(r.sumR)}`}>{rr(r.sumR)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Lab() {
  const tr = useGold((s) => s.training);
  const days = useGold((s) => s.settings.trainDays);
  const capital = useGold((s) => s.trader.capital);
  const remote = useGold((s) => s.remote);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const rerun = async (d?: number) => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    if (d && d !== days) bot.updateSettings({ trainDays: d });
    else await bot.retrain();
    setBusy(false);
  };

  if (!tr)
    return (
      <div className="page">
        <div className="empty">Entraînement en cours…</div>
      </div>
    );
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
          L'IA a revécu <b>{tr.days.toFixed(0)} jours</b> d'or bougie par bougie ({tr.candles.toLocaleString("fr-FR")} bougies), sans jamais voir le futur, avec
          spread et glissement inclus.
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

      {tr.calibration && (
        <section className="card">
          <div className="card-title">
            <span>Calibration auto</span>
            <span className="chip gold">seuil {tr.calibration.chosen}</span>
          </div>
          <p className="note" style={{ marginBottom: 10 }}>
            Choix du seuil sur la période d'apprentissage (avant le {dateTime(tr.calibration.splitT)}), puis contrôle sur la période de validation, jamais
            utilisée pour choisir.
          </p>
          <div className="calib calib-head">
            <span>Seuil</span>
            <span>Apprentissage</span>
            <span>Validation</span>
          </div>
          {tr.calibration.rows.map((r) => (
            <div className={`calib num ${r.th === tr.calibration!.chosen ? "chosen" : ""}`} key={r.th}>
              <span>{r.th}</span>
              <span>
                <span className={tone(r.learnR)}>{rr(r.learnR)}</span> <span className="muted">· {r.learnN}</span>
              </span>
              <span>
                <span className={tone(r.valR)}>{rr(r.valR)}</span> <span className="muted">· {r.valN}</span>
              </span>
            </div>
          ))}
          {(() => {
            const row = tr.calibration.rows.find((r) => r.th === tr.calibration!.chosen);
            if (!row) return null;
            if (row.valN < 10)
              return (
                <div className="banner" style={{ marginTop: 12 }}>
                  <span>ℹ️</span>
                  <span>
                    Seulement {plural(row.valN, "trade")} en validation : trop peu pour conclure ({rr(row.valR)}). Laisse tourner l'IA en démo ou entraîne-la
                    sur plus de jours.
                  </span>
                </div>
              );
            return row.valR > 0 ? (
              <div className="banner" style={{ marginTop: 12 }}>
                <span>✅</span>
                <span>
                  Validation positive : {rr(row.valR)} sur {row.valN} trades jamais vus pendant la calibration ({(row.valWin * 100).toFixed(0)} % de réussite).
                </span>
              </div>
            ) : (
              <div className="banner warn" style={{ marginTop: 12 }}>
                <span>⚠️</span>
                <span>
                  Validation non concluante ({rr(row.valR)} sur {row.valN} trades) : l'avantage n'est pas confirmé sur la période récente. Reste en démo.
                </span>
              </div>
            );
          })()}
        </section>
      )}

      <MonteCarloCard trades={tr.trades} capital={capital} />

      <SessionStats trades={tr.trades} />

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
                      {plural(p.n, "trade")} · {(p.winRate * 100).toFixed(0)} % réussite
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

      {remote ? (
        <section className="card">
          <div className="card-title">Entraînement du serveur</div>
          <p style={{ fontSize: 14 }}>
            Le serveur 24/7 se ré-entraîne seul environ une fois par jour sur les {tr.days.toFixed(0)} derniers jours. Dernier entraînement : {dateTime(tr.at)}.
          </p>
        </section>
      ) : (
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
      )}

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
        Les résultats passés, même simulés honnêtement, ne garantissent pas les résultats futurs. Laisse tourner l'IA plusieurs semaines en démo avant
        d'envisager de l'argent réel.
      </p>
    </div>
  );
}
