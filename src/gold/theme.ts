// Colour themes (a preference of this phone, kept in localStorage). The stylesheet holds the
// palettes; the charts read the current one when they are drawn.
export type ThemeId = "neon" | "violet" | "ocean" | "rose" | "platine" | "or";

export const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: "neon", label: "Néon", swatch: "linear-gradient(135deg, #9af3ff, #0a8fd8)" },
  { id: "violet", label: "Violet", swatch: "linear-gradient(135deg, #b9a9ff, #6a4cf5)" },
  { id: "ocean", label: "Océan", swatch: "linear-gradient(135deg, #9fd0ff, #2560d8)" },
  { id: "rose", label: "Rose", swatch: "linear-gradient(135deg, #ffb0d4, #d0367b)" },
  { id: "platine", label: "Platine", swatch: "linear-gradient(135deg, #ffffff, #9ba3b2)" },
  { id: "or", label: "Or", swatch: "linear-gradient(135deg, #f8e3a6, #b5832a)" },
];

const KEY = "aurum.theme";
export const DEFAULT_THEME: ThemeId = "neon";

export function loadTheme(): ThemeId {
  try {
    const t = localStorage.getItem(KEY) as ThemeId | null;
    if (t && THEMES.some((x) => x.id === t)) return t;
  } catch {
    /* private mode */
  }
  return DEFAULT_THEME;
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
}

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// "r, g, b" of the accent, for translucent strokes in charts
export const accent = (alpha: number) => `rgba(${cssVar("--acc-rgb") || "45, 226, 255"}, ${alpha})`;
