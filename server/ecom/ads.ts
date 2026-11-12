// Read-only ad results from Meta (Facebook / Instagram) and TikTok, so the media buyer works on
// real numbers and the finance agent on real ad spend. Nothing here can create, change or pause
// an ad: it only reads reports. Each platform is optional and fails soft (the error is logged and
// the agents carry on without it).
//
// Secrets: META_ACCESS_TOKEN + META_AD_ACCOUNT_ID (digits, with or without "act_"),
//          TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID.
import type { AdLine, AdsSnapshot, PlatformAds } from "../../src/ecom/shared/types";

const num = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

export const adsConfigured = () =>
  (!!process.env.META_ACCESS_TOKEN && !!process.env.META_AD_ACCOUNT_ID) || (!!process.env.TIKTOK_ACCESS_TOKEN && !!process.env.TIKTOK_ADVERTISER_ID);

// ---------------------------------------------------------------------------------------------
// Meta Marketing API (Insights)

type MetaAction = { action_type: string; value: string };
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
// one purchase type only, in this order, so the same purchase is never counted twice
function metaPick(list: MetaAction[] | undefined): number {
  if (!list) return 0;
  for (const t of PURCHASE_TYPES) {
    const a = list.find((x) => x.action_type === t);
    if (a) return num(a.value);
  }
  return 0;
}

async function metaGet(version: string, path: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } });
  const j = (await res.json()) as { data?: Record<string, unknown>[]; error?: { message: string } };
  if (!res.ok || j.error) throw new Error(`Meta : ${j.error?.message ?? res.status}`.slice(0, 200));
  return j.data ?? [];
}

async function meta(version: string): Promise<PlatformAds> {
  const id = (process.env.META_AD_ACCOUNT_ID ?? "").replace(/^act_/, "").trim();
  const account = `act_${id}`;
  const rows = await metaGet(version, `${account}/insights`, {
    level: "ad",
    date_preset: "last_7d",
    fields: "ad_name,campaign_name,spend,impressions,clicks,actions,action_values",
    limit: "200",
  });
  const ads: AdLine[] = rows.map((r) => {
    const spend = num(r.spend);
    const purchases = metaPick(r.actions as MetaAction[]);
    const value = metaPick(r.action_values as MetaAction[]);
    return { name: String(r.ad_name ?? "pub").slice(0, 80), campaign: String(r.campaign_name ?? "").slice(0, 80), spend: r2(spend), impressions: num(r.impressions), clicks: num(r.clicks), purchases, value: r2(value), roas: spend > 0 ? r2(value / spend) : null };
  });
  const month = await metaGet(version, `${account}/insights`, { level: "account", date_preset: "last_30d", fields: "spend,actions,action_values" });
  const m = month[0] ?? {};
  return platform("Meta", ads, num(m.spend), metaPick(m.actions as MetaAction[]), metaPick(m.action_values as MetaAction[]));
}

// ---------------------------------------------------------------------------------------------
// TikTok API for Business (synchronous integrated report)

async function tiktokReport(dataLevel: string, dimensions: string[], metrics: string[], from: string, to: string) {
  const url = new URL("https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/");
  url.searchParams.set("advertiser_id", process.env.TIKTOK_ADVERTISER_ID ?? "");
  url.searchParams.set("report_type", "BASIC");
  url.searchParams.set("data_level", dataLevel);
  url.searchParams.set("dimensions", JSON.stringify(dimensions));
  url.searchParams.set("metrics", JSON.stringify(metrics));
  url.searchParams.set("start_date", from);
  url.searchParams.set("end_date", to);
  url.searchParams.set("page_size", "200");
  const res = await fetch(url, { headers: { "Access-Token": process.env.TIKTOK_ACCESS_TOKEN ?? "" } });
  const j = (await res.json()) as { code?: number; message?: string; data?: { list?: { dimensions: Record<string, string>; metrics: Record<string, string> }[] } };
  if (!res.ok || j.code !== 0) throw new Error(`TikTok : ${j.message ?? res.status}`.slice(0, 200));
  return j.data?.list ?? [];
}

async function tiktok(): Promise<PlatformAds> {
  const rows = await tiktokReport("AUCTION_AD", ["ad_id"], ["ad_name", "campaign_name", "spend", "impressions", "clicks", "complete_payment", "complete_payment_roas"], day(7), day(0));
  const ads: AdLine[] = rows.map((r) => {
    const m = r.metrics;
    const spend = num(m.spend);
    const roas = num(m.complete_payment_roas);
    return { name: String(m.ad_name ?? r.dimensions.ad_id).slice(0, 80), campaign: String(m.campaign_name ?? "").slice(0, 80), spend: r2(spend), impressions: num(m.impressions), clicks: num(m.clicks), purchases: num(m.complete_payment), value: r2(roas * spend), roas: spend > 0 ? r2(roas) : null };
  });
  const month = await tiktokReport("AUCTION_ADVERTISER", ["advertiser_id"], ["spend", "complete_payment", "complete_payment_roas"], day(30), day(0));
  const m = month[0]?.metrics ?? {};
  return platform("TikTok", ads, num(m.spend), num(m.complete_payment), num(m.complete_payment_roas) * num(m.spend));
}

function platform(name: string, ads: AdLine[], spend30: number, purchases30: number, value30: number): PlatformAds {
  const spend7 = ads.reduce((s, a) => s + a.spend, 0);
  const value7 = ads.reduce((s, a) => s + a.value, 0);
  return {
    name,
    spend7: r2(spend7),
    purchases7: ads.reduce((s, a) => s + a.purchases, 0),
    roas7: spend7 > 0 ? r2(value7 / spend7) : null,
    spend30: r2(spend30),
    purchases30,
    roas30: spend30 > 0 ? r2(value30 / spend30) : null,
    ads: ads.filter((a) => a.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 40),
  };
}

// Code decides, the model explains: cut an ad that spent 1.5 margins without a sale, scale one
// that beats the break-even ROAS by 30 %, otherwise let it learn.
export function verdicts(snap: AdsSnapshot, breakEvenRoas: number, marginPerSale: number) {
  for (const p of snap.platforms)
    for (const a of p.ads) {
      if (a.purchases === 0 && a.spend >= 1.5 * marginPerSale) a.verdict = "couper";
      else if (a.roas != null && a.purchases >= 2 && a.roas < breakEvenRoas && a.spend >= 2 * marginPerSale) a.verdict = "couper";
      else if (a.roas != null && a.purchases >= 3 && a.roas >= 1.3 * breakEvenRoas) a.verdict = "augmenter";
      else a.verdict = "attendre";
    }
}

export async function fetchAds(metaVersion: string, log: (t: string) => void): Promise<AdsSnapshot | null> {
  const platforms: PlatformAds[] = [];
  const errors: string[] = [];
  if (process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID) {
    try {
      platforms.push(await meta(metaVersion));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (process.env.TIKTOK_ACCESS_TOKEN && process.env.TIKTOK_ADVERTISER_ID) {
    try {
      platforms.push(await tiktok());
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  for (const e of errors) log(`Pubs : ${e}`);
  if (!platforms.length && !errors.length) return null;
  return { at: Date.now(), platforms, errors, spend30: r2(platforms.reduce((s, p) => s + p.spend30, 0)) };
}
