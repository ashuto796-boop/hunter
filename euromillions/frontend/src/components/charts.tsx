import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtNum, fmtPct } from "@/lib/format";
import { VIZ, axisProps, sequential, tooltipStyle } from "@/lib/viz";

const grid = <CartesianGrid stroke={VIZ.grid} vertical={false} strokeDasharray="" />;
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

/** Effectifs observés par valeur, avec la ligne de référence de l'effectif attendu sous H0. */
export function FrequencyBars({ data, expected, height = 260 }: {
  data: { value: number; count: number }[]; expected?: number; height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 8, left: -12, bottom: 0 }} barCategoryGap={2}>
        {grid}
        <XAxis dataKey="value" {...axisProps} interval={data.length > 20 ? 1 : 0} />
        <YAxis {...axisProps} axisLine={false} />
        <Tooltip {...tooltipStyle} formatter={(v) => [fmtNum(Number(v), 0), "Apparitions"]} labelFormatter={(l) => `Valeur ${l}`} />
        <Bar dataKey="count" maxBarSize={24} radius={BAR_RADIUS} isAnimationActive={false} fill={VIZ.series[0]} />
        {expected !== undefined && (
          <ReferenceLine y={expected} stroke={VIZ.reference} strokeWidth={1.5}
            label={{ value: `attendu ${fmtNum(expected, 1)}`, fill: VIZ.textSecondary, fontSize: 11, position: "insideTopRight" }} />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Distribution observée (barres) contre distribution théorique exacte (ligne neutre). */
export function ObservedVsTheory({ data, xLabel, height = 260 }: {
  data: { value: number | string; observed_pct: number; theoretical_pct: number }[]; xLabel?: string; height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 8, left: -8, bottom: 0 }} barCategoryGap={2}>
        {grid}
        <XAxis dataKey="value" {...axisProps} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -2, fill: VIZ.textSecondary, fontSize: 11 } : undefined} />
        <YAxis {...axisProps} axisLine={false} tickFormatter={(v) => fmtPct(Number(v), 1)} />
        <Tooltip {...tooltipStyle} formatter={(v, name) => [fmtPct(Number(v), 2), name === "observed_pct" ? "Observé" : "Théorique"]} />
        <Legend formatter={(v) => (v === "observed_pct" ? "Observé" : "Théorique exact")} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="observed_pct" fill={VIZ.series[0]} maxBarSize={24} radius={BAR_RADIUS} isAnimationActive={false} />
        <Line dataKey="theoretical_pct" stroke={VIZ.reference} strokeWidth={2} dot={{ r: 3, fill: VIZ.reference, stroke: VIZ.surface, strokeWidth: 2 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Histogramme simple (une série). */
export function Histogram({ data, xKey, yKey, yLabel, height = 240, color = VIZ.series[0], xFormatter }: {
  data: Record<string, number | string>[]; xKey: string; yKey: string; yLabel: string; height?: number; color?: string;
  xFormatter?: (v: unknown) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: -8, bottom: 0 }} barCategoryGap={2}>
        {grid}
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormatter as never} />
        <YAxis {...axisProps} axisLine={false} />
        <Tooltip {...tooltipStyle} formatter={(v) => [fmtNum(Number(v), 2), yLabel]} labelFormatter={(l) => (xFormatter ? xFormatter(l) : String(l))} />
        <Bar dataKey={yKey} fill={color} maxBarSize={24} radius={BAR_RADIUS} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
  dashed?: boolean;
  neutral?: boolean;
}

