import { useEffect } from "react";
import { Tab, useGold } from "./store";
import { bot } from "./bot";
import { SOURCES } from "./data/feed";
import { Live } from "./pages/Live";
import { Brain } from "./pages/Brain";
import { Trades } from "./pages/Trades";
import { Lab } from "./pages/Lab";
import { SettingsPage } from "./pages/SettingsPage";
import { IconBrain, IconJournal, IconLab, IconLive, IconSettings, Logo } from "./ui/Icons";

const TABS: { id: Tab; label: string; Icon: typeof IconLive }[] = [
  { id: "live", label: "Live", Icon: IconLive },
  { id: "brain", label: "Cerveau", Icon: IconBrain },
  { id: "trades", label: "Journal", Icon: IconJournal },
  { id: "lab", label: "Labo", Icon: IconLab },
  { id: "settings", label: "Réglages", Icon: IconSettings },
];

function Boot() {
  const phase = useGold((s) => s.phase);
  const msg = useGold((s) => s.bootMsg);
  const progress = useGold((s) => s.progress);
  const indeterminate = phase !== "loading" || progress === 0;
  return (
    <div className="boot">
      <div className="boot-logo">
        <Logo size={40} />
      </div>
      <div>
        <div className="boot-title">AURUM</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Intelligence de trading · Or
        </div>
      </div>
      {phase === "error" ? (
        <>
          <div className="boot-msg">{msg}</div>
          <button className="btn gold" onClick={() => bot.boot()}>
            Réessayer
          </button>
        </>
      ) : (
        <>
          <div className={`boot-bar ${indeterminate ? "indeterminate" : ""}`}>
            <div style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="boot-msg">{msg}</div>
        </>
      )}
    </div>
  );
}

function FeedPill() {
  const source = useGold((s) => s.source);
  const feed = useGold((s) => s.feed);
  const dot = source === "sim" ? "sim" : feed === "live" ? "live" : feed === "off" ? "" : "warn";
  const label = feed === "live" ? "LIVE" : feed === "polling" ? "REST" : feed === "reconnecting" ? "…" : "OFF";
  return (
    <div className="feed-pill" title={source ? SOURCES[source].label : ""}>
      <span className={`dot ${dot}`} />
      <span>{source ? SOURCES[source].short : "—"}</span>
      <span className="muted">{label}</span>
    </div>
  );
}

export default function App() {
  const phase = useGold((s) => s.phase);
  const tab = useGold((s) => s.tab);

  useEffect(() => {
    bot.boot();
    const vis = () => document.visibilityState === "visible" && bot.onVisible();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("online", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("online", vis);
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);

  if (phase !== "ready") return <div className="app"><Boot /></div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Logo />
          </div>
          <div>
            <div className="brand-name">AURUM</div>
            <div className="brand-sub">IA de trading · Or</div>
          </div>
        </div>
        <FeedPill />
      </header>
      {tab === "live" && <Live />}
      {tab === "brain" && <Brain />}
      {tab === "trades" && <Trades />}
      {tab === "lab" && <Lab />}
      {tab === "settings" && <SettingsPage />}
      <nav className="tabbar" aria-label="Navigation">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => useGold.setState({ tab: id })} aria-current={tab === id ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
