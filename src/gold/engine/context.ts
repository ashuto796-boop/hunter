// Market clock for gold: sessions, killzones, trading-day boundaries and news blackouts.
// Gold (XAU) trades Sunday 18:00 -> Friday 17:00 New York time, with a daily 17:00-18:00 break.
import { NewsEvent, Session } from "./types";

const NY = "America/New_York";
const LDN = "Europe/London";
const HOUR = 3_600_000;

const formatters: Record<string, Intl.DateTimeFormat> = {};
const offsets = new Map<string, number>();

// UTC offset of a time zone in minutes, cached per hour (DST switches happen on hour boundaries)
function tzOffset(tz: string, t: number): number {
  const hb = Math.floor(t / HOUR);
  const key = tz + hb;
  let off = offsets.get(key);
  if (off === undefined) {
    const f = (formatters[tz] ??= new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }));
    const p: Record<string, string> = {};
    for (const part of f.formatToParts(new Date(hb * HOUR))) p[part.type] = part.value;
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    off = (asUtc - hb * HOUR) / 60000;
    offsets.set(key, off);
  }
  return off;
}

export interface LocalTime {
  wd: number; // 0 = Sunday
  mins: number; // minutes since local midnight
  ymd: string;
}

export function localTime(tz: string, t: number): LocalTime {
  const d = new Date(t + tzOffset(tz, t) * 60000);
  return { wd: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes(), ymd: d.toISOString().slice(0, 10) };
}

export const nyTime = (t: number) => localTime(NY, t);
export const londonTime = (t: number) => localTime(LDN, t);

// Gold trading day starts at 18:00 New York, so shift by 6h before taking the NY date.
export function tradingDay(t: number): string {
  return localTime(NY, t + 6 * HOUR).ymd;
}

export function marketClosed(t: number): boolean {
  const ny = nyTime(t);
  return ny.wd === 6 || (ny.wd === 5 && ny.mins >= 17 * 60) || (ny.wd === 0 && ny.mins < 18 * 60);
}

export function sessionAt(t: number): Session {
  if (marketClosed(t)) return "FERME";
  const ny = nyTime(t);
  if (ny.mins >= 17 * 60 && ny.mins < 18 * 60) return "ROLLOVER";
  const ld = londonTime(t);
  const inLondon = ld.mins >= 7 * 60 && ld.mins < 16 * 60 + 30;
  const inNY = ny.mins >= 8 * 60 && ny.mins < 17 * 60;
  if (inLondon && inNY) return "OVERLAP";
  if (inLondon) return "LONDRES";
  if (inNY) return "NEW_YORK";
  return "ASIE";
}

export function killzone(t: number): string | null {
  const ld = londonTime(t);
  if (ld.wd >= 1 && ld.wd <= 5 && ld.mins >= 7 * 60 && ld.mins < 10 * 60) return "Killzone Londres";
  const ny = nyTime(t);
  if (ny.wd >= 1 && ny.wd <= 5 && ny.mins >= 8 * 60 + 30 && ny.mins < 11 * 60) return "Killzone New York";
  return null;
}

export const SESSION_QUALITY: Record<Session, number> = {
  OVERLAP: 1.05,
  LONDRES: 1,
  NEW_YORK: 0.97,
  ASIE: 0.7,
  ROLLOVER: 0,
  FERME: 0,
};

export const SESSION_LABEL: Record<Session, string> = {
  OVERLAP: "Londres + New York",
  LONDRES: "Session de Londres",
  NEW_YORK: "Session New York",
  ASIE: "Session asiatique",
  ROLLOVER: "Rollover (pause)",
  FERME: "Marché fermé",
};

// Friday afternoon: no new risk before the weekend gap
export function weekendRisk(t: number): "no-entry" | "flatten" | null {
  const ny = nyTime(t);
  if (ny.wd !== 5) return null;
  if (ny.mins >= 16 * 60 + 30) return "flatten";
  if (ny.mins >= 14 * 60) return "no-entry";
  return null;
}

// FOMC 2026 decision days (statement at 14:00 New York)
const FOMC_2026 = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"];

export function newsBlock(t: number, events: NewsEvent[]): string | null {
  const ny = nyTime(t);
  const weekday = ny.wd >= 1 && ny.wd <= 5;
  if (weekday && FOMC_2026.includes(ny.ymd) && ny.mins >= 13 * 60 + 30 && ny.mins < 15 * 60 + 30) {
    return "Décision de la FED (FOMC) — je reste à l'écart";
  }
  const day = +ny.ymd.slice(8, 10);
  if (ny.wd === 5 && day <= 7 && ny.mins >= 8 * 60 && ny.mins < 9 * 60 + 30) {
    return "NFP (emploi US) — volatilité extrême, pas d'entrée";
  }
  if (weekday && ny.mins >= 8 * 60 + 20 && ny.mins < 8 * 60 + 50) {
    return "Fenêtre des statistiques US de 8h30 — pas d'entrée";
  }
  for (const e of events) {
    if (t >= e.t - e.before * 60000 && t <= e.t + e.after * 60000) return `Annonce : ${e.title}`;
  }
  return null;
}
