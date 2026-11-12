// CJ Dropshipping API 2.0, read-only: product search, variants, stock by warehouse and shipping
// quotes to France, handed to the sourcing agent as hard data next to its web research.
// Nothing here places an order. Secret: CJ_API_KEY (CJ > Authorization > API). Any error is
// logged and the agent falls back to web research alone.
const BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (x: unknown) => {
  const n = parseFloat(String(x ?? "").split("-")[0]);
  return Number.isFinite(n) ? n : null;
};

export const cjConfigured = () => !!process.env.CJ_API_KEY;

export interface CjOffer {
  product: string;
  pid: string;
  priceUsd: number | null;
  weightG: number | null;
  euStock: string[]; // EU warehouses holding stock (country codes)
  shipping: { from: string; method: string; priceUsd: number | null; days: string }[];
}

type Envelope<T> = { code?: number; result?: boolean; message?: string; data?: T };

export class CJ {
  private constructor(private token: string) {}

  static async connect(): Promise<CJ> {
    const res = await fetch(`${BASE}/authentication/getAccessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: process.env.CJ_API_KEY }),
    });
    const j = (await res.json()) as Envelope<{ accessToken?: string }>;
    if (!j.data?.accessToken) throw new Error(`CJ refuse la clé : ${j.message ?? res.status}`.slice(0, 200));
    return new CJ(j.data.accessToken);
  }

  // CJ allows about one request per second on a free account
  private async call<T>(path: string, init: { query?: Record<string, string>; body?: unknown } = {}): Promise<T | null> {
    await wait(1100);
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method: init.body ? "POST" : "GET",
      headers: { "CJ-Access-Token": this.token, "Content-Type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const j = (await res.json().catch(() => ({}))) as Envelope<T>;
    if (!res.ok || j.result === false) throw new Error(`CJ ${path} : ${j.message ?? res.status}`.slice(0, 200));
    return j.data ?? null;
  }

  async offers(keyword: string, max = 3): Promise<CjOffer[]> {
    type P = { pid: string; productNameEn: string; sellPrice?: string | number; productWeight?: string | number };
    const list = await this.call<{ list?: P[] }>("/product/list", { query: { productNameEn: keyword, pageNum: "1", pageSize: String(max) } });
    const out: CjOffer[] = [];
    for (const p of (list?.list ?? []).slice(0, max)) {
      const offer: CjOffer = { product: p.productNameEn.slice(0, 120), pid: p.pid, priceUsd: num(p.sellPrice), weightG: num(p.productWeight), euStock: [], shipping: [] };
      try {
        type V = { vid: string; variantSellPrice?: string | number };
        const variants = await this.call<V[]>("/product/variant/query", { query: { pid: p.pid } });
        const v = variants?.[0];
        if (v) {
          offer.priceUsd = num(v.variantSellPrice) ?? offer.priceUsd;
          type S = { countryCode?: string; areaEn?: string; storageNum?: number; totalInventoryNum?: number };
          const stock = (await this.call<S[]>("/product/stock/queryByVid", { query: { vid: v.vid } }).catch(() => null)) ?? [];
          const EU = ["DE", "FR", "ES", "IT", "NL", "PL", "BE", "CZ", "PT"];
          offer.euStock = stock.filter((s) => EU.includes(String(s.countryCode ?? "").toUpperCase()) && ((s.storageNum ?? s.totalInventoryNum ?? 0) > 0)).map((s) => String(s.countryCode).toUpperCase());
          for (const from of [...new Set([...offer.euStock.slice(0, 1), "CN"])]) {
            type F = { logisticName: string; logisticPrice?: number | string; logisticAging?: string };
            const quotes = (await this.call<F[]>("/logistic/freightCalculate", { body: { startCountryCode: from, endCountryCode: "FR", products: [{ quantity: 1, vid: v.vid }] } }).catch(() => null)) ?? [];
            const best = quotes.filter((q) => num(q.logisticPrice) != null).sort((a, b) => (num(a.logisticPrice) ?? 0) - (num(b.logisticPrice) ?? 0))[0];
            if (best) offer.shipping.push({ from, method: best.logisticName.slice(0, 40), priceUsd: num(best.logisticPrice), days: String(best.logisticAging ?? "?").slice(0, 20) });
          }
        }
      } catch {
        /* a product with missing details is still worth listing */
      }
      out.push(offer);
    }
    return out;
  }
}
