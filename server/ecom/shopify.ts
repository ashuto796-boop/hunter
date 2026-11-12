// Shopify Admin GraphQL API. The agents read the shop, its policies, its products and the orders
// of the last 30 days (amounts and statuses only: no customer name, e-mail or address is ever
// requested), and the shop manager may create products as DRAFT. Nothing is ever published,
// deleted or priced live by an agent: publishing a draft stays your call in the Shopify admin.
//
// Access (repository secrets):
//   SHOPIFY_STORE          ma-boutique.myshopify.com
//   SHOPIFY_TOKEN          an Admin API access token (shpat_...), or instead:
//   SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET  of an app created in the Shopify Dev Dashboard and
//                          installed on the store (the token is fetched at each run).
// Scopes: read_products, write_products, read_orders, read_legal_policies (read_content optional).
import type { Order } from "../../src/ecom/shared/finance";
import type { ShopInfo } from "../../src/ecom/shared/types";

const API_VERSION = "2025-10";

export interface Policy {
  type: string;
  body: string;
}

export class Shopify {
  private constructor(private store: string, private token: string) {}

  static configured(): boolean {
    return !!process.env.SHOPIFY_STORE && (!!process.env.SHOPIFY_TOKEN || (!!process.env.SHOPIFY_CLIENT_ID && !!process.env.SHOPIFY_CLIENT_SECRET));
  }

