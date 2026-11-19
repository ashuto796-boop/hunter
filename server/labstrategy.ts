// The demo bot follows the nightly strategy lab (backtest/lab.ts), as the owner asked: each run
// reads the lab's leaderboard (aurum-lab/lab.json) and plays its pick with exactly the settings and
// rules the lab measured. The pick is the lab's champion (confirmed on 30+ new days) when there is
// one, else the most robust qualified strategy: the worse of its two periods (before 2025, and 2025
// up to its discovery, in R per year) minus a quarter of its worst drawdown per year. Picking the
// best of 2025 alone would favour the luckiest of a thousand near-identical variants; a strategy
// has to be good in both periods, with a shallow drawdown, to be followed.
// It only changes for a clearly better one (10 % more), or when the one followed is no longer
// qualified, so the account does not flip between near-identical variants every night.
// Demo only: every lab strategy has realMoney false, so the real account takes no new entry.
import { LEGACY_M15, Strategy, useStrategy } from "../src/gold/engine/strategy";
import { Settings } from "../src/gold/engine/types";
import { tfLabel } from "../src/gold/ui/format";

const LAB_URL = "https://raw.githubusercontent.com/ashuto796-boop/hunter/aurum-lab/lab.json";

interface Spec {
  tf: Settings["tf"];
  threshold: number;
  trainDays: number;
  maxTradesDay: number;
  rules: Partial<Strategy>;
}
interface Entry {
  id: string;
  spec: Spec;
  status: string;
  m: { train: { sumR: number; days: number }; valid: { sumR: number; days: number }; live: { sumR: number; days: number }; perYear: number; dd: number };
}
export interface LabFollow {
  id: string;
  text: string; // in French, for the app
  since: number; // ms
  spec: Spec;
}

const perYr = (sumR: number, days: number) => sumR / Math.max(0.25, days / 365);
export const robust = (e: Entry) =>
  Math.min(perYr(e.m.train.sumR, e.m.train.days), perYr(e.m.valid.sumR + e.m.live.sumR, e.m.valid.days + e.m.live.days)) -
  (0.25 * e.m.dd) / Math.max(1, (e.m.train.days + e.m.valid.days + e.m.live.days) / 365);
const yearly = robust;
const good = (e: Entry) => e.status === "qualifiée" || e.status === "confirmée";

export function pickStrategy(lab: { champion: string | null; entries: Entry[] }, current: string | undefined): Entry | null {
  const champ = lab.entries.find((e) => e.id === lab.champion);
  if (champ) return champ;
  const best = lab.entries.filter(good).sort((a, b) => yearly(b) - yearly(a))[0] ?? null;
  const cur = lab.entries.find((e) => e.id === current);
  if (cur && good(cur) && best && yearly(best) < yearly(cur) + 0.1 * Math.abs(yearly(cur))) return cur;
  return best;
}

// Reads the lab and applies its pick to this run (settings + rules). Returns what is followed, or
// the previous choice when the lab cannot be read (a failed read never changes the strategy).
export async function followLab(settings: Settings, prev: LabFollow | undefined, log: (...m: unknown[]) => void): Promise<LabFollow | undefined> {
  let follow = prev;
  try {
    const r = await fetch(`${LAB_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) {
      const pick = pickStrategy(await r.json(), prev?.id);
      if (pick && pick.id !== prev?.id) {
        follow = { id: pick.id, spec: pick.spec, since: Date.now(), text: `bougies ${tfLabel(pick.spec.tf)}, seuil ${pick.spec.threshold}, environ ${Math.round(pick.m.perYear)} trades par an, ${pick.status}` };
        log(`labo : le bot suit maintenant ${pick.id} (${prev?.id ?? "stratégie AURUM 5 min"} avant)`);
      }
    } else log(`labo illisible (HTTP ${r.status}) : stratégie inchangée`);
  } catch (e) {
    log("labo illisible :", (e as Error).message, ": stratégie inchangée");
  }
  if (!follow) return undefined;
  const s = follow.spec;
  Object.assign(settings, { tf: s.tf, trainDays: s.trainDays, maxTradesDay: s.maxTradesDay });
  useStrategy({ ...LEGACY_M15, financingPctYear: 5, ...s.rules, fixedThreshold: s.threshold, realMoney: false });
  return follow;
}
