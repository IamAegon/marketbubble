import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { TrendItem, TrendPlatform, TrendProviders, TrendsPayload } from "@app/shared";
import { logger } from "../observability/logger.js";

const REFRESH_MS = 5 * 60_000;
// Provider lanes (TikTok/Instagram via Apify) are PAID and slow-changing, so they
// refresh on a much longer cadence and the result is cached to disk — so a server
// restart (or tsx-watch reload) never re-charges while the cache is still fresh.
const PROVIDER_TTL_MS = Math.max(60 * 60_000, Number(process.env.TRENDS_PROVIDER_REFRESH_MS) || 24 * 60 * 60_000);
const PROVIDER_CACHE_PATH = resolve(process.cwd(), "data/trends-providers.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });

// ── provider config (TikTok / Instagram have no free public trends feed — they
// come from an Apify actor when the operator supplies a token + actor slug) ──
const APIFY_TOKEN = process.env.TRENDS_APIFY_TOKEN?.trim() || "";
const APIFY_TIKTOK_ACTOR = process.env.TRENDS_APIFY_TIKTOK_ACTOR?.trim() || "";
const APIFY_INSTAGRAM_ACTOR = process.env.TRENDS_APIFY_INSTAGRAM_ACTOR?.trim() || "";
const tiktokConfigured = !!(APIFY_TOKEN && APIFY_TIKTOK_ACTOR);
const instagramConfigured = !!(APIFY_TOKEN && APIFY_INSTAGRAM_ACTOR);

/** display order for the flat list — what hosts care about most leads. */
const PLATFORM_ORDER: TrendPlatform[] = ["tiktok", "instagram", "bluesky", "search", "reddit", "mastodon", "youtube", "news"];

/** Rolling store of "what people are talking about right now" — hot topics across
 * social, search + the news cycle. The host's on-stream talking points. */
export class TrendsStore {
  private items: TrendItem[] = [];
  private at = 0;
  private providers: TrendProviders = { tiktok: tiktokConfigured, instagram: instagramConfigured };
  get(): TrendsPayload {
    return { trends: this.items, updatedAt: this.at, providers: this.providers };
  }
  set(items: TrendItem[]): void {
    this.items = ordered(items);
    this.at = Date.now();
  }
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const fmtK = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
/** stable sort by platform priority so the flat feed always leads with the lanes hosts care about */
const ordered = (items: TrendItem[]): TrendItem[] =>
  items
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const pa = PLATFORM_ORDER.indexOf(a.t.platform ?? "news");
      const pb = PLATFORM_ORDER.indexOf(b.t.platform ?? "news");
      return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || a.i - b.i;
    })
    .map((x) => x.t);

/** Google Trends "daily trending searches" — what the world is Googling right now. */
async function googleTrends(geo = "US"): Promise<TrendItem[]> {
  const res = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
    headers: { "user-agent": UA, accept: "application/rss+xml,application/xml" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`google trends ${res.status}`);
  const xml = parser.parse(await res.text());
  return asArray(xml?.rss?.channel?.item)
    .slice(0, 12)
    .map((it: any): TrendItem => {
      const news = asArray(it["ht:news_item"])[0];
      return {
        title: titleCase(String(it.title ?? "").trim()),
        source: "Trending Searches",
        platform: "search",
        traffic: it["ht:approx_traffic"] ? `${String(it["ht:approx_traffic"]).trim()} searches` : undefined,
        snippet: news?.["ht:news_item_title"] ? String(news["ht:news_item_title"]).trim() : undefined,
        url: news?.["ht:news_item_url"]
          ? String(news["ht:news_item_url"]).trim()
          : `https://www.google.com/search?q=${encodeURIComponent(String(it.title ?? ""))}`,
        tone: "hot",
      };
    });
}

/** Bluesky trending topics — a genuinely public, no-auth social trends feed with
 * post counts, topical categories and a "hot" flag. The strongest free social signal. */
