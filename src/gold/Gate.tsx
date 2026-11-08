// Entry screen, shown at every launch: slide to enter AURUM. The first time, a second step asks
// the owner to confirm, knowingly, that they want the AI to start trading (hold to start).
// The market data loads behind it, so the app is usually ready once inside.
import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { useGold } from "./store";
import { Logo } from "./ui/Icons";
import { price } from "./ui/format";

const CONSENT_KEY = "aurum.consent";
const CONSENT_VERSION = "1";
const HOLD_MS = 1300;

const hasConsent = () => {
  try {
    return localStorage.getItem(CONSENT_KEY)?.split(":")[0] === CONSENT_VERSION;
  } catch {
    return false;
  }
};
const saveConsent = () => {
  try {
    localStorage.setItem(CONSENT_KEY, `${CONSENT_VERSION}:${new Date().toISOString()}`);
  } catch {
    /* private mode: asked again next time */
  }
};

function SlideToEnter({ onDone }: { onDone: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ start: number; max: number } | null>(null);
  const [x, setX] = useState(0);
  const [max, setMax] = useState(1);
  const [snap, setSnap] = useState(false);
  const [nudge, setNudge] = useState(false);
  const measure = () => {
    const t = track.current!.getBoundingClientRect().width;
    const k = knob.current!.getBoundingClientRect().width;
    return t - k - 12;
  };
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = measure();
    setMax(m);
    drag.current = { start: e.clientX - x, max: m };
    setSnap(false);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (d) setX(Math.max(0, Math.min(d.max, e.clientX - d.start)));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    setSnap(true);
    if (x >= d.max * 0.88) {
      setX(d.max);
      navigator.vibrate?.(12);
      setTimeout(onDone, 160);
    } else {
      if (x < 6) {
        setNudge(true);
        setTimeout(() => setNudge(false), 650);
      }
      setX(0);
    }
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
      e.preventDefault();
      const m = measure();
      setMax(m);
      setSnap(true);
      setX(m);
      setTimeout(onDone, 200);
    }
  };
  const frac = Math.min(1, x / max);
  return (
    <div className={`slide ${nudge ? "nudge" : ""}`} ref={track} style={{ ["--p" as string]: frac }}>
      <div className="slide-fill" style={{ width: `calc(${x}px + 58px)` }} />
      <span className="slide-text" style={{ opacity: 1 - frac * 1.4 }}>
        Glisse pour entrer
      </span>
      <button
        ref={knob}
        className={`slide-knob ${snap ? "snap" : ""}`}
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        aria-label="Entrer dans AURUM (glisser, ou Entrée)"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}

function HoldToStart({ disabled, onDone }: { disabled: boolean; onDone: () => void }) {
  const [p, setP] = useState(0);
  const raf = useRef(0);
  const t0 = useRef(0);
  const done = useRef(false);
  const stop = () => {
    cancelAnimationFrame(raf.current);
    if (!done.current) setP(0);
  };
  const start = () => {
    if (disabled || done.current) return;
    t0.current = performance.now();
    const tick = (now: number) => {
      const f = Math.min(1, (now - t0.current) / HOLD_MS);
      setP(f);
      if (f >= 1) {
        done.current = true;
        navigator.vibrate?.([10, 40, 18]);
        onDone();
      } else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return (
    <button
      className="hold"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && (e.preventDefault(), start())}
      onKeyUp={(e) => (e.key === " " || e.key === "Enter") && stop()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hold-fill" style={{ transform: `scaleX(${p})` }} />
      <span className="hold-text" style={{ color: p > 0.45 ? "var(--on-acc)" : undefined }}>{p >= 1 ? "C'est parti" : p > 0 ? "Maintiens…" : disabled ? "Coche les 3 points" : "Maintiens pour commencer"}</span>
    </button>
  );
}

const PROMISES = [
  "Je sais que l'IA peut perdre de l'argent, même plusieurs semaines de suite.",
  "Je commence par la démo et le compte d'essai avant l'argent réel.",
  "Je n'engagerai que de l'argent que je peux me permettre de perdre.",
];

export function Gate({ onEnter }: { onEnter: () => void }) {
  const p = useGold((s) => s.price);
  const phase = useGold((s) => s.phase);
  const progress = useGold((s) => s.progress);
  const remote = useGold((s) => s.remote);
  const [leaving, setLeaving] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [ticks, setTicks] = useState([false, false, false]);
  const leave = () => {
    setLeaving(true);
    setTimeout(onEnter, 650);
  };
  const entered = () => (hasConsent() ? leave() : setSheet(true));
  return (
    <div className={`gate ${leaving ? "leaving" : ""}`}>
      <div className="aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="gate-grid" aria-hidden />
      <div className="gate-grain" aria-hidden />

      <div className="gate-top">
        <span className="gate-pill">
          <span className={`dot ${phase === "ready" ? "live" : "warn"}`} />
          {phase === "ready" ? (remote ? "Serveur 24/7 en ligne" : "IA prête") : `Préparation ${Math.round(progress * 100) || ""}${progress ? " %" : "…"}`}
        </span>
        <span className="gate-pill">Accès privé</span>
      </div>

      <div className="gate-center">
        <div className="gate-mark">
          <Logo size={34} />
        </div>
        <h1 className="gate-word">AURUM</h1>
        <p className="gate-tag">L'intelligence qui trade l'or pour toi.</p>
        <div className="gate-bento">
          <div className="bento">
            <span className="bento-k">Or · XAU/USD</span>
            <span className="bento-v num">{p ? price(p) : "—"}</span>
          </div>
          <div className="bento">
            <span className="bento-k">Spécialistes</span>
            <span className="bento-v num">7</span>
          </div>
          <div className="bento">
            <span className="bento-k">Veille</span>
            <span className="bento-v num">24/7</span>
          </div>
        </div>
      </div>

      <div className="gate-bottom">
        <SlideToEnter onDone={entered} />
        <p className="gate-fine">Trading à risque · aucune promesse de gain</p>
      </div>

      {sheet && (
        <div className="sheet-wrap">
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="consent-title">
            <div className="sheet-handle" />
            <h2 id="consent-title" className="sheet-title">
              Prêt à laisser l'IA trader ?
            </h2>
            <p className="sheet-sub">Une seule fois. Ce que tu acceptes en entrant :</p>
            <div className="promises">
              {PROMISES.map((t, i) => (
                <label key={i} className={`promise ${ticks[i] ? "on" : ""}`}>
                  <input type="checkbox" checked={ticks[i]} onChange={() => setTicks(ticks.map((v, j) => (j === i ? !v : v)))} />
                  <span className="promise-box" aria-hidden>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                  <span>{t}</span>
                </label>
              ))}
            </div>
            <HoldToStart
              disabled={!ticks.every(Boolean)}
              onDone={() => {
                saveConsent();
                leave();
              }}
            />
            <button className="sheet-cancel" onClick={() => setSheet(false)}>
              Pas maintenant
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
