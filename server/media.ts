// Press review for the 24/7 server: gold headlines from Google News, in English and in French
// (it relays Reuters, Bloomberg, Kitco, FXStreet, Investing, Les Échos...), plus Investing.com's
// commodities feed. Plain RSS, no key. Scored by the lexicon, re-read by Claude when a key is set.
import { Headline, MediaState, emptyMedia, isAboutGold, lexiconScore, moodOf } from "../src/gold/engine/media";

const HOUR = 3_600_000;
const MAX_HEADLINES = 120;

const googleNews = (q: string, lang: "en" | "fr") =>
  lang === "en"
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
    : `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;

const FEEDS: { name: string; url: string; lang: "en" | "fr" }[] = [
  { name: "Google News (prix)", url: googleNews('gold price OR XAUUSD OR "gold futures" when:1d', "en"), lang: "en" },
  { name: "Google News (Fed, dollar)", url: googleNews("gold (Fed OR inflation OR dollar OR yields) when:1d", "en"), lang: "en" },
  { name: "Google News (géopolitique)", url: googleNews('gold ("safe haven" OR geopolitical OR "central bank" OR ETF) when:1d', "en"), lang: "en" },
  { name: "Google Actualités", url: googleNews(`"cours de l'or" OR "prix de l'or" OR "once d'or" when:1d`, "fr"), lang: "fr" },
  { name: "Investing.com", url: "https://www.investing.com/rss/news_11.rss", lang: "en" },
];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? decode(m[1]) : "";
};

export const headlineId = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 90);

export function parseRss(xml: string, lang: "en" | "fr", fallbackSource: string): Omit<Headline, "score" | "by">[] {
  const out: Omit<Headline, "score" | "by">[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const item = m[0];
    let title = tag(item, "title");
    let source = tag(item, "source");
    // Google News titles end with " - Source"
    const dash = title.lastIndexOf(" - ");
    if (dash > 20) {
      source ||= title.slice(dash + 3);
      title = title.slice(0, dash);
    }
    const t = Date.parse(tag(item, "pubDate"));
    if (!title || Number.isNaN(t)) continue;
    out.push({ id: headlineId(title), t, title, source: source || fallbackSource, url: tag(item, "link"), lang });
  }
  return out;
}

async function getText(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; AURUM gold monitor)" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

// Merge fresh headlines into the press review; earlier readings (Claude's included) are kept
export async function updateMedia(prev: MediaState | undefined, now: number, log: (...m: unknown[]) => void): Promise<MediaState & { fresh: number }> {
  const media = prev ?? emptyMedia();
  const known = new Map(media.headlines.map((h) => [h.id, h]));
  let fresh = 0;
  const results = await Promise.allSettled(FEEDS.map(async (f) => ({ f, items: parseRss(await getText(f.url), f.lang, f.name) })));
  const counts: string[] = [];
  for (const [k, r] of results.entries()) {
    if (r.status === "rejected") {
      counts.push(`${FEEDS[k].name} ✗`);
      continue;
    }
    let n = 0;
    for (const it of r.value.items) {
      if (now - it.t > 48 * HOUR || it.t - now > HOUR || !isAboutGold(it.title, it.lang)) continue;
      n++;
      if (known.has(it.id)) continue;
      known.set(it.id, { ...it, score: lexiconScore(it.title), by: "lexique" });
      fresh++;
    }
    counts.push(`${r.value.f.name} ${n}`);
  }
  log(`presse : ${counts.join(", ")} · ${fresh} nouveaux titres`);
  const headlines = [...known.values()]
    .filter((h) => now - h.t <= 48 * HOUR)
    .sort((a, b) => b.t - a.t)
    .slice(0, MAX_HEADLINES);
  const mood = moodOf(headlines, now);
  const history = [...media.history.filter((p) => now - p.t <= 10 * 24 * HOUR), { t: now, score: Math.round(mood.score * 1000) / 1000, n: mood.n }];
  return { headlines, history, reading: media.reading, updatedAt: now, fresh };
}
