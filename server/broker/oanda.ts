// Minimal OANDA v20 REST client for gold (XAU_USD), written against the official reference
// (developer.oanda.com/rest-live-v20). Practice and live accounts share the same API.
export type OandaEnv = "practice" | "live";

const HOSTS: Record<OandaEnv, string> = {
  practice: "https://api-fxpractice.oanda.com",
  live: "https://api-fxtrade.oanda.com",
};

export const INSTRUMENT = "XAU_USD";
export const TAG = "aurum";

export interface OandaAccount {
  currency: string;
  nav: number;
  balance: number;
  unrealized: number;
  marginAvailable: number;
}

export interface OandaPrice {
  bid: number;
  ask: number;
  tradeable: boolean;
  toHome: number; // converts a loss in USD (quote currency) into the account currency
}

export interface OandaInstrument {
  precision: number; // decimals allowed in prices
  unitsPrecision: number; // decimals allowed in units (0 for gold: whole ounces)
  minUnits: number;
  marginRate: number;
}

export interface OandaTrade {
  id: string;
  clientId: string | null;
  units: number; // signed, current
  price: number;
  openTime: number;
  sl: number | null;
  tp: number | null;
  pl: number; // unrealized for open trades, realized for closed ones
  closeTime: number | null;
  closePrice: number | null;
}

export class OandaError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (x: unknown) => (x === undefined || x === null || x === "" ? NaN : Number(x));
const unix = (x: unknown) => (x ? Math.round(Number(x) * 1000) : null); // Accept-Datetime-Format: UNIX

interface RawTrade {
  id: string;
  price: string;
  openTime: string;
  currentUnits: string;
  initialUnits: string;
  unrealizedPL?: string;
  realizedPL?: string;
  closeTime?: string;
  averageClosePrice?: string;
  clientExtensions?: { id?: string; tag?: string };
  stopLossOrder?: { price?: string };
  takeProfitOrder?: { price?: string };
  instrument: string;
}

// TradeSpecifier: the client ID prefixed with "@", or OANDA's own trade ID
const spec = (t: OandaTrade) => (t.clientId ? `@${encodeURIComponent(t.clientId)}` : t.id);

function toTrade(t: RawTrade, closed: boolean): OandaTrade {
  return {
    id: t.id,
    clientId: t.clientExtensions?.id ?? null,
    units: num(closed ? t.initialUnits : t.currentUnits),
    price: num(t.price),
    openTime: unix(t.openTime) ?? 0,
    sl: t.stopLossOrder?.price ? num(t.stopLossOrder.price) : null,
    tp: t.takeProfitOrder?.price ? num(t.takeProfitOrder.price) : null,
    pl: num(closed ? t.realizedPL : t.unrealizedPL) || 0,
    closeTime: unix(t.closeTime),
    closePrice: t.averageClosePrice ? num(t.averageClosePrice) : null,
  };
}

export class Oanda {
  private precision = 3;

  constructor(
    private readonly token: string,
    private readonly accountId: string,
    readonly env: OandaEnv
  ) {}

  private px(p: number): string {
    return p.toFixed(this.precision);
  }

