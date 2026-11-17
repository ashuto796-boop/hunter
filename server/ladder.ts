// Second demo account on the server: the owner's 1-minute scalp (src/gold/engine/ladder.ts),
// replayed minute by minute on the real 1-minute prices since the previous run, with a broker-like
// spread. Paper money only: nothing here talks to a broker.
import { fetchKlines, Source } from "../src/gold/data/feed";
import { AURUM_SCALP1, ladderMinute, newLadder, upgradeLadder } from "../src/gold/engine/ladder";
import { ServerState } from "../src/gold/engine/serverState";

export async function ladderStep(state: ServerState, src: Source, log: (...m: unknown[]) => void) {
  const now = Date.now();
  const first = !state.ladder?.lastT;
  const L = state.ladder ?? (state.ladder = newLadder(10_000, now));
  const settled = upgradeLadder(L, AURUM_SCALP1);
  if (settled.length) log(`scalp 1 min : nouvelles règles, l'échelle en cours est soldée à ${settled[0].pnl.toFixed(2)} $`);
  let bars;
  try {
    bars = await fetchKlines(src, 1, { limit: 1000 });
  } catch (e) {
    log("scalp 1 min : prix minute indisponibles,", (e as Error).message);
    return;
  }
  let n = 0, closed = 0;
  for (const b of bars) {
    if (b.t + 60_000 > now || b.t <= L.lastT) continue;
    closed += ladderMinute(L, AURUM_SCALP1, b, !first).length;
    n++;
  }
  log(`scalp 1 min : ${n} minutes, ${closed} position(s) fermée(s), ${L.open?.length ?? 0} ouverte(s), solde ${L.balance.toFixed(2)} $`);
}
