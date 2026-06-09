//! In-house X timeline source via X's own syndication API — the endpoint that powers
//! embedded timeline widgets on millions of third-party sites. No auth, no Nitter, and
//! (unlike the GraphQL API) effectively no rate limit, because it's built to be hammered
//! by embeds. This is what scraping providers like Apify do under the hood; we just do it
//! ourselves. Returns posts in the same shape as the Nitter parser so it's a drop-in.

import { curlText } from "./curlFetch.js";

export interface XPost {
  text: string;
  link: string;
  pubMs: number;
  author?: string;
  images?: string[];
}
export interface XTimeline {
  items: XPost[];
  name?: string;
  avatar?: string;
}

// a real browser UA — the syndication host is friendlier to one than to a bot string
export const X_WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;

// The syndication host is generous but NOT unlimited — it 429s by IP under a burst (e.g. ~29
// tracked accounts all polling at boot). One host, so we just pace requests through a shared
// gate: a minimum gap between consecutive fetches, plus a cooldown if we ever do get a 429.
// Steady-state load (~9 req/min) almost never waits; only a startup storm gets paced out.
const MIN_GAP_MS = 1200;
// a 429 means we're over the IP line — rest for a real stretch (Nitter covers the gap) rather
// than retrying every minute, which just keeps the IP hot and prevents it from recovering
const COOLDOWN_MS = 5 * 60_000;
let lastFetchAt = 0;
let cooldownUntil = 0;
let gate: Promise<void> = Promise.resolve();

function pace(): Promise<void> {
  const mine = gate.then(async () => {
    const wait = lastFetchAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetchAt = Date.now();
  });
  // keep the chain alive even if a waiter is cancelled
  gate = mine.catch(() => {});
  return mine;
}

/** Rebuild display text: expand t.co links to their real URL and drop the trailing t.co
 *  that just points at attached media (we surface the image separately). */
function buildText(tweet: any): string {
  // a retweet's own full_text is truncated ("RT @x: …") — reconstruct from the source
  const rt = tweet.retweeted_status;
  if (rt && (rt.full_text || rt.text)) {
    const via = rt.user?.screen_name ? `RT @${rt.user.screen_name}: ` : "RT: ";
    return via + buildText(rt);
  }
  let text: string = tweet.full_text || tweet.text || "";
  const ent = tweet.entities || {};
  for (const u of ent.urls || []) {
    if (u.url && u.expanded_url) text = text.split(u.url).join(u.expanded_url);
  }
  // strip the short-URL that only references attached photos/video
  for (const m of (tweet.extended_entities || tweet.entities || {}).media || []) {
    if (m.url) text = text.split(m.url).join("");
  }
  return text.trim();
}

function imagesOf(tweet: any): string[] {
  const media = (tweet.extended_entities || tweet.entities || {}).media || [];
  const out: string[] = [];
  for (const m of media) {
    // photos use media_url_https directly; video/gif expose a poster frame at the same field
    if (m.media_url_https) out.push(m.media_url_https);
  }
  return out;
}

/** Fetch and parse a handle's recent posts from the syndication timeline.
 *  Returns null on any failure (network / shape change / not found) so the caller can fall
 *  back to Nitter. */
export async function fetchSyndicationTimeline(
  handle: string,
  signal?: AbortSignal,
): Promise<XTimeline | null> {
  const h = handle.replace(/^@/, "").trim();
  if (!h) return null;
  // recently rate-limited → skip straight to the caller's fallback instead of waiting it out
  if (Date.now() < cooldownUntil) return null;
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(h)}`;
  // own timeout controller (curl needs a signal); still honor an external abort if given
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  const onAbort = () => ac.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let body = "";
  try {
    await pace();
    const res = await curlText(url, X_WEB_UA, ac.signal);
    // back off hard on a rate-limit so we stop hammering and let the IP cool down
    if (res.status === 429) cooldownUntil = Date.now() + COOLDOWN_MS;
    if (!res.ok || !res.body) return null;
    body = res.body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  const m = NEXT_DATA_RE.exec(body);
  if (!m) return null;
  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const entries = data?.props?.pageProps?.timeline?.entries;
  if (!Array.isArray(entries)) return null;

  let name: string | undefined;
  let avatar: string | undefined;
  const items: XPost[] = [];
  for (const e of entries) {
    if (e?.type !== "tweet") continue;
    const t = e.content?.tweet;
    if (!t || !(t.full_text || t.text)) continue;
    const user = t.user || {};
    if (!name && user.name) name = user.name;
    // syndication gives the _normal (48px) avatar — bump to a crisper one
    if (!avatar && user.profile_image_url_https) avatar = String(user.profile_image_url_https).replace("_normal.", "_bigger.");
    const id = t.id_str || (t.id != null ? String(t.id) : "");
    const screen = user.screen_name || h;
    const pubMs = Date.parse(t.created_at);
    items.push({
      text: buildText(t),
      link: id ? `https://x.com/${screen}/status/${id}` : `https://x.com/${screen}`,
      pubMs: Number.isFinite(pubMs) ? pubMs : Date.now(),
      author: user.name || `@${screen}`,
      ...(imagesOf(t).length ? { images: imagesOf(t) } : {}),
    });
  }
  // newest first — a pinned tweet can be old and out of order, so sort by time
  items.sort((a, b) => b.pubMs - a.pubMs);
  return { items, name, avatar };
}