  static async connect(): Promise<Shopify> {
    const store = (process.env.SHOPIFY_STORE ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(store)) throw new Error("SHOPIFY_STORE doit ressembler à ma-boutique.myshopify.com");
    if (process.env.SHOPIFY_TOKEN) return new Shopify(store, process.env.SHOPIFY_TOKEN.trim());
    const res = await fetch(`https://${store}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SHOPIFY_CLIENT_ID ?? "",
        client_secret: process.env.SHOPIFY_CLIENT_SECRET ?? "",
      }),
    });
    if (!res.ok) throw new Error(`jeton Shopify refusé (${res.status}) : vérifie SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET et que l'app est installée sur la boutique`);
    const j = (await res.json()) as { access_token?: string };
    if (!j.access_token) throw new Error("Shopify n'a pas renvoyé de jeton");
    return new Shopify(store, j.access_token);
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://${this.store}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.token },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 401 || res.status === 403) throw new Error(`Shopify refuse l'accès (${res.status}) : jeton invalide ou droits manquants`);
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Shopify ${res.status}`);
      const j = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
      if (j.errors?.some((e) => e.extensions?.code === "THROTTLED") && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (j.errors?.length) throw new Error(`Shopify : ${j.errors.map((e) => e.message).join(" ; ").slice(0, 300)}`);
      return j.data as T;
    }
  }

  async shop(): Promise<{ info: ShopInfo; policies: Policy[] }> {
    type R = {
      shop: { name: string; currencyCode: string; primaryDomain: { host: string }; shopPolicies: { type: string; body: string }[] };
      products: { nodes: { id: string; title: string; status: string; priceRangeV2: { minVariantPrice: { amount: string } } }[] };
    };
    const d = await this.gql<R>(`{
      shop { name currencyCode primaryDomain { host } shopPolicies { type body } }
      products(first: 100, sortKey: UPDATED_AT, reverse: true) {
        nodes { id title status priceRangeV2 { minVariantPrice { amount } } }
      }
    }`);
    const policies = d.shop.shopPolicies.filter((p) => p.body?.trim()).map((p) => ({ type: p.type, body: p.body }));
    return {
      info: {
        name: d.shop.name,
        domain: d.shop.primaryDomain.host,
        currency: d.shop.currencyCode,
        products: d.products.nodes.map((p) => ({ id: p.id, title: p.title, status: p.status, price: Number(p.priceRangeV2.minVariantPrice.amount) || null })),
        policies: policies.map((p) => p.type),
      },
      policies,
    };
  }

  async productTexts(limit = 15): Promise<{ title: string; status: string; text: string }[]> {
    type R = { products: { nodes: { title: string; status: string; description: string }[] } };
    const d = await this.gql<R>(`query($n: Int!) { products(first: $n, sortKey: UPDATED_AT, reverse: true) { nodes { title status description } } }`, { n: limit });
    return d.products.nodes.map((p) => ({ title: p.title, status: p.status, text: p.description.slice(0, 1200) }));
  }

  async orders(days: number): Promise<Order[]> {
    type Node = {
      createdAt: string;
      cancelledAt: string | null;
      displayFinancialStatus: string | null;
      displayFulfillmentStatus: string;
      totalPriceSet: { shopMoney: { amount: string } };
      totalRefundedSet: { shopMoney: { amount: string } };
      lineItems: { nodes: { quantity: number; originalUnitPriceSet: { shopMoney: { amount: string } }; variant: { inventoryItem: { unitCost: { amount: string } | null } } | null }[] };
    };
    type R = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Node[] } };
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const out: Order[] = [];
    let after: string | null = null;
    for (let page = 0; page < 40; page++) {
      const d: R = await this.gql<R>(
        `query($q: String!, $after: String) {
          orders(first: 50, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
            pageInfo { hasNextPage endCursor }
            nodes {
              createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus
              totalPriceSet { shopMoney { amount } }
              totalRefundedSet { shopMoney { amount } }
              lineItems(first: 10) { nodes { quantity originalUnitPriceSet { shopMoney { amount } } variant { inventoryItem { unitCost { amount } } } } }
            }
          }
        }`,
        { q: `created_at:>=${since}`, after },
      );
      for (const n of d.orders.nodes) {
        const fin = n.displayFinancialStatus ?? "";
        out.push({
          createdAt: n.createdAt,
          total: Number(n.totalPriceSet.shopMoney.amount) || 0,
          refunded: Number(n.totalRefundedSet.shopMoney.amount) || 0,
          cancelled: !!n.cancelledAt,
          paid: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "PARTIALLY_PAID"].includes(fin),
          fulfilled: n.displayFulfillmentStatus !== "UNFULFILLED" && n.displayFulfillmentStatus !== "ON_HOLD",
          items: n.lineItems.nodes.map((li) => ({
            qty: li.quantity,
            price: Number(li.originalUnitPriceSet.shopMoney.amount) || 0,
            unitCost: li.variant?.inventoryItem.unitCost ? Number(li.variant.inventoryItem.unitCost.amount) : null,
          })),
        });
      }
      if (!d.orders.pageInfo.hasNextPage) break;
      after = d.orders.pageInfo.endCursor;
    }
    return out;
  }

  // Always a DRAFT: it appears in Products > Drafts, you check it and publish it yourself.
  async createDraft(p: { title: string; descriptionHtml: string; productType: string; tags: string[]; seoTitle: string; seoDescription: string; price: number; compareAt: number | null; cost: number }): Promise<string> {
    type C = { productCreate: { product: { id: string; variants: { nodes: { id: string }[] } } | null; userErrors: { message: string }[] } };
    const c = await this.gql<C>(
      `mutation($product: ProductCreateInput!) {
        productCreate(product: $product) { product { id variants(first: 1) { nodes { id } } } userErrors { message } }
      }`,
      {
        product: {
          title: p.title,
          descriptionHtml: p.descriptionHtml,
          productType: p.productType,
          tags: [...p.tags, "agent-ia"],
          status: "DRAFT",
          seo: { title: p.seoTitle, description: p.seoDescription },
        },
      },
    );
    const prod = c.productCreate.product;
    if (!prod) throw new Error(`brouillon refusé : ${c.productCreate.userErrors.map((e) => e.message).join(" ; ")}`);
    const variant = prod.variants.nodes[0];
    if (variant) {
      type U = { productVariantsBulkUpdate: { userErrors: { message: string }[] } };
      const u = await this.gql<U>(
        `mutation($id: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $id, variants: $variants) { userErrors { message } }
        }`,
        {
          id: prod.id,
          variants: [
            {
              id: variant.id,
              price: p.price.toFixed(2),
              ...(p.compareAt && p.compareAt > p.price ? { compareAtPrice: p.compareAt.toFixed(2) } : {}),
              inventoryItem: { cost: p.cost.toFixed(2), tracked: false },
            },
          ],
        },
      );
      if (u.productVariantsBulkUpdate.userErrors.length) throw new Error(`prix du brouillon refusé : ${u.productVariantsBulkUpdate.userErrors.map((e) => e.message).join(" ; ")}`);
    }
    return prod.id;
  }
}
