// Capital.com REST client for gold, written against the official reference (open-api.capital.com,
// Capital.com Public API 1.0.0). Demo and live accounts share the same API on two hosts.
//
// Session: POST /api/v1/session with the API key in X-CAP-API-KEY and the login + the API key's
// custom password in the body; the CST and X-SECURITY-TOKEN response headers authorise the next
// calls and stay valid 10 minutes after their last use. Opening a position returns a deal
// reference that must be confirmed with GET /api/v1/confirms/{dealReference}.
//
// Capital.com has no client labels on positions, so the bot keeps the deal ids it opened
// (`labels`, persisted sealed by the server) and never touches a position it did not open.
import type { BrokerApi, BrokerAccount, BrokerInstrument, BrokerPrice, BrokerTrade } from "../live";

export type CapitalEnv = "demo" | "live";

const HOSTS: Record<CapitalEnv, string> = {
  demo: "https://demo-api-capital.backend-capital.com",
  live: "https://api-capital.backend-capital.com",
};

export class CapitalError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (x: unknown) => (x === undefined || x === null || x === "" ? NaN : Number(x));
const utc = (s: unknown) => (typeof s === "string" ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : NaN);

// Plain-language reasons for the errors a person can fix
export function capitalMessage(code: string | undefined, status: number): string {
  if (status === 401 || code === "error.invalid.details") return "Capital.com refuse ces identifiants : vérifie l'identifiant, la clé API et son mot de passe.";
  if (code === "error.null.api.key" || code === "error.invalid.api.key") return "La clé API Capital.com est absente ou invalide.";
  if (status === 429 || code === "error.too-many.requests") return "Trop de requêtes vers Capital.com : nouvel essai au prochain passage.";
  if (code?.startsWith("error.invalid.stoploss") || code?.startsWith("error.invalid.takeprofit")) return `Stop ou objectif refusé par Capital.com (${code}).`;
  return code ? `Capital.com : ${code}` : `Capital.com : erreur HTTP ${status}`;
}

export class Capital implements BrokerApi {
  labels: Record<string, string> = {}; // dealId -> AURUM leg id
  private cst = "";
  private token = "";
  private currency = "";
  private lotSize = 1;
  private precision = 2;

  constructor(
    private readonly apiKey: string,
    private readonly identifier: string,
    private readonly password: string,
    readonly env: CapitalEnv,
    readonly epic = "GOLD"
  ) {}

