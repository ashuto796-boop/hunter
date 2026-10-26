// Synthetic gold market used when no live feed is reachable (offline / blocked region).
// Session-dependent volatility, volatility clustering, trending/ranging regimes and 8:30 NY news spikes.
import { Candle, Session } from "./types";
import { nyTime, sessionAt } from "./context";

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOL: Record<Session, number> = { ASIE: 0.55, LONDRES: 1.1, OVERLAP: 1.35, NEW_YORK: 1.15, ROLLOVER: 0.3, FERME: 0.05 };

export class GoldSimulator {
  private r: () => number;
  private price: number;
  private volState = 1;
  private drift = 0;
  private regimeLeft = 0;

  constructor(seed: number, start = 4000) {
    this.r = rng(seed);
    this.price = start;
  }

  private gauss() {
    const u = Math.max(1e-9, this.r());
    const v = this.r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  private stepRegime() {
    if (this.regimeLeft-- > 0) return;
    const x = this.r();
    this.drift = x < 0.3 ? 0.18 : x < 0.6 ? -0.18 : 0;
    this.regimeLeft = 40 + Math.floor(this.r() * 200);
  }

  candle(t: number, tfMin: number): Candle {
    this.stepRegime();
    const sess = sessionAt(t);
    const ny = nyTime(t);
    this.volState = Math.exp(0.96 * Math.log(this.volState) + 0.12 * this.gauss());
    const sigma = this.price * 0.0013 * Math.sqrt(tfMin / 15) * VOL[sess] * this.volState;
    const steps = 6;
    const o = this.price;
    let p = o;
    let h = o;
    let l = o;
    const news = ny.wd >= 1 && ny.wd <= 5 && ny.mins === 8 * 60 + 30 && this.r() < 0.35;
    for (let s = 0; s < steps; s++) {
      let dp = (sigma / Math.sqrt(steps)) * (this.gauss() + this.drift);
      if (news && s === 1) dp += sigma * 4 * (this.r() < 0.5 ? -1 : 1);
      p += dp;
      h = Math.max(h, p);
      l = Math.min(l, p);
    }
    h += Math.abs(this.gauss()) * sigma * 0.15;
    l -= Math.abs(this.gauss()) * sigma * 0.15;
    this.price = p;
    const v = Math.round(800 * VOL[sess] * (1 + Math.abs(p - o) / Math.max(sigma, 1e-9)) * (0.7 + 0.6 * this.r()));
    return { t, o: round(o), h: round(h), l: round(l), c: round(p), v };
  }

  history(end: number, count: number, tfMin: number): Candle[] {
    const ms = tfMin * 60000;
    const last = Math.floor(end / ms) * ms - ms;
    const out: Candle[] = [];
    for (let k = count - 1; k >= 0; k--) out.push(this.candle(last - k * ms, tfMin));
    return out;
  }

  // Small random move for the live tick stream
  tick(from: number, t: number): number {
    const sess = sessionAt(t);
    const sigma = from * 0.00009 * VOL[sess] * this.volState;
    this.price = from + sigma * this.gauss();
    return round(this.price);
  }
}

const round = (x: number) => Math.round(x * 100) / 100;