/** Courbes (une seule échelle d'axe). */
export function Lines({ data, xKey, series, height = 260, yFormatter, xFormatter, yLabel, yDomain }: {
  data: Record<string, unknown>[]; xKey: string; series: SeriesDef[]; height?: number;
  yFormatter?: (v: number) => string; xFormatter?: (v: unknown) => string; yLabel?: string;
  yDomain?: [number | string, number | string];
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 12, left: -4, bottom: 0 }}>
        {grid}
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormatter as never} minTickGap={24} />
        <YAxis {...axisProps} axisLine={false} tickFormatter={yFormatter as never} width={56} domain={yDomain as never}
          label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: VIZ.textSecondary, fontSize: 11 } : undefined} />
        <Tooltip {...tooltipStyle} formatter={(v, n) => [yFormatter ? yFormatter(Number(v)) : fmtNum(Number(v), 3), series.find((s) => s.key === n)?.label ?? String(n)]}
          labelFormatter={(l) => (xFormatter ? xFormatter(l) : String(l))} />
        {series.length > 1 && <Legend formatter={(v) => series.find((s) => s.key === v)?.label ?? v} wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line key={s.key} dataKey={s.key} type="monotone" dot={false} strokeWidth={2} isAnimationActive={false}
            stroke={s.neutral ? VIZ.reference : s.color ?? VIZ.series[i % VIZ.series.length]}
            strokeDasharray={s.dashed ? "5 4" : undefined} activeDot={{ r: 4, stroke: VIZ.surface, strokeWidth: 2 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Barres groupées pour comparer jusqu'à 5 entités (couleurs catégorielles dans l'ordre fixe). */
export function GroupedBars({ data, categories, height = 280, yFormatter }: {
  data: Record<string, unknown>[]; categories: { key: string; label: string }[]; height?: number; yFormatter?: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: -8, bottom: 0 }} barGap={2} barCategoryGap="20%">
        {grid}
        <XAxis dataKey="metric" {...axisProps} />
        <YAxis {...axisProps} axisLine={false} tickFormatter={yFormatter as never} />
        <Tooltip {...tooltipStyle} formatter={(v, n) => [yFormatter ? yFormatter(Number(v)) : fmtNum(Number(v), 3), categories.find((c) => c.key === n)?.label ?? String(n)]} />
        <Legend formatter={(v) => categories.find((c) => c.key === v)?.label ?? v} wrapperStyle={{ fontSize: 12 }} />
        {categories.slice(0, 5).map((c, i) => (
          <Bar key={c.key} dataKey={c.key} fill={VIZ.series[i]} maxBarSize={24} radius={BAR_RADIUS} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Carte de chaleur (rampe séquentielle bleue) avec infobulle au survol. */
export function Heatmap({ matrix, labels, valueLabel = "Valeur", maxCell = 14, formatter }: {
  matrix: number[][]; labels?: (string | number)[]; valueLabel?: string; maxCell?: number; formatter?: (v: number) => string;
}) {
  const [hover, setHover] = useState<{ i: number; j: number; x: number; y: number } | null>(null);
  const n = matrix.length;
  const { min, max } = useMemo(() => {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j || n < 3) { mn = Math.min(mn, matrix[i][j]); mx = Math.max(mx, matrix[i][j]); }
    return { min: Number.isFinite(mn) ? mn : 0, max: Number.isFinite(mx) ? mx : 1 };
  }, [matrix, n]);
  if (!n) return null;
  const cell = Math.max(6, Math.min(maxCell, Math.floor(620 / n)));
  const pad = 26;
  const size = n * cell;
  const lab = labels ?? matrix.map((_, i) => i + 1);
  const fmt = formatter ?? ((v: number) => fmtNum(v, 2));
  const step = n > 20 ? 5 : 1;
  return (
    <div className="relative overflow-x-auto">
      <svg width={size + pad} height={size + pad} role="img" aria-label={`Carte de chaleur : ${valueLabel}`} onMouseLeave={() => setHover(null)}>
        {lab.map((l, i) => (i % step === step - 1 || step === 1) && (
          <g key={`l${i}`}>
            <text x={pad + i * cell + cell / 2} y={pad - 6} fontSize={9} textAnchor="middle" fill={VIZ.textSecondary}>{l}</text>
            <text x={pad - 4} y={pad + i * cell + cell / 2 + 3} fontSize={9} textAnchor="end" fill={VIZ.textSecondary}>{l}</text>
          </g>
        ))}
        {matrix.map((row, i) => row.map((v, j) => (
          <rect key={`${i}-${j}`} x={pad + j * cell} y={pad + i * cell} width={cell - 1} height={cell - 1} rx={1.5}
            fill={i === j && n > 2 ? "#0b1124" : sequential(max > min ? (v - min) / (max - min) : 0)}
            onMouseEnter={(e) => setHover({ i, j, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
            stroke={hover && hover.i === i && hover.j === j ? VIZ.textPrimary : "none"} />
        )))}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.min(hover.x + 12, size - 60), top: hover.y + 12 }}>
          <div className="font-semibold">{lab[hover.i]} × {lab[hover.j]}</div>
          <div className="text-muted-foreground">{valueLabel} : <span className="num text-foreground">{fmt(matrix[hover.i][hover.j])}</span></div>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="num">{fmt(min)}</span>
        <div className="h-2 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(sequential).join(",")})` }} />
        <span className="num">{fmt(max)}</span>
      </div>
    </div>
  );
}
