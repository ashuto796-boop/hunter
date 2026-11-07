import { useGold } from "../store";
import { Headline, MediaState, moodLabel, moodOf } from "../engine/media";

const ago = (t: number) => {
  const min = Math.max(1, Math.round((Date.now() - t) / 60000));
  return min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} j`;
};

const scoreTone = (s: number) => (s >= 0.15 ? "up" : s <= -0.15 ? "down" : "");

function currentMood(media: MediaState) {
  return moodOf(media.headlines, Date.now());
}

function HeadlineRow({ h }: { h: Headline }) {
  return (
    <a className="press-item" href={h.url} target="_blank" rel="noreferrer">
      <span className={`dot ${h.score >= 0.15 ? "live" : h.score <= -0.15 ? "neg" : ""}`} aria-hidden />
      <span className="press-main">
        <span className="press-title">
          {h.major && <span className="chip gold press-major">majeur</span>}
          {h.title}
        </span>
        <span className="row-sub">
          {h.source} · il y a {ago(h.t)} ·{" "}
          <span className={scoreTone(h.score)}>
            {h.score >= 0.15 ? "haussier" : h.score <= -0.15 ? "baissier" : "neutre"} pour l'or
          </span>
          {h.by === "claude" ? " (Claude)" : ""}
        </span>
      </span>
    </a>
  );
}

function MoodGauge({ score }: { score: number }) {
  return (
    <div className="bias">
      <div className="bias-track">
        <div className="bias-knob" style={{ left: `${50 + Math.max(-1, Math.min(1, score)) * 50}%` }} />
      </div>
      <div className="bias-labels">
        <span>Baissière</span>
        <span>Neutre</span>
        <span>Haussière</span>
      </div>
    </div>
  );
}

// Compact view for the Live screen
export function PressCard({ onMore }: { onMore: () => void }) {
  const media = useGold((s) => s.media);
  if (!media || !media.headlines.length) return null;
  const mood = currentMood(media);
  return (
    <section className="card">
      <div className="card-title">
        <span>Radar médias</span>
        <span className="num" style={{ textTransform: "none", letterSpacing: 0 }}>
          {mood.n} titres · 24 h
        </span>
      </div>
      <div className="kv-label" style={{ marginBottom: 8 }}>
        La presse est <span className={scoreTone(mood.score)}>{moodLabel(mood.score)}</span>
      </div>
      <MoodGauge score={mood.score} />
      {media.reading && <p className="press-summary">{media.reading.summary}</p>}
      {media.reading && media.reading.themes.length > 0 && (
        <div className="chips" style={{ marginTop: 8 }}>
          {media.reading.themes.map((th) => (
            <span className="chip" key={th}>
              {th}
            </span>
          ))}
        </div>
      )}
      <div className="list" style={{ marginTop: 10 }}>
        {media.headlines.slice(0, 3).map((h) => (
          <HeadlineRow h={h} key={h.id} />
        ))}
      </div>
      <button className="btn block" style={{ marginTop: 10 }} onClick={onMore}>
        Toute la revue de presse
      </button>
    </section>
  );
}

// Full press review for the Cerveau screen
export function PressReview() {
  const media = useGold((s) => s.media);
  const remote = useGold((s) => s.remote);
  if (!media || !media.headlines.length) {
    return (
      <section className="card">
        <div className="card-title">Revue de presse</div>
        <div className="empty" style={{ padding: "4px 0" }}>
          {remote ? "La revue de presse arrive au prochain passage du serveur." : "La revue de presse est faite par le serveur 24/7 : active-le dans Réglages."}
        </div>
      </section>
    );
  }
  const mood = currentMood(media);
  const bySource = new Map<string, number>();
  for (const h of media.headlines) bySource.set(h.source, (bySource.get(h.source) ?? 0) + 1);
  const topSources = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <section className="card">
      <div className="card-title">
        <span>Revue de presse</span>
        <span className={`chip ${mood.score >= 0.12 ? "up" : mood.score <= -0.12 ? "down" : ""}`}>
          {mood.score >= 0 ? "+" : ""}
          {mood.score.toFixed(2)}
        </span>
      </div>
      {media.reading ? (
        <>
          <p style={{ fontSize: 14, lineHeight: 1.5 }}>{media.reading.summary}</p>
          <p className="note" style={{ marginTop: 6 }}>Lecture de Claude, il y a {ago(media.reading.t)}.</p>
        </>
      ) : (
        <p className="note">
          Titres notés par un lexique de mots-clés (hausse, baisse, Fed, dollar, valeur refuge…). Avec la clé ANTHROPIC_API_KEY sur GitHub, Claude les relit toutes les
          3 heures et résume l'actualité.
        </p>
      )}
      <p className="note" style={{ marginTop: 6 }}>
        Sources : {topSources.map(([s, n]) => `${s} (${n})`).join(", ")}. Effet sur les décisions : ±5 % de confiance au plus ; une rafale d'articles ou une info majeure met
        les nouvelles entrées en pause 45 min.
      </p>
      <div className="list" style={{ marginTop: 6 }}>
        {media.headlines.slice(0, 40).map((h) => (
          <HeadlineRow h={h} key={h.id} />
        ))}
      </div>
    </section>
  );
}
