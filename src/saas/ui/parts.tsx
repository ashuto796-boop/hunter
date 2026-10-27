import { ReactNode, useEffect, useRef, useState } from "react";
import { COMPLEXITY_LABEL, MARKET_LABEL } from "../data/questions";
import { priceLabel } from "../engine/format";
import { go } from "../router";
import { Idea, Match } from "../types";
import { IconArrowRight, IconCheck, IconCopy, IconSparkle } from "./Icons";
import { copyText } from "./util";

export function CopyButton({ text, label = "Copier", className = "btn" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        setState((await copyText(text)) ? "ok" : "fail");
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setState("idle"), 1800);
      }}
    >
      {state === "ok" ? <IconCheck /> : <IconCopy />}
      <span>{state === "ok" ? "Copié" : state === "fail" ? "Copie impossible" : label}</span>
    </button>
  );
}

export function ScoreRing({ value, size = 56 }: { value: number; size?: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="score" style={{ width: size, height: size }} title={`${value} % de compatibilité avec ton profil`}>
      <svg viewBox="0 0 52 52" width={size} height={size} aria-hidden="true">
        <circle cx="26" cy="26" r={r} className="score-track" />
        <circle cx="26" cy="26" r={r} className="score-fill" strokeDasharray={`${(c * value) / 100} ${c}`} />
      </svg>
      <span className="score-num">
        {value}
        <small>%</small>
      </span>
    </div>
  );
}

export function IdeaChips({ idea }: { idea: Idea }) {
  return (
    <div className="chips">
      <span className="chip">{MARKET_LABEL[idea.market]}</span>
      <span className="chip">{priceLabel(idea)}</span>
      <span className="chip">{COMPLEXITY_LABEL[idea.complexity]}</span>
      {idea.source === "claude" && (
        <span className="chip chip-accent">
          <IconSparkle /> Claude
        </span>
      )}
    </div>
  );
}

export function IdeaCard({ idea, match, rank }: { idea: Idea; match?: Match | null; rank?: number }) {
  const open = () => go({ name: "idea", id: idea.id, tab: "idee" });
  return (
    <article className="idea-card" onClick={open}>
      <div className="idea-card-top">
        <div>
          {rank !== undefined && <div className="kicker">Idée n°{rank}</div>}
          <h3 className="idea-name">{idea.name}</h3>
        </div>
        {match && <ScoreRing value={match.score} />}
      </div>
      <p className="idea-pitch">{idea.pitch}</p>
      <IdeaChips idea={idea} />
      {match && match.reasons.length > 0 && (
        <ul className="reasons">
          {match.reasons.map((r) => (
            <li key={r}>
              <IconCheck />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="link-btn"
        onClick={(e) => {
          e.stopPropagation();
          open();
        }}
      >
        Voir l'idée, le prompt et le plan <IconArrowRight />
      </button>
    </article>
  );
}

export function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <h2 className="section-title">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}
