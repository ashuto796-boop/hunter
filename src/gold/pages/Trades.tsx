import { useMemo, useState } from "react";
import { useGold } from "../store";
import { computeStats } from "../engine/stats";
import { MODULE_INFO } from "../engine/modules";
import { Trade } from "../engine/types";
import { EquityChart } from "../ui/EquityChart";
import { dateTime, lots, pct, price, rr, side, tone, usd } from "../ui/format";

const REASON: Record<Trade["reason"], string> = {
  SL: "Stop",
  TP2: "Objectif",
  BE: "Break-even",
  TRAIL: "Stop suiveur",
  TEMPS: "Coupé (temps)",
  WEEKEND: "Week-end",
  MANUEL: "Manuel",
};

export function TradeRow({ t }: { t: Trade }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 0 }}>
      <button style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", width: "100%" }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`side ${t.dir === 1 ? "long" : "short"}`}>{t.dir === 1 ? "A" : "V"}</span>
        <div className="row-main">
          <div className="row-title">
            {side(t.dir)} {lots(t.oz)}
            {t.replay && <span className="chip" style={{ marginLeft: 8, fontSize: 10, padding: "1px 7px" }}>rattrapage</span>}
          </div>
          <div className="row-sub num">
            {dateTime(t.openTime)} · {REASON[t.reason]}
          </div>
        </div>
        <div className="row-right">
          <div className={`row-title num ${tone(t.pnl)}`}>{usd(t.pnl, true)}</div>
          <div className={`row-sub num ${tone(t.r)}`}>{rr(t.r)}</div>
        </div>
      </button>
      {open && (
        <div style={{ paddingTop: 12 }}>
          <div className="grid3">
            <div>
              <div className="kv-label">Entrée</div>
              <div className="kv-val num">{price(t.entry)}</div>
            </div>
            <div>
              <div className="kv-label">Sortie moy.</div>
              <div className="kv-val num">{price(t.exit)}</div>
            </div>
            <div>
              <div className="kv-label">Stop initial</div>
              <div className="kv-val num">{price(t.sl0)}</div>
            </div>
          </div>
          <div className="note" style={{ marginTop: 10 }}>
            Score {t.score} · {MODULE_INFO[t.primary].name}
            {t.contributors.length > 1 && ` + ${t.contributors.filter((c) => c !== t.primary).map((c) => MODULE_INFO[c].name).join(", ")}`}
          </div>
          <ul className="reasons" style={{ marginTop: 10, paddingTop: 10 }}>
            {t.reasons.slice(0, 5).map((r, k) => (
              <li key={k}>
                <span className="ic pro">✓</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Trades() {
  const trades = useGold((s) => s.trades);
  const balance = useGold((s) => s.balance);
  const capital = useGold((s) => s.settings.capital);
  const start = useMemo(() => balance - trades.reduce((a, t) => a + t.pnl, 0), [balance, trades]);
  const stats = useMemo(() => computeStats(trades, start), [trades, start]);
  const curve = useMemo(() => {
    let v = start;
    const pts = [{ t: trades[0]?.openTime ?? Date.now(), v }];
    for (const t of trades) pts.push({ t: t.closeTime, v: (v += t.pnl) });
    return pts;
  }, [trades, start]);

  return (
    <div className="page">
      <section className="card">
        <div className="card-title">
          <span>Compte démo IA</span>
          <span className="num" style={{ textTransform: "none", letterSpacing: 0 }}>
            départ {capital.toLocaleString("fr-FR")} $
          </span>
        </div>
        <div className="pnl-big num">{balance.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $</div>
        <div className={`num ${tone(stats.pnl)}`} style={{ marginBottom: 12 }}>
          {usd(stats.pnl, true)} · {pct(start ? stats.pnl / start : 0)}
        </div>
        <EquityChart points={curve} height={150} />
      </section>
      <div className="grid3">
        <div className="stat">
          <div className="stat-label">Trades</div>
          <div className="stat-val num">{stats.n}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Réussite</div>
          <div className="stat-val num">{stats.n ? `${(stats.winRate * 100).toFixed(0)} %` : "—"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Total R</div>
          <div className={`stat-val num ${tone(stats.sumR)}`}>{stats.n ? rr(stats.sumR).replace("R", "") : "—"}</div>
        </div>
      </div>
      <section className="card">
        <div className="card-title">Journal de trading</div>
        {trades.length === 0 ? (
          <div className="empty">Aucun trade pour l'instant. Active le pilote automatique : l'IA entrera seule dès qu'un setup de qualité apparaît.</div>
        ) : (
          <div className="list">
            {trades
              .slice()
              .reverse()
              .map((t) => (
                <TradeRow t={t} key={t.id + t.openTime} />
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
