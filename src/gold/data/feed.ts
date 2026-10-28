// Market data: gold perpetuals (XAUUSDT on Binance, then on Bitget, which also answers from US
// servers), tokenised gold (PAXG) as fallback, and a local simulator when no exchange is
// reachable. All endpoints are public (no API key).
import { Candle, NewsEvent } from "../engine/types";
import { Peers } from "../engine/features";
import { GoldSimulator } from "../engine/sim";

export type SourceId = "xau" | "bitget" | "paxg" | "sim";

export interface Source {
  id: SourceId;
  api: "binance" | "bitget";
  label: string;
  short: string;
  rest: string;
  ws: string;
  symbol: string;
  maxLimit: number;
}

export const SOURCES: Record<SourceId, Source> = {
  xau: {
    id: "xau",
    api: "binance",
    label: "Or XAU/USDT · Binance Futures",
    short: "XAU/USD",
    rest: "https://fapi.binance.com/fapi/v1/klines",
    ws: "wss://fstream.binance.com/ws/",
    symbol: "XAUUSDT",
    maxLimit: 1500,
  },
  bitget: {
    id: "bitget",
    api: "bitget",
    label: "Or XAU/USDT · Bitget",
    short: "XAU/USD",
    rest: "https://api.bitget.com/api/v2/mix/market",
    ws: "", // REST polling
    symbol: "XAUUSDT",
    maxLimit: 1000,
  },
  paxg: {
    id: "paxg",
    api: "binance",
    label: "PAX Gold PAXG/USDT · Binance",
    short: "PAXG",
    rest: "https://data-api.binance.vision/api/v3/klines",
    ws: "wss://data-stream.binance.vision/ws/",
    symbol: "PAXGUSDT",
    maxLimit: 1000,
  },
  sim: {
    id: "sim",
    api: "binance",
    label: "Marché simulé (hors ligne)",
    short: "SIMU",
    rest: "",
    ws: "",
    symbol: "SIM",
    maxLimit: 1000,
  },
};

// Correlated markets for the intermarket radar (H1): silver perpetual and EUR/USD (dollar proxy),
// each with a second exchange to try when the first one is out of reach
type Endpoint = Pick<Source, "api" | "rest" | "symbol" | "maxLimit">;
const PEERS: Record<keyof Peers, Endpoint[]> = {
  xag: [
    { api: "binance", rest: SOURCES.xau.rest, symbol: "XAGUSDT", maxLimit: 1500 },
    { api: "bitget", rest: SOURCES.bitget.rest, symbol: "XAGUSDT", maxLimit: 1000 },
  ],
  eur: [{ api: "binance", rest: SOURCES.paxg.rest, symbol: "EURUSDT", maxLimit: 1000 }],
};

const interval = (tf: number) => (tf % 60 === 0 ? `${tf / 60}h` : `${tf}m`);
const bitgetGranularity = (tf: number) => (tf % 60 === 0 ? `${tf / 60}H` : `${tf}m`);

async function getJson(url: string, timeoutMs = 10000): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const toCandles = (rows: (string | number)[][]) => rows.map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }));

// Bitget answers with the latest candles before endTime: "candles" covers about the last 30 days
// (up to 1000 per call), "history-candles" goes further back (200 per call). Oldest first.
async function bitgetPage(src: Endpoint, tf: number, endpoint: "candles" | "history-candles", limit: number, end?: number): Promise<Candle[]> {
  let url = `${src.rest}/${endpoint}?symbol=${src.symbol}&productType=USDT-FUTURES&granularity=${bitgetGranularity(tf)}&limit=${limit}`;
  if (end !== undefined) url += `&endTime=${end}`;
  const body = (await getJson(url)) as { data?: (string | number)[][] };
  return toCandles(body.data ?? []).sort((a, b) => a.t - b.t);
}

// Returns candles oldest first; the last one may still be forming.
export async function fetchKlines(src: Endpoint, tf: number, opts: { start?: number; limit?: number } = {}): Promise<Candle[]> {
  if (src.api === "bitget") {
    const rows = await bitgetPage(src, tf, "candles", Math.min(opts.limit ?? src.maxLimit, 1000));
    return opts.start === undefined ? rows : rows.filter((k) => k.t >= opts.start!);
  }
  let url = `${src.rest}?symbol=${src.symbol}&interval=${interval(tf)}&limit=${opts.limit ?? src.maxLimit}`;
  if (opts.start !== undefined) url += `&startTime=${opts.start}`;
  return toCandles((await getJson(url)) as (string | number)[][]);
}