async function blueskyTrends(): Promise<TrendItem[]> {
  const r = await fetch("https://api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=14", {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error(`bluesky trends ${r.status}`);
  const j = (await r.json()) as { trends?: any[] };
  return asArray(j.trends)
    .slice(0, 12)
    .map((t: any): TrendItem => {
      const cat = t.category ? titleCase(String(t.category)) : undefined;
      const posts = Number(t.postCount ?? 0);
      const started = t.startedAt ? Date.parse(String(t.startedAt)) : NaN;
      return {
        title: String(t.displayName || t.topic || "").trim(),
        source: cat ? `Bluesky · ${cat}` : "Bluesky",
        platform: "bluesky",
        category: cat,
        traffic: posts ? `${fmtK(posts)} posts` : undefined,
        url: t.link ? `https://bsky.app${String(t.link)}` : undefined,
        tone: t.status === "hot" ? "hot" : undefined,
        ...(Number.isFinite(started) ? { at: started } : {}),
      };
    })
    .filter((x: TrendItem) => x.title);
}

/** Mastodon (fediverse) trending hashtags — what social is buzzing about. Public, no key. */
async function mastodonTags(): Promise<TrendItem[]> {
  const r = await fetch("https://mastodon.social/api/v1/trends/tags?limit=12", {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error(`mastodon tags ${r.status}`);
  const j = (await r.json()) as any[];
  return j.slice(0, 10).map((t): TrendItem => {
    const uses = Number(t.history?.[0]?.uses ?? 0) + Number(t.history?.[1]?.uses ?? 0);
    return {
      title: `#${t.name}`,
      source: "Mastodon",
      platform: "mastodon",
      traffic: uses ? `${fmtK(uses)} posts` : undefined,
      url: String(t.url),
      tone: "hot",
    };
  });
}

/** Mastodon trending LINKS — the news stories the fediverse is sharing most. */
async function mastodonLinks(): Promise<TrendItem[]> {
  const r = await fetch("https://mastodon.social/api/v1/trends/links?limit=8", {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error(`mastodon links ${r.status}`);
  const j = (await r.json()) as any[];
  return j.slice(0, 8).map((l): TrendItem => ({
    title: String(l.title || l.url),
    source: l.provider_name ? `News · ${String(l.provider_name).trim()}` : "News",
    platform: "news",
    snippet: l.description ? String(l.description).trim().slice(0, 150) : undefined,
    url: String(l.url),
  }));
}

/** Google News top stories — the general news cycle. */
async function googleNewsTop(n = 6): Promise<TrendItem[]> {
  const res = await fetch("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en", {
    headers: { "user-agent": UA, accept: "application/rss+xml,application/xml" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`gnews top ${res.status}`);
  const xml = parser.parse(await res.text());
  return asArray(xml?.rss?.channel?.item)
    .slice(0, n)
    .map((it: any): TrendItem => {
      const src = it.source ? String(it.source).trim() : "";
      let title = String(it.title ?? "").trim();
      if (src && title.endsWith(` - ${src}`)) title = title.slice(0, -(src.length + 3)).trim();
      return { title, source: src ? `News · ${src}` : "News", platform: "news", url: it.link ? String(it.link).trim() : undefined };
    });
}

/** Reddit r/popular — what communities are blowing up (best-effort; often rate-limited). */
async function reddit(): Promise<TrendItem[]> {
  const res = await fetch("https://www.reddit.com/r/popular/hot.json?limit=12&raw_json=1", {
    headers: { "user-agent": "marketbubble/1.0 (trends panel)", accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`reddit ${res.status}`);
  const j: any = await res.json();
  return asArray(j?.data?.children)
    .map((c: any) => c.data)
    .filter((d: any) => d && !d.stickied && !d.over_18)
    .slice(0, 8)
    .map((d: any): TrendItem => ({
      title: String(d.title ?? "").slice(0, 160),
      source: `Reddit · r/${d.subreddit}`,
      platform: "reddit",
      traffic: `${fmtK(d.ups ?? 0)} ↑`,
      url: `https://reddit.com${d.permalink}`,
    }));
}

// ── TikTok / Instagram via an Apify actor ────────────────────────────────────
// No free public feed exists for either, so we run a configured Apify actor and
// map its dataset items defensively (field names vary by actor). Disabled (returns
// []) unless TRENDS_APIFY_TOKEN + the matching actor slug are set.
const pickField = (o: any, keys: string[]): unknown => {
  for (const k of keys) if (o && o[k] != null && o[k] !== "") return o[k];
  return undefined;
};
const parseEnvJson = (name: string): any => {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    logger.warn({ name }, "trends: ignoring malformed provider input JSON");
    return undefined;
  }
};

/** Run an Apify actor synchronously and return its dataset items. */
async function apifyDataset(actor: string, input: any): Promise<any[]> {
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input ?? {}),
    signal: AbortSignal.timeout(60_000), // actor runs are slow; this never blocks the free lanes (see tick)
  });
  if (!r.ok) throw new Error(`apify ${actor} ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

async function tiktokTrends(): Promise<TrendItem[]> {
  if (!tiktokConfigured) return [];
  const input = parseEnvJson("TRENDS_APIFY_TIKTOK_INPUT") ?? { countryCode: "US", period: 7, limit: 15, sortBy: "popular" };
  const rows = await apifyDataset(APIFY_TIKTOK_ACTOR, input);
  return rows
    .slice(0, 18)
    .map((d: any): TrendItem | null => {
      const name = pickField(d, ["hashtagName", "hashtag_name", "hashtag", "name", "title"]);
      if (!name) return null;
      const tag = String(name).replace(/^#/, "").trim();
      if (!tag) return null;
      const posts = Number(pickField(d, ["postCount", "post_count", "publishCnt", "publishCount", "publish_cnt", "posts", "videoCount", "videoViews", "video_views", "viewCount"]) ?? 0);
      const ind = pickField(d, ["industry"]) as any;
      const cat = ind && typeof ind === "object" ? (ind.name ? String(ind.name) : undefined) : ind ? String(ind) : undefined;
      return {
        title: `#${tag}`,
        source: cat ? `TikTok · ${cat}` : "TikTok",
        platform: "tiktok",
        ...(cat ? { category: cat } : {}),
        traffic: posts ? `${fmtK(posts)} posts` : undefined,
        url: `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`,
        tone: "hot",
      };
    })
    .filter((x): x is TrendItem => !!x);
}

async function instagramTrends(): Promise<TrendItem[]> {
  if (!instagramConfigured) return [];
  const input = parseEnvJson("TRENDS_APIFY_INSTAGRAM_INPUT") ?? { country: "US", limit: 15 };
  const rows = await apifyDataset(APIFY_INSTAGRAM_ACTOR, input);
  return rows
    .slice(0, 15)
    .map((d: any): TrendItem | null => {
      const name = pickField(d, ["hashtag", "hashtagName", "name", "tag", "title"]);
      if (!name) return null;
      const tag = String(name).replace(/^#/, "").trim();
      if (!tag) return null;
      const posts = Number(pickField(d, ["mediaCount", "media_count", "postsCount", "postCount", "posts", "count"]) ?? 0);
      return {
        title: `#${tag}`,
        source: "Instagram",
        platform: "instagram",
        traffic: posts ? `${fmtK(posts)} posts` : undefined,
        url: `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`,
        tone: "hot",
      };
    })
    .filter((x): x is TrendItem => !!x);
}

/** Poll the hot-topic sources on an interval and keep the store fresh. */
export function startTrends(store: TrendsStore, signal: AbortSignal): void {
  const gather = async (label: string, sources: (() => Promise<TrendItem[]>)[]): Promise<TrendItem[]> => {
    const results = await Promise.allSettled(sources.map((s) => s()));
    const out: TrendItem[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") out.push(...r.value);
      else logger.debug({ err: String(r.reason), label }, "trend source failed");
    }
    return out;
  };

  // provider (paid) lane cache — persisted to disk so restarts don't re-charge
  let providerItems: TrendItem[] = [];
  let providerAt = 0;
  let lastAttempt = 0;
  try {
    if (existsSync(PROVIDER_CACHE_PATH)) {
      const c = JSON.parse(readFileSync(PROVIDER_CACHE_PATH, "utf8"));
      providerItems = Array.isArray(c?.items) ? c.items : [];
      providerAt = Number(c?.fetchedAt) || 0;
      logger.info({ count: providerItems.length, ageH: Math.round((Date.now() - providerAt) / 3_600_000) }, "trends: loaded cached provider lanes");
    }
  } catch (e) {
    logger.warn({ err: String(e) }, "trends: failed to read provider cache");
  }

  // Only actually calls Apify when the cache is stale (TTL). Empty/failed runs are
  // cheap, but back off to ≤1/h so we never hammer; a SUCCESSFUL run holds for the full TTL.
  const refreshProviders = async () => {
    if (!tiktokConfigured && !instagramConfigured) return;
    const now = Date.now();
    if (providerItems.length && now - providerAt < PROVIDER_TTL_MS) return; // still fresh
    if (now - lastAttempt < Math.min(PROVIDER_TTL_MS, 60 * 60_000)) return; // backoff between attempts
    lastAttempt = now;
    const items = await gather("provider", [() => tiktokTrends(), () => instagramTrends()]);
    if (!items.length) return; // keep the last good cache; don't blow it away on a bad run
    providerItems = items;
    providerAt = now;
    try {
      mkdirSync(dirname(PROVIDER_CACHE_PATH), { recursive: true });
      writeFileSync(PROVIDER_CACHE_PATH, JSON.stringify({ fetchedAt: providerAt, items }));
    } catch (e) {
      logger.warn({ err: String(e) }, "trends: failed to persist provider cache");
    }
    logger.info({ count: items.length }, "trends refreshed (provider lanes, paid)");
  };

  const tick = async () => {
    if (signal.aborted) return;
    // free public lanes are fast (~9s) and refresh every cycle (markets/crypto NEWS lives on its own page)
    const free = await gather("free", [() => blueskyTrends(), () => googleTrends("US"), () => mastodonTags(), () => mastodonLinks(), () => googleNewsTop(6), () => reddit()]);
    // paid lanes only hit the network when their long TTL has elapsed; otherwise served from cache
    await refreshProviders();
    const merged = [...providerItems, ...free];
    if (merged.length) {
      store.set(merged);
      logger.info({ free: free.length, provider: providerItems.length }, "trends refreshed");
    }
  };

  void tick();
  const id = setInterval(tick, REFRESH_MS);
  signal.addEventListener("abort", () => clearInterval(id));
}
