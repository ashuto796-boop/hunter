// Circular confidence gauge with the decision threshold marked on the ring.
export function ScoreRing({ score, threshold, dir }: { score: number; threshold: number; dir: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, score / 100);
  const ready = score >= threshold;
  const color = !ready ? "rgba(255,255,255,0.35)" : dir === 1 ? "var(--up)" : "var(--down)";
  const ang = (threshold / 100) * 2 * Math.PI - Math.PI / 2;
  const tx = 46 + r * Math.cos(ang);
  const ty = 46 + r * Math.sin(ang);
  return (
    <div className="ring-wrap" role="img" aria-label={`Score de confiance ${score} sur 100, seuil ${threshold}`}>
      <svg width="92" height="92" viewBox="0 0 92 92">
        <defs>
          <linearGradient id="ringGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f8e3a6" />
            <stop offset="100%" stopColor="#b5832a" />
          </linearGradient>
        </defs>
        <circle cx="46" cy="46" r={r} stroke="rgba(255,255,255,0.07)" strokeWidth="7" fill="none" />
        {frac > 0 && (
          <circle
            cx="46"
            cy="46"
            r={r}
            stroke={ready ? color : "url(#ringGold)"}
            strokeOpacity={ready ? 1 : 0.85}
            strokeWidth="7"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${frac * c} ${c}`}
            transform="rotate(-90 46 46)"
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
        )}
        <circle cx={tx} cy={ty} r="3.2" fill="#f3efe6" stroke="#07080a" strokeWidth="1.5" />
      </svg>
      <div className="ring-center">
        <div>
          <div className="ring-score num" style={{ color: ready ? color : undefined }}>
            {score}
          </div>
          <div className="ring-sub">SEUIL {threshold}</div>
        </div>
      </div>
    </div>
  );
}