async function bitgetHistory(src: Endpoint, tf: number, from: number, onProgress?: (p: number) => void): Promise<Candle[]> {
  const now = Date.now();
  const byT = new Map<number, Candle>();
  let end: number | undefined;
  for (let guard = 0; guard < 250; guard++) {
    let batch = await bitgetPage(src, tf, "candles", 1000, end);
    if (!batch.length) batch = await bitgetPage(src, tf, "history-candles", 200, end);
    if (!batch.length) break;
    for (const k of batch) byT.set(k.t, k);
    end = batch[0].t - 1;
    onProgress?.(Math.min(1, (now - end) / (now - from)));
    if (end <= from) break;
  }
  return [...byT.values()].filter((k) => k.t >= from).sort((a, b) => a.t - b.t);
}

export async function probe(src: Source, tf: number): Promise<boolean> {
  try {
    const k = await fetchKlines(src, tf, { limit: 3 });
    return k.length > 0 && k[k.length - 1].c > 0;
  } catch {
    return false;
  }
}

export async function fetchHistory(src: Endpoint, tf: number, days: number, onProgress?: (p: number) => void): Promise<Candle[]> {
  const ms = tf * 60000;
  const now = Date.now();
  const from = now - days * 864e5;
  if (src.api === "bitget") return bitgetHistory(src, tf, from, onProgress);
  let start = from;
  const byT = new Map<number, Candle>();
  for (let guard = 0; guard < 80 && start < now; guard++) {
    const batch = await fetchKlines(src, tf, { start });
    if (!batch.length) break;
    for (const k of batch) byT.set(k.t, k);
    start = batch[batch.length - 1].t + ms;
    onProgress?.(Math.min(1, (start - from) / (now - from)));
    if (batch.length < src.maxLimit) break;
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

export interface FeedHandlers {
  onTick: (forming: Candle) => void;
  onClose: (closed: Candle) => void;
  onStatus: (s: "live" | "polling" | "reconnecting") => void;
}

export interface Feed {
  start(): void;
  stop(): void;
}

// Binance WebSocket kline stream with automatic REST polling fallback (REST only for Bitget)
export class ExchangeFeed implements Feed {
  private ws: WebSocket | null = null;
  private pollTimer: number | undefined;
  private watchdog: number | undefined;
  private lastMsg = 0;
  private lastClosedT = 0;
  private stopped = false;
  private failures = 0;

  constructor(private src: Source, private tf: number, private h: FeedHandlers) {}

  start() {
    this.stopped = false;
    this.connect();
    this.watchdog = window.setInterval(() => this.check(), 5000);
  }

  stop() {
    this.stopped = true;
    window.clearInterval(this.watchdog);
    window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.ws?.close();
    this.ws = null;
  }

  private connect() {
    if (this.stopped) return;
    if (!this.src.ws) {
      this.startPolling();
      return;
    }
    try {
      this.ws?.close();
      const ws = new WebSocket(`${this.src.ws}${this.src.symbol.toLowerCase()}@kline_${interval(this.tf)}`);
      this.ws = ws;
      ws.onmessage = (ev) => {
        this.lastMsg = Date.now();
        this.failures = 0;
        if (this.pollTimer !== undefined) {
          window.clearInterval(this.pollTimer);
          this.pollTimer = undefined;
        }
        this.h.onStatus("live");
        const m = JSON.parse(ev.data as string);
        const k = m.k ?? m.data?.k;
        if (!k) return;
        const c: Candle = { t: +k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v };
        if (k.x) {
          if (c.t > this.lastClosedT) {
            this.lastClosedT = c.t;
            this.h.onClose(c);
          }
        } else this.h.onTick(c);
      };
      ws.onclose = () => {
        if (this.stopped) return;
        this.failures++;
        if (this.pollTimer === undefined) this.h.onStatus("reconnecting");
        window.setTimeout(() => this.connect(), Math.min(30000, 2000 * this.failures));
      };
      ws.onerror = () => ws.close();
    } catch {
      this.startPolling();
    }
  }

  private check() {
    if (this.stopped) return;
    if (Date.now() - this.lastMsg > 15000) this.startPolling();
  }

  private startPolling() {
    if (this.pollTimer !== undefined) return;
    this.h.onStatus("polling");
    const poll = async () => {
      try {
        const k = await fetchKlines(this.src, this.tf, { limit: 3 });
        const forming = k[k.length - 1];
        for (const c of k.slice(0, -1)) {
          if (c.t <= this.lastClosedT) continue;
          this.lastClosedT = c.t;
          this.h.onClose(c);
        }
        this.h.onStatus("polling");
        this.h.onTick(forming);
      } catch {
        this.h.onStatus("reconnecting");
      }
    };
    poll();
    this.pollTimer = window.setInterval(poll, 2500);
  }

  // Must be called with the last closed candle of the loaded history before start()
  setLastClosed(t: number) {
    this.lastClosedT = Math.max(this.lastClosedT, t);
  }
}

// Offline simulator streaming ticks every second, closing candles on real clock boundaries
export class SimFeed implements Feed {
  private timer: number | undefined;
  private forming: Candle | null = null;

  constructor(private sim: GoldSimulator, private tf: number, private lastClose: number, private h: FeedHandlers) {}

  start() {
    this.h.onStatus("live");
    this.timer = window.setInterval(() => this.step(), 1000);
  }

  stop() {
    window.clearInterval(this.timer);
  }

  private step() {
    const ms = this.tf * 60000;
    const now = Date.now();
    const bucket = Math.floor(now / ms) * ms;
    if (this.forming && this.forming.t < bucket) {
      this.h.onClose(this.forming);
      this.lastClose = this.forming.c;
      this.forming = null;
    }
    if (!this.forming) this.forming = { t: bucket, o: this.lastClose, h: this.lastClose, l: this.lastClose, c: this.lastClose, v: 0 };
    const p = this.sim.tick(this.forming.c, now);
    const f = this.forming;
    f.c = p;
    f.h = Math.max(f.h, p);
    f.l = Math.min(f.l, p);
    f.v += Math.round(5 + Math.random() * 20);
    this.h.onTick({ ...f });
  }
}

const closedOnly = (c: Candle[], tf: number) => c.filter((k) => k.t + tf * 60000 <= Date.now());

// Best effort: a missing peer just leaves the radar neutral
export async function fetchPeers(days: number): Promise<Peers> {
  const get = async (list: Endpoint[]) => {
    for (const e of list) {
      const c = await fetchHistory(e, 60, days)
        .then((x) => closedOnly(x, 60))
        .catch(() => [] as Candle[]);
      if (c.length) return c;
    }
    return [] as Candle[];
  };
  const [xag, eur] = await Promise.all([get(PEERS.xag), get(PEERS.eur)]);
  return { xag, eur };
}

async function latestPeer(list: Endpoint[]): Promise<Candle[]> {
  for (const e of list) {
    try {
      return await fetchKlines(e, 60, { limit: 6 });
    } catch {
      /* try the next exchange */
    }
  }
  return [];
}

// Appends the latest closed H1 bars; returns true when something changed
export async function refreshPeers(peers: Peers, maxLen: number): Promise<boolean> {
  let changed = false;
  for (const key of ["xag", "eur"] as const) {
    const list = peers[key];
    if (!list?.length) continue;
    try {
      const fresh = closedOnly(await latestPeer(PEERS[key]), 60);
      for (const k of fresh) {
        if (k.t <= list[list.length - 1].t) continue;
        list.push(k);
        changed = true;
      }
      if (list.length > maxLen) list.splice(0, list.length - maxLen);
    } catch {
      /* keep the previous bars */
    }
  }
  return changed;
}

// High-impact USD events from the public ForexFactory weekly calendar (best effort)
export async function fetchNews(): Promise<NewsEvent[]> {
  try {
    const rows = (await getJson("https://nfs.faireconomy.media/ff_calendar_thisweek.json", 6000)) as {
      title: string;
      country: string;
      date: string;
      impact: string;
    }[];
    return rows
      .filter((r) => r.country === "USD" && r.impact === "High")
      .map((r) => ({ t: Date.parse(r.date), title: r.title, before: 30, after: 30 }))
      .filter((e) => !Number.isNaN(e.t));
  } catch {
    return [];
  }
}
