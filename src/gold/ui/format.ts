export const price = (x: number) =>
  x ? x.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

export const usd = (x: number, sign = false) => {
  const s = Math.abs(x).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign ? (x >= 0 ? "+" : "−") : x < 0 ? "−" : ""}${s} $`;
};

export const pct = (x: number, sign = true, digits = 2) => `${sign && x >= 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(digits)} %`;

export const rr = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`;

export const lots = (oz: number) => `${(oz / 100).toFixed(2)} lot`;

export const time = (t: number) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export const dateTime = (t: number) =>
  new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export const side = (d: number) => (d === 1 ? "ACHAT" : "VENTE");

export const tone = (x: number) => (x > 0 ? "up" : x < 0 ? "down" : "");
