import { useEffect, useState } from "react";
import { useGold } from "../store";
import { bot } from "../bot";
import { Chart } from "../ui/Chart";
import { ScoreRing } from "../ui/ScoreRing";
import { IconBolt } from "../ui/Icons";
import { REGIME_LABEL } from "../engine/brain";
import { SESSION_LABEL } from "../engine/context";
import { MODULE_INFO } from "../engine/modules";
import { lots, pct, price, rr, side, time, tone, usd } from "../ui/format";
import { askNotifications } from "../device";

const MODE_LABEL = { auto: "Auto", prudent: "Prudent", equilibre: "Équilibré", agressif: "Agressif" } as const;

function Hero() {
  const p = useGold((s) => s.price);
  const open = useGold((s) => s.dayOpen);
  const d = useGold((s) => s.decision);
  const source = useGold((s) => s.source);
  const ch = open ? p / open - 1 : 0;
  const [int, cents] = price(p).split(",");
  return (
    <section className="hero">
      <div className="hero-label">
        OR · {source === "paxg" ? "PAXG/USDT" : source === "sim" ? "XAU/USD simulé" : "XAU/USD"}
      </div>
      <div className="hero-price num">
        {int}
        <span className="cents">,{cents ?? "00"}</span>
      </div>
      <div className="chips">
        <span className={`chip ${tone(ch)}`}>
          <span className={`num ${tone(ch)}`}>{pct(ch)}</span>
          <span className="muted">aujourd'hui</span>
        </span>
        {d && <span className="chip">{SESSION_LABEL[d.session]}</span>}
        {d?.killzone && <span className="chip gold">{d.killzone}</span>}
      </div>
    </section>
  );
}

const since = (t: number) => {
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  return min < 1 ? "à l'instant" : min < 90 ? `il y a ${min} min` : `il y a ${Math.round(min / 60)} h`;
};