  private async login(): Promise<void> {
    const r = await fetch(`${HOSTS[this.env]}/api/v1/session`, {
      method: "POST",
      headers: { "X-CAP-API-KEY": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: this.identifier, password: this.password, encryptedPassword: false }),
    });
    const json = (await r.json().catch(() => ({}))) as { errorCode?: string; currencyIsoCode?: string };
    if (!r.ok) throw new CapitalError(capitalMessage(json.errorCode, r.status), r.status, json.errorCode);
    this.cst = r.headers.get("CST") ?? "";
    this.token = r.headers.get("X-SECURITY-TOKEN") ?? "";
    this.currency = json.currencyIsoCode ?? "";
    if (!this.cst || !this.token) throw new CapitalError("Capital.com n'a pas renvoyé de jetons de session", r.status);
  }

  // Reads are retried on 429 / 5xx; a 401 re-opens the session once. Orders are never retried
  // blindly: an unclear answer can still be a filled order, the next run reconciles instead.
  private async req(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, attempt = 0): Promise<any> {
    if (!this.cst) await this.login();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    let r: Response;
    try {
      r = await fetch(`${HOSTS[this.env]}${path}`, {
        method,
        signal: ctl.signal,
        headers: { CST: this.cst, "X-SECURITY-TOKEN": this.token, "Content-Type": "application/json" },
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
      json = {};
    }
    if (r.status === 401 && attempt === 0) {
      this.cst = "";
      await sleep(1100); // POST /session: 1 request per second per key
      return this.req(method, path, body, 1);
    }
    if (method === "GET" && (r.status === 429 || r.status >= 500) && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      return this.req(method, path, body, attempt + 1);
    }
    if (!r.ok) throw new CapitalError(capitalMessage(json.errorCode, r.status), r.status, json.errorCode);
    return json;
  }

  private round(p: number) {
    return Number(p.toFixed(this.precision));
  }

  async instrument(): Promise<BrokerInstrument> {
    const m = await this.req("GET", `/api/v1/markets/${encodeURIComponent(this.epic)}`);
    const rules = m.dealingRules ?? {};
    this.precision = Number.isFinite(num(m.snapshot?.decimalPlacesFactor)) ? num(m.snapshot.decimalPlacesFactor) : 2;
    this.lotSize = num(m.instrument?.lotSize) || 1;
    const mf = num(m.instrument?.marginFactor);
    return {
      precision: this.precision,
      minUnits: num(rules.minDealSize?.value) || 1,
      unitsStep: num(rules.minSizeIncrement?.value) || num(rules.minDealSize?.value) || 1,
      marginRate: m.instrument?.marginFactorUnit === "PERCENTAGE" && mf > 0 ? mf / 100 : 0.05,
      valuePerPoint: this.lotSize,
    };
  }

  async account(): Promise<BrokerAccount> {
    const { accounts } = await this.req("GET", "/api/v1/accounts");
    const list = (accounts ?? []) as { preferred?: boolean; currency: string; balance: { balance: number; profitLoss: number; available: number } }[];
    const a = list.find((x) => x.preferred) ?? list[0];
    if (!a) throw new CapitalError("aucun compte Capital.com trouvé", 404);
    this.currency = a.currency;
    return { currency: a.currency, nav: num(a.balance.balance) + (num(a.balance.profitLoss) || 0), balance: num(a.balance.balance), unrealized: num(a.balance.profitLoss) || 0, marginAvailable: num(a.balance.available) };
  }

  // Gold is quoted in USD; a loss in USD becomes the account currency through the FX market
  private async usdToHome(): Promise<number> {
    const cur = this.currency || (await this.account()).currency;
    if (cur === "USD") return 1;
    const pair = { EUR: "EURUSD", GBP: "GBPUSD", AUD: "AUDUSD", NZD: "NZDUSD" }[cur];
    if (!pair) return NaN;
    const fx = await this.req("GET", `/api/v1/markets/${pair}`);
    const mid = (num(fx.snapshot?.bid) + num(fx.snapshot?.offer)) / 2;
    return mid > 0 ? 1 / mid : NaN;
  }

  async price(): Promise<BrokerPrice> {
    const m = await this.req("GET", `/api/v1/markets/${encodeURIComponent(this.epic)}`);
    return {
      bid: num(m.snapshot?.bid),
      ask: num(m.snapshot?.offer),
      tradeable: m.snapshot?.marketStatus === "TRADEABLE",
      toHome: await this.usdToHome(),
    };
  }

  // Only the positions this bot opened (known deal ids), never the owner's manual ones
  async openTrades(): Promise<BrokerTrade[]> {
    const { positions } = await this.req("GET", "/api/v1/positions");
    const out: BrokerTrade[] = [];
    for (const { position: p, market } of (positions ?? []) as { position: any; market: any }[]) {
      if (market?.epic !== this.epic || !this.labels[p.dealId]) continue;
      const size = num(p.size);
      out.push({
        id: p.dealId,
        clientId: this.labels[p.dealId],
        units: p.direction === "SELL" ? -size : size,
        price: num(p.level),
        openTime: utc(p.createdDateUTC) || 0,
        sl: Number.isFinite(num(p.stopLevel)) ? num(p.stopLevel) : null,
        tp: Number.isFinite(num(p.profitLevel)) ? num(p.profitLevel) : null,
        pl: num(p.upl) || 0,
        closeTime: null,
        closePrice: null,
      });
    }
    return out;
  }

  private async confirm(ref: string): Promise<any> {
    for (let k = 0; k < 5; k++) {
      try {
        return await this.req("GET", `/api/v1/confirms/${encodeURIComponent(ref)}`);
      } catch (e) {
        if (!(e instanceof CapitalError && e.status === 404) || k === 4) throw e;
        await sleep(400 * (k + 1)); // the confirmation can take a moment to exist
      }
    }
  }

  // Market order with its stop and target held by Capital.com (they work between server runs)
  async marketOrder(o: { units: number; sl: number; tp: number; clientId: string; comment: string }): Promise<{ tradeId: string; price: number }> {
    const { dealReference } = await this.req("POST", "/api/v1/positions", {
      epic: this.epic,
      direction: o.units > 0 ? "BUY" : "SELL",
      size: Math.abs(o.units),
      guaranteedStop: false,
      stopLevel: this.round(o.sl),
      profitLevel: this.round(o.tp),
    });
    const c = await this.confirm(dealReference);
    if (c?.dealStatus !== "ACCEPTED") throw new CapitalError(`ordre refusé par Capital.com (${c?.reason ?? c?.dealStatus ?? "sans raison"})`, 200, c?.reason);
    const dealId: string = c.affectedDeals?.find((d: { status: string }) => d.status === "OPENED")?.dealId ?? c.dealId;
    this.labels[dealId] = o.clientId;
    return { tradeId: dealId, price: num(c.level) };
  }

  async setStopLoss(t: BrokerTrade, price: number): Promise<void> {
    await this.req("PUT", `/api/v1/positions/${encodeURIComponent(t.id)}`, { stopLevel: this.round(price), ...(t.tp !== null ? { profitLevel: this.round(t.tp) } : {}) });
  }

  async close(t: BrokerTrade): Promise<{ price: number; pl: number }> {
    const { dealReference } = await this.req("DELETE", `/api/v1/positions/${encodeURIComponent(t.id)}`);
    const c = await this.confirm(dealReference).catch(() => null);
    delete this.labels[t.id];
    return { price: num(c?.level), pl: t.pl };
  }

  // Closed history is derived by the server from the positions it saw open (no labels here)
  async closedTrades(): Promise<BrokerTrade[]> {
    return [];
  }
}
