// Reads the state published by the 24/7 server (state.json on the aurum-data branch by default).
import { ServerState, isServerState } from "../engine/serverState";

export async function fetchServerState(url: string): Promise<ServerState> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    // the query string only defeats CDN caching; the file itself is static
    const sep = url.includes("?") ? "&" : "?";
    const r = await fetch(`${url}${sep}t=${Math.floor(Date.now() / 20000)}`, { cache: "no-store", signal: ctl.signal });
    if (r.status === 404) throw new Error("serveur pas encore démarré");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const s = await r.json();
    if (!isServerState(s)) throw new Error("format de serveur inconnu");
    return s;
  } finally {
    clearTimeout(timer);
  }
}
