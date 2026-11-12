// The money maths, in code and not left to the model: every euro shown comes from here.
import type { Kpis } from "./types";

export interface Costs {
  goalNetMonthEur: number;
  adSpendMonthEur: number; // what you actually spent on ads this month (you type it in config.json)
  fixedCostsMonthEur: number; // Shopify plan, apps, domain
  defaultCogsPct: number; // product cost as % of price when Shopify has no unit cost
  shipCostPerOrderEur: number; // supplier shipping when it is not included in the unit cost
  paymentFeePct: number;
  paymentFeeFixedEur: number;
  socialChargesPct: number; // micro-entreprise, sale of goods
  vatPct: number; // 0 under the VAT franchise, 20 otherwise
}

export interface Order {
  createdAt: string;
  total: number; // TTC, as paid
  refunded: number;
  cancelled: boolean;
  paid: boolean;
  fulfilled: boolean;
  items: { qty: number; unitCost: number | null; price: number }[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function orderCosts(o: Order, c: Costs): { cogs: number; estimated: boolean; fees: number } {
  let cogs = 0;
  let estimated = false;
  for (const it of o.items) {
    if (it.unitCost != null && it.unitCost > 0) cogs += it.unitCost * it.qty;
    else {
      cogs += (it.price * it.qty * c.defaultCogsPct) / 100;
      estimated = true;
    }
  }
  cogs += c.shipCostPerOrderEur;
  const fees = (o.total * c.paymentFeePct) / 100 + c.paymentFeeFixedEur;
  return { cogs, estimated, fees };
}

export function computeKpis(orders: Order[], c: Costs, currency: string, now = Date.now(), days = 30): Kpis {
  const since = now - days * 86_400_000;
  const list = orders.filter((o) => !o.cancelled && o.paid && Date.parse(o.createdAt) >= since);
  let revenue = 0;
  let refunded = 0;
  let cogs = 0;
  let fees = 0;
  let estimated = false;
  let late = 0;
  const byDay = new Map<string, { orders: number; revenue: number }>();
  for (const o of list) {
    const net = Math.max(0, o.total - o.refunded);
    revenue += net;
    refunded += o.refunded;
    const k = orderCosts(o, c);
    // a fully refunded order still cost the payment fee; its goods are counted as lost
    cogs += k.cogs;
    fees += k.fees;
    estimated ||= k.estimated;
    if (!o.fulfilled && now - Date.parse(o.createdAt) > 3 * 86_400_000) late++;
    const day = o.createdAt.slice(0, 10);
    const d = byDay.get(day) ?? { orders: 0, revenue: 0 };
    d.orders++;
    d.revenue += net;
    byDay.set(day, d);
  }
  const revenueHt = revenue / (1 + c.vatPct / 100);
  const adSpend = (c.adSpendMonthEur * days) / 30;
  const social = (revenueHt * c.socialChargesPct) / 100;
  const fixed = (c.fixedCostsMonthEur * days) / 30;
  const net = revenueHt - cogs - fees - adSpend - social - fixed;
  const avgBasket = list.length ? revenue / list.length : 0;
  // contribution before ads: what one euro of sales leaves once the goods, fees and charges are paid
  const contribution = revenueHt - cogs - fees - social;
  const breakEvenRoas = contribution > 0 ? revenue / contribution : null;
  // orders a day for the goal, if each order keeps its current margin and ads cost what they cost now
  const perOrder = list.length ? (contribution - adSpend) / list.length : null;
  const ordersPerDayNeeded = perOrder && perOrder > 0 ? (c.goalNetMonthEur + c.fixedCostsMonthEur) / perOrder / 30 : null;
  const daily: Kpis["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    const d = byDay.get(day);
    daily.push({ day, orders: d?.orders ?? 0, revenue: r2(d?.revenue ?? 0) });
  }
  return {
    at: now,
    currency,
    days,
    orders: list.length,
    revenue: r2(revenue),
    revenueHt: r2(revenueHt),
    avgBasket: r2(avgBasket),
    cogs: r2(cogs),
    cogsEstimated: estimated,
    fees: r2(fees),
    adSpend: r2(adSpend),
    social: r2(social),
    fixed: r2(fixed),
    net: r2(net),
    netMonthPace: r2((net * 30) / days),
    goal: c.goalNetMonthEur,
    breakEvenRoas: breakEvenRoas ? r2(breakEvenRoas) : null,
    ordersPerDayNeeded: ordersPerDayNeeded ? Math.ceil(ordersPerDayNeeded * 10) / 10 : null,
    unfulfilledLate: late,
    refundRate: revenue + refunded > 0 ? r2(refunded / (revenue + refunded)) : 0,
    daily,
  };
}

// Unit economics of one product, used by the sourcing agent and by the simulator in the app.
export function unitEconomics(priceTtc: number, costEur: number, c: Pick<Costs, "paymentFeePct" | "paymentFeeFixedEur" | "socialChargesPct" | "vatPct">) {
  const ht = priceTtc / (1 + c.vatPct / 100);
  const fees = (priceTtc * c.paymentFeePct) / 100 + c.paymentFeeFixedEur;
  const social = (ht * c.socialChargesPct) / 100;
  const margin = ht - costEur - fees - social; // before ads
  return { margin: r2(margin), breakEvenRoas: margin > 0 ? r2(priceTtc / margin) : 99 };
}

// What 10 000 € net a month takes, for a given basket, product cost and ad cost per sale.
export function goalPlan(goal: number, basket: number, costPct: number, cpa: number, c: Costs) {
  const u = unitEconomics(basket, (basket * costPct) / 100, c);
  const perOrder = u.margin - cpa;
  if (perOrder <= 0) return { perOrder: r2(perOrder), ordersMonth: null, ordersDay: null, revenueMonth: null, adsMonth: null };
  const ordersMonth = Math.ceil((goal + c.fixedCostsMonthEur) / perOrder);
  return {
    perOrder: r2(perOrder),
    ordersMonth,
    ordersDay: Math.ceil(ordersMonth / 30),
    revenueMonth: Math.round(ordersMonth * basket),
    adsMonth: Math.round(ordersMonth * cpa),
  };
}