// Server mode: the AI trades on GitHub every 15 minutes, phone on or off
function ServerCard() {
  const remote = useGold((s) => s.remote)!;
  const trader = useGold((s) => s.trader);
  const threshold = useGold((s) => s.threshold);
  useGold((s) => s.tickVersion); // refresh the "x min ago" label with the price stream
  const late = Date.now() - remote.updatedAt > 45 * 60000;
  return (
    <section className={`autopilot ${late ? "" : "on"}`}>
      <div className="autopilot-icon">
        <IconBolt width={22} height={22} />
      </div>
      <div className="autopilot-text">
        <div className="autopilot-title">Serveur 24/7 {late ? "en retard" : "actif"}</div>
        <div className="autopilot-sub">
          Dernier passage {since(remote.updatedAt)} · risque {trader.riskPct} % · {MODE_LABEL[trader.mode]}
          {trader.mode === "auto" && ` (seuil ${threshold})`}
        </div>
        {late && <div className="autopilot-sub gold">GitHub décale parfois ses passages : l'IA rattrapera toutes les bougies manquées au prochain.</div>}
        {remote.error && <div className="autopilot-sub">Lecture du serveur : {remote.error}</div>}
      </div>
      <span className={`dot ${late ? "warn" : "live"}`} />
    </section>
  );
}

function Autopilot() {
  const on = useGold((s) => s.autopilot);
  const st = useGold((s) => s.settings);
  const threshold = useGold((s) => s.threshold);
  const toggle = async () => {
    if (!on && st.notify) await askNotifications();
    bot.setAutopilot(!on);
  };
  return (
    <button className={`autopilot ${on ? "on" : ""}`} onClick={toggle} aria-pressed={on} style={{ textAlign: "left", width: "100%" }}>
      <div className="autopilot-icon">
        <IconBolt width={22} height={22} />
      </div>
      <div className="autopilot-text">
        <div className="autopilot-title">Pilote automatique {on ? "activé" : "coupé"}</div>
        <div className="autopilot-sub">
          {on ? "L'IA trade seule" : "L'IA analyse sans trader"} · risque {st.riskPct} % · {MODE_LABEL[st.mode]}
          {st.mode === "auto" && ` (seuil ${threshold})`}
        </div>
      </div>
      <div className={`switch ${on ? "on" : ""}`} />
    </button>
  );
}

function AiCard() {
  const d = useGold((s) => s.decision);
  if (!d) return null;
  const biasPos = 50 + d.bias * 50;
  return (
    <section className="card">
      <div className="card-title">
        <span>Cerveau IA</span>
        <span className="num" style={{ letterSpacing: 0, textTransform: "none" }}>
          analyse {time(d.t)}
        </span>
      </div>
      <div className="ai">
        <ScoreRing score={d.score} threshold={d.threshold} dir={d.dir} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ai-verdict">{d.verdict}</div>
          <div className="chips">
            <span className="chip">{REGIME_LABEL[d.regime]}</span>
            {d.dir !== 0 && (
              <span className={`chip ${d.dir === 1 ? "up" : "down"}`}>
                {d.dir === 1 ? "▲" : "▼"} {d.dir === 1 ? d.scoreLong : d.scoreShort}
              </span>
            )}
          </div>
        </div>
      </div>
      {d.memory && (
        <div className="memo">
          <span aria-hidden>🧠</span>
          <span>
            Déjà vu : {d.memory.n} situations proches, {(d.memory.win * 100).toFixed(0)} % gagnantes,{" "}
            <span className={`num ${tone(d.memory.expR)}`}>
              {d.memory.expR >= 0 ? "+" : ""}
              {d.memory.expR.toFixed(2)}R
            </span>{" "}
            <span className="muted">(indicatif)</span>
          </span>
        </div>
      )}
      <div className="bias" style={{ marginTop: 16 }}>
        <div className="kv-label" style={{ marginBottom: 8 }}>
          Biais de fond H1 / H4 : <span className={tone(d.bias)}>{d.bias >= 0 ? "haussier" : "baissier"} {Math.abs(d.bias * 100).toFixed(0)} %</span>
        </div>
        <div className="bias-track">
          <div className="bias-knob" style={{ left: `${biasPos}%` }} />
        </div>
        <div className="bias-labels">
          <span>Vendeur</span>
          <span>Neutre</span>
          <span>Acheteur</span>
        </div>
      </div>
      {(d.pros.length > 0 || d.cons.length > 0) && (
        <ul className="reasons">
          {d.pros.slice(0, 4).map((r, k) => (
            <li key={`p${k}`}>
              <span className="ic pro">✓</span>
              <span>{r}</span>
            </li>
          ))}
          {d.cons.slice(0, 3).map((r, k) => (
            <li key={`c${k}`}>
              <span className="ic con">!</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PositionCard() {
  const remote = useGold((s) => s.remote);
  const p = useGold((s) => s.position);
  const pnl = useGold((s) => s.unrealized);
  const px = useGold((s) => s.price);
  if (!p) {
    return (
      <section className="card">
        <div className="card-title">Position</div>
        <div className="empty" style={{ padding: "4px 0" }}>
          Aucune position ouverte. L'IA attend un setup de qualité — elle ne force jamais un trade.
        </div>
      </section>
    );
  }
  const risk = Math.abs(p.entry - p.sl0);
  const r = pnl / p.riskAmt;
  const lo = Math.min(p.sl0, p.tp2);
  const hi = Math.max(p.sl0, p.tp2);
  const at = (x: number) => `${Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100))}%`;
  const long = p.dir === 1;
  const mirror = (x: string) => (long ? x : `${100 - parseFloat(x)}%`);
  return (
    <section className="card" style={{ borderColor: pnl >= 0 ? "rgba(47,214,155,0.25)" : "rgba(255,90,110,0.25)" }}>
      <div className="pos-head">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={`side ${long ? "long" : "short"}`}>{side(p.dir)}</span>
          <span className="num">{lots(p.oz)}</span>
          {p.tp1Done && <span className="chip gold">TP1 encaissé</span>}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          depuis {time(p.openTime)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span className={`pnl-big num ${tone(pnl)}`}>{usd(pnl, true)}</span>
        <span className={`num ${tone(r)}`}>{rr(r)}</span>
      </div>
      <div className="progress" aria-hidden>
        <div className="progress-mark entry" style={{ left: mirror(at(p.entry)) }} />
        {!p.tp1Done && <div className="progress-mark tp1" style={{ left: mirror(at(p.tp1)) }} />}
        <div className="progress-knob" style={{ left: mirror(at(px)), background: pnl >= 0 ? "var(--up)" : "var(--down)" }} />
      </div>
      <div className="progress-legend">
        <span>Stop {price(p.sl)}</span>
        <span>Objectif {price(p.tp2)}</span>
      </div>
      <div className="grid3" style={{ marginTop: 14 }}>
        <div>
          <div className="kv-label">Entrée</div>
          <div className="kv-val num">{price(p.entry)}</div>
        </div>
        <div>
          <div className="kv-label">Risque</div>
          <div className="kv-val num">{usd(p.riskAmt)}</div>
        </div>
        <div>
          <div className="kv-label">Stop ($/oz)</div>
          <div className="kv-val num">{risk.toFixed(2)}</div>
        </div>
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Module principal : <span className="gold">{MODULE_INFO[p.primary].name}</span> · score {p.score}
      </div>
      {remote ? (
        <p className="note" style={{ marginTop: 10 }}>
          Gérée par le serveur 24/7 : stop, prise de profit et stop suiveur s'appliquent même téléphone éteint.
        </p>
      ) : (
        <button className="btn danger block" style={{ marginTop: 14 }} onClick={() => confirm("Clôturer la position maintenant ?") && bot.closeNow()}>
          Clôturer maintenant
        </button>
      )}
    </section>
  );
}

function TodayStats() {
  const day = useGold((s) => s.day);
  const equity = useGold((s) => s.equity);
  const max = useGold((s) => s.trader.maxTradesDay);
  return (
    <div className="grid3">
      <div className="stat">
        <div className="stat-label">Capital</div>
        <div className="stat-val num">{equity.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} $</div>
      </div>
      <div className="stat">
        <div className="stat-label">P&L du jour</div>
        <div className={`stat-val num ${tone(day.pnl)}`}>{usd(day.pnl, true).replace(",00", "")}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Trades jour</div>
        <div className="stat-val num">
          {day.trades}
          <span className="muted">/{max}</span>
        </div>
      </div>
    </div>
  );
}

// Mobile browsers only keep the trader alive in an installed app with the screen on
function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("aurum.installHint") === "0";
    } catch {
      return false;
    }
  });
  const [prompt, setPrompt] = useState<(Event & { prompt(): Promise<void> }) | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setPrompt(e as Event & { prompt(): Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  if (hidden || standalone) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem("aurum.installHint", "0");
    } catch {
      /* private mode */
    }
  };
  return (
    <div className="banner warn" style={{ alignItems: "center" }}>
      <span style={{ fontSize: 20 }}>📲</span>
      <span style={{ flex: 1 }}>
        {ios ? (
          <>
            Installe AURUM : touche <b>Partager</b> puis <b>Sur l'écran d'accueil</b>. Notifications et plein écran en plus.
          </>
        ) : (
          <>Installe AURUM sur ton téléphone pour l'ouvrir comme une vraie app, avec les notifications.</>
        )}
      </span>
      {prompt && (
        <button className="btn gold" style={{ padding: "8px 12px" }} onClick={() => prompt.prompt().then(close)}>
          Installer
        </button>
      )}
      <button aria-label="Masquer" onClick={close} className="muted" style={{ padding: 4, fontSize: 18 }}>
        ×
      </button>
    </div>
  );
}

export function Live() {
  const source = useGold((s) => s.source);
  const tf = useGold((s) => s.trader.tf);
  const remote = useGold((s) => s.remote);
  const serverNote = useGold((s) => s.serverNote);
  return (
    <div className="page">
      <Hero />
      <InstallHint />
      {source === "sim" && (
        <div className="banner">
          <span>ℹ️</span>
          <span>Le flux de prix réel n'est pas joignable depuis ce réseau : l'IA tourne sur un marché simulé. Elle repassera sur l'or réel au prochain lancement si la connexion le permet.</span>
        </div>
      )}
      {serverNote && (
        <div className="banner warn">
          <span>⚠️</span>
          <span>{serverNote}</span>
        </div>
      )}
      {remote ? <ServerCard /> : <Autopilot />}
      <AiCard />
      <PositionCard />
      <section className="card chart-card">
        <div className="card-title">
          <span>Graphique M{tf}</span>
          <span className="legend">
            <span>
              <i style={{ background: "#e8c26a" }} />
              EMA 20
            </span>
            <span>
              <i style={{ background: "rgba(122,167,255,0.7)" }} />
              EMA 50
            </span>
          </span>
        </div>
        <Chart />
      </section>
      <TodayStats />
      <p className="note">
        Compte de démonstration avec prix réels : aucun argent réel n'est engagé. Le trading de l'or comporte un risque élevé de perte.
      </p>
    </div>
  );
}
