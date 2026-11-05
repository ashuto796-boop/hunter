import { cn } from "@/lib/utils";

interface BallProps {
  value: number;
  hit?: boolean;
  small?: boolean;
}

export function Ball({ value, hit, small }: BallProps) {
  return (
    <span className={cn("ball animate-pop", small && "ball-sm", hit && "ball-hit")} aria-label={`numéro ${value}`}>
      {value}
    </span>
  );
}

export function StarBall({ value, hit, small }: BallProps) {
  return (
    <span className={cn("star animate-pop", small && "star-sm", hit && "star-hit")} aria-label={`étoile ${value}`}>
      <span>{value}</span>
    </span>
  );
}

interface GridBallsProps {
  numbers: number[];
  stars: number[];
  small?: boolean;
  hitNumbers?: number[];
  hitStars?: number[];
  className?: string;
}

/** Affiche une grille : 5 boules (ordre croissant) puis 2 étoiles dorées. */
export function GridBalls({ numbers, stars, small, hitNumbers = [], hitStars = [], className }: GridBallsProps) {
  const n = [...numbers].sort((a, b) => a - b);
  const s = [...stars].sort((a, b) => a - b);
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} data-testid="grid-balls">
      {n.map((v) => (
        <Ball key={`n${v}`} value={v} small={small} hit={hitNumbers.includes(v)} />
      ))}
      <span className="mx-1 h-6 w-px bg-border" aria-hidden />
      {s.map((v) => (
        <StarBall key={`s${v}`} value={v} small={small} hit={hitStars.includes(v)} />
      ))}
    </div>
  );
}
