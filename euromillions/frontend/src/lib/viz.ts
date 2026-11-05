/**
 * Jetons de visualisation (palette catégorielle validée contre la surface #111a33 :
 * bande de luminance, chroma, séparation daltonisme ≥ 8, contraste ≥ 3:1).
 * Les textes des graphiques utilisent les jetons de texte, jamais la couleur des séries.
 */
export const VIZ = {
  surface: "#111a33",
  grid: "#24304f",
  axis: "#3a4670",
  textPrimary: "#e8ebf7",
  textSecondary: "#a7b0cc",
  reference: "#b9c0d8", // référence théorique (neutre)
  series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
};

/** Rampe séquentielle bleue (sombre → clair) pour les cartes de chaleur sur fond sombre. */
const RAMP = ["#14203d", "#0d366b", "#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4", "#b7d3f6", "#cde2fb"];

export function sequential(t: number): string {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  return RAMP[Math.round(x * (RAMP.length - 1))];
}

export const axisProps = {
  stroke: VIZ.axis,
  tickLine: false,
  tick: { fill: VIZ.textSecondary, fontSize: 11 },
} as const;

export const tooltipStyle = {
  contentStyle: {
    background: "#0b1124",
    border: "1px solid #2b3760",
    borderRadius: 10,
    color: VIZ.textPrimary,
    fontSize: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,.4)",
  },
  labelStyle: { color: VIZ.textPrimary, fontWeight: 600 },
  itemStyle: { color: VIZ.textPrimary },
} as const;
