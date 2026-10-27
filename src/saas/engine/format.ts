import { Idea } from "../types";

const eurFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

export function eur(n: number): string {
  return `${eurFmt.format(n)} €`;
}

export function priceLabel(idea: Pick<Idea, "price" | "priceUnit">): string {
  return `${eur(idea.price)} ${idea.priceUnit}`.replace(" /", "/");
}

export function lcfirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

export function firstSentence(s: string): string {
  const m = s.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim();
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
