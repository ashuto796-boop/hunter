// Reads the state published by the 24/7 server (state.json on the aurum-data branch by default).
import { ServerState, isServerState } from "../engine/serverState";

async function getFresh(url: string): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    // the query string only defeats CDN caching; the file itself is static
    const sep = url.includes("?") ? "&" : "?";
    const r = await fetch(`${url}${sep}t=${Math.floor(Date.now() / 20000)}`, { cache: "no-store", signal: ctl.signal });
    if (r.status === 404) throw new Error("serveur pas encore démarré");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchServerState(url: string): Promise<ServerState> {
  const s = await getFresh(url);
  if (!isServerState(s)) throw new Error("format de serveur inconnu");
  return s;
}

// ~50 bytes published next to state.json: lets the phone poll every minute without
// downloading the whole state each time (null when the server has no stamp)
export async function fetchServerStamp(url: string): Promise<number | null> {
  if (!/state\.json(\?|$)/.test(url)) return null;
  try {
    const s = (await getFresh(url.replace(/state\.json/, "stamp.json"))) as { updatedAt?: number };
    return typeof s.updatedAt === "number" ? s.updatedAt : null;
  } catch {
    return null;
  }
}