  // Reads are retried on 429 / 5xx. Orders and closes are never retried blindly: a failed
  // reply can still mean a filled order, so the next run reconciles from the account instead.
  private async req(method: "GET" | "POST" | "PUT", path: string, body?: unknown, attempt = 0): Promise<any> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    let r: Response;
    try {
      r = await fetch(`${HOSTS[this.env]}/v3/accounts/${this.accountId}${path}`, {
        method,
        signal: ctl.signal,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", "Accept-Datetime-Format": "UNIX" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await r.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { errorMessage: text.slice(0, 200) };
    }
    if (method === "GET" && (r.status === 429 || r.status >= 500) && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      return this.req(method, path, body, attempt + 1);
    }
    if (!r.ok) throw new OandaError(json.errorMessage ?? `HTTP ${r.status}`, r.status, json.errorCode);
    return json;
  }

  async account(): Promise<OandaAccount> {
    const { account: a } = await this.req("GET", "/summary");
    return { currency: a.currency, nav: num(a.NAV), balance: num(a.balance), unrealized: num(a.unrealizedPL), marginAvailable: num(a.marginAvailable) };
  }

  // Price precision, unit size and margin of gold on this account (also sets the price rounding)
  async instrument(): Promise<OandaInstrument> {
    const { instruments } = await this.req("GET", `/instruments?instruments=${INSTRUMENT}`);
    const i = instruments?.[0];
    if (!i) throw new OandaError("XAU_USD n'est pas disponible sur ce compte", 404);
    this.precision = Number(i.displayPrecision ?? 3);
    return { precision: this.precision, unitsPrecision: Number(i.tradeUnitsPrecision ?? 0), minUnits: num(i.minimumTradeSize) || 1, marginRate: num(i.marginRate) || 0.05 };
  }

  async price(): Promise<OandaPrice> {
    const { prices } = await this.req("GET", `/pricing?instruments=${INSTRUMENT}`);
    const p = prices?.[0];
    if (!p) throw new OandaError("pas de prix pour XAU_USD", 404);
    const f = p.quoteHomeConversionFactors;
    return {
      bid: num(p.bids?.[0]?.price ?? p.closeoutBid),
      ask: num(p.asks?.[0]?.price ?? p.closeoutAsk),
      tradeable: p.tradeable ?? p.status === "tradeable",
      toHome: f ? Math.max(num(f.negativeUnits), num(f.positiveUnits)) : NaN,
    };
  }

  async openTrades(): Promise<OandaTrade[]> {
    const { trades } = await this.req("GET", "/openTrades");
    return (trades as RawTrade[]).filter((t) => t.instrument === INSTRUMENT && t.clientExtensions?.tag === TAG).map((t) => toTrade(t, false));
  }

  async closedTrades(count = 30): Promise<OandaTrade[]> {
    const { trades } = await this.req("GET", `/trades?state=CLOSED&instrument=${INSTRUMENT}&count=${count}`);
    return (trades as RawTrade[]).filter((t) => t.clientExtensions?.tag === TAG).map((t) => toTrade(t, true));
  }

  // Market order with its stop and its target, both held by OANDA: they work even when the
  // server is not running. Fill-or-kill: filled at once in full, or not at all.
  async marketOrder(o: { units: number; sl: number; tp: number; clientId: string; comment: string }): Promise<{ tradeId: string; price: number }> {
    const ext = { id: o.clientId, tag: TAG, comment: o.comment.slice(0, 120) };
    const orderExt = { ...ext, id: `${o.clientId}-o` }; // orders and trades keep separate IDs
    const res = await this.req("POST", "/orders", {
      order: {
        type: "MARKET",
        instrument: INSTRUMENT,
        units: String(Math.trunc(o.units)),
        timeInForce: "FOK",
        positionFill: "DEFAULT",
        stopLossOnFill: { price: this.px(o.sl), timeInForce: "GTC" },
        takeProfitOnFill: { price: this.px(o.tp), timeInForce: "GTC" },
        clientExtensions: orderExt,
        tradeClientExtensions: ext,
      },
    });
    const opened = res.orderFillTransaction?.tradeOpened;
    if (!opened) {
      const why = res.orderCancelTransaction?.reason ?? "ordre non exécuté";
      throw new OandaError(`ordre annulé par OANDA (${why})`, 200, why);
    }
    return { tradeId: opened.tradeID, price: num(opened.price) };
  }

  async setStopLoss(t: OandaTrade, price: number): Promise<void> {
    await this.req("PUT", `/trades/${spec(t)}/orders`, { stopLoss: { price: this.px(price), timeInForce: "GTC" } });
  }

  async close(t: OandaTrade): Promise<{ price: number; pl: number }> {
    const res = await this.req("PUT", `/trades/${spec(t)}/close`, { units: "ALL" });
    const f = res.orderFillTransaction;
    return { price: num(f?.tradesClosed?.[0]?.price ?? f?.price), pl: num(f?.pl) || 0 };
  }
}
