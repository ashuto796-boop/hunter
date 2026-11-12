// Reads the state the agents publish on the ecom-data branch and opens it with the passphrase.
import { unseal } from "../gold/engine/seal";
import type { EcomState, PublishedState } from "./shared/types";

export const DEFAULT_URL = "https://raw.githubusercontent.com/ashuto796-boop/hunter/ecom-data/state.json";
export const REPO_URL = "https://github.com/ashuto796-boop/hunter";

export type Loaded =
  | { kind: "ok"; state: EcomState }
  | { kind: "none" } // the agents have not published yet
  | { kind: "locked"; at: number } // passphrase missing or wrong
  | { kind: "error"; message: string };

export async function loadState(url: string, passphrase: string): Promise<Loaded> {
  let pub: PublishedState;
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
    if (res.status === 404) return { kind: "none" };
    if (!res.ok) return { kind: "error", message: `serveur ${res.status}` };
    pub = (await res.json()) as PublishedState;
  } catch {
    return { kind: "error", message: "pas de réseau" };
  }
  if (!passphrase) return { kind: "locked", at: pub.at };
  const state = await unseal<EcomState>(pub.sealed, passphrase);
  return state ? { kind: "ok", state } : { kind: "locked", at: pub.at };
}

export const store = {
  get(key: string): string {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  },
  set(key: string, value: string) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* private mode: the value lives for this visit only */
    }
  },
};

export const eur = (x: number | null | undefined, digits = 0) =>
  x == null ? "—" : `${x.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`;

export function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}
