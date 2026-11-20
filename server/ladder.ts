// Second demo account on the server: the scalp piloted by the nightly lab. Each run it reads the
// lab's leaderboard (aurum-lab/scalp.json), takes its pick (src/gold/engine/scalprule.ts: the
// champion, else the qualified rule that earned the most on prices it was not ranked on), and
// replays that rule on the last week of real 1-minute prices with a broker-like spread. Each trade
// is sized so its stop loses 5 € at most (5.40 $). Paper money only: nothing here talks to a broker.
import { fetchHistory, Source } from "../src/gold/data/feed";
import { AURUM_SCALP1, LadderState, newLadder, record, upgradeLadder } from "../src/gold/engine/ladder";
import { describeRule, labPick, LabEntry, scalpMarket, scalpRun } from "../src/gold/engine/scalprule";
import { ServerState } from "../src/gold/engine/serverState";

const LAB_URL = "https://raw.githubusercontent.com/ashuto796-boop/hunter/aurum-lab/scalp.json";
const RISK = 5.4; // $ lost at most per trade: 5 €
const SPREAD = 0.6; // $ per round trip, as at a CFD broker (Bitget's own spread is narrower)
const DAYS = 7; // a week of minutes: the 20-hour average is settled long before the trades booked

async function lab(): Promise<{ champion: string | null; entries: LabEntry[] } | null> {
  try {
    const r = await fetch(`${LAB_URL}?t=${Date.now()}`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// From the 1-minute rules (version 2) to the lab's pick: open positions are closed at the last price
function toLab(L: LadderState) {
  if (L.version === 3) return;
  for (const p of (L.open ?? []).splice(0)) record(L, p, L.lastT + 60_000, p.dir * (L.lastC - p.dir * (SPREAD / 2) - p.entry) * (p.oz ?? 1), "règles");
  L.version = 3;
  L.pending = 0;
}

export async function ladderStep(state: ServerState, src: Source, log: (...m: unknown[]) => void) {
  const now = Date.now();
  const L = state.ladder ?? (state.ladder = newLadder(10_000, now));
  upgradeLadder(L, AURUM_SCALP1);
  toLab(L);
  const board = await lab();
  const pick = board ? labPick(board, L.ruleId) : null;
  if (!pick && !L.ruleId) {
    log("scalp du labo : pas encore de règle qualifiée lisible");
    return;
  }
  const bars = await fetchHistory(src, 1, DAYS).catch((e) => {
    log("scalp du labo : prix minute indisponibles,", (e as Error).message);
    return null;
  });
  if (!bars?.length) return;
  const closedBars = bars.filter((b) => b.t + 60_000 <= now);
  const last = closedBars[closedBars.length - 1];
  // a new pick: what the previous rule still holds is closed at the last price, the new one starts now
  if (pick && pick.id !== L.ruleId) {
    for (const p of (L.open ?? []).splice(0)) record(L, p, last.t + 60_000, p.dir * (last.c - p.dir * (SPREAD / 2) - p.entry) * (p.oz ?? 1), "règles");
    log(`scalp du labo : nouvelle règle ${pick.id} (${L.ruleId ?? "aucune"} avant)`);
    L.ruleId = pick.id;
    L.ruleText = describeRule(pick.rule);
    L.followSince = now;
    L.recorded = [];
    L.bookedUntil = 0;
    L.rule = pick.rule;
  }
  const rule = L.rule;
  if (!rule) return;
  const m = scalpMarket(closedBars.map((b) => ({ t: b.t / 1000, o: b.o, h: b.h, l: b.l, c: b.c, s: SPREAD })));
  // one trade at a time, as in the lab: nothing that starts before the last booked trade ended
  // (a replay on a later window can shift a signal by a few minutes; what is booked stays booked)
  const booked = new Set(L.recorded ?? []);
  const since = Math.max((L.followSince ?? now) / 1000, L.bookedUntil ?? 0);
  const trades = scalpRun(m, rule, 1500).filter((x) => x.t >= since);
  let n = 0;
  L.open = [];
  for (const x of trades) {
    const pos = { dir: x.dir, entry: x.entry, t: x.t * 1000, oz: RISK / x.stop };
    if (x.exitT === null) {
      L.open.push(pos);
      continue;
    }
    if (booked.has(x.t)) continue;
    record(L, pos, x.exitT * 1000, x.r * RISK, x.r > 0 ? "objectifs" : x.r <= -0.99 ? "coupée" : Math.abs(x.r) < 1e-9 ? "entrée" : "temps");
    booked.add(x.t);
    L.bookedUntil = x.exitT;
    n++;
  }
  L.recorded = [...booked].sort((a, b) => a - b).slice(-500);
  L.lastT = last.t;
  L.lastC = last.c;
  log(`scalp du labo (${L.ruleId}) : ${n} trade(s) fermé(s), ${L.open.length} ouvert(s), solde ${L.balance.toFixed(2)} $`);
}
