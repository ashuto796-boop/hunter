/** Formatage des nombres et probabilités (conventions françaises). */

const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat("fr-FR", opts);

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return nf({ maximumFractionDigits: 0 }).format(n);
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return nf({ maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
}

export function fmtFixed(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return nf({ maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function fmtPct(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  if (x !== 0 && Math.abs(x) < 1e-4) return `${fmtSci(x * 100)} %`;
  return `${nf({ maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(x * 100)} %`;
}

export function fmtEuro(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return nf({ style: "currency", currency: "EUR", maximumFractionDigits: digits }).format(x);
}

export function fmtCompactEuro(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return nf({ style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 }).format(x);
}

export function fmtSci(x: number | null | undefined, digits = 3): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  if (x === 0) return "0";
  const [m, e] = x.toExponential(digits - 1).split("e");
  return `${m.replace(".", ",")} × 10^${Number(e)}`;
}

/** « 1 chance sur N » à partir d'une probabilité flottante. */
export function oneIn(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  if (p <= 0) return "aucune chance";
  if (p >= 1) return "certain";
  const inv = 1 / p;
  if (inv < 10) return `1 chance sur ${fmtNum(inv, 2)}`;
  return `1 chance sur ≈ ${fmtInt(Math.round(inv))}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function fmtPValue(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  if (p < 0.0001) return "< 0,0001";
  return fmtFixed(p, 4);
}

export function gridKey(numbers: number[], stars: number[]): string {
  return `${[...numbers].sort((a, b) => a - b).join("-")}|${[...stars].sort((a, b) => a - b).join("-")}`;
}

export function gridText(numbers: number[], stars: number[]): string {
  const n = [...numbers].sort((a, b) => a - b).map((x) => String(x).padStart(2, "0"));
  const s = [...stars].sort((a, b) => a - b).map((x) => String(x).padStart(2, "0"));
  return `${n.join(" ")} ★ ${s.join(" ")}`;
}

/** Nombre lisible même très petit (notation scientifique sous 0,001). */
export function fmtSmall(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  if (x !== 0 && Math.abs(x) < 1e-3) return fmtSci(x, 3);
  return fmtNum(x, digits);
}
