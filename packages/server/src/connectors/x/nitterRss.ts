import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });

export interface NitterItem {
  text: string;
  link: string;
  pubMs: number;
  author: string;
  /** tweet media — canonical pbs.twimg.com image URLs decoded from Nitter's /pic/ proxy */
  images?: string[];
}

export interface NitterFeed {
  /** account display name, from the channel title ("Name / @handle") */
  name?: string;
  /** account avatar — the canonical pbs.twimg.com URL decoded from Nitter's /pic/ proxy */
  avatar?: string;
  items: NitterItem[];
  /** set when the body is an instance ERROR notice (RSS whitelist, rate-limit, etc.)
   * dressed up as a valid feed — callers must NOT surface this as a post and should
   * fail over to another instance. */
  error?: string;
}

/** Some Nitter instances return a syntactically-valid RSS document whose content is an
 * instance error notice ("RSS reader not yet whitelisted!", "Instance has been rate
 * limited", etc.) instead of tweets. These must never be rendered as posts. */
const ERROR_SENTINELS = [
  "not yet whitelisted",
  "instance has been rate limited",
  "error in feed",
  "this account's tweets are protected",
];

export function isNitterErrorText(text: string): boolean {
  const t = text.toLowerCase();
  return ERROR_SENTINELS.some((s) => t.includes(s));
}

/** Decode Nitter's `/pic/...` proxy URL back to the canonical Twitter image URL,
 * which is stable and fast (independent of the flaky Nitter instance). */
function realPic(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.split("?")[0]!.match(/\/pic\/(?:orig\/)?(.+)$/);
  if (!m) return undefined;
  let p: string;
  try {
    p = decodeURIComponent(m[1]!);
  } catch {
    return undefined;
  }
  if (p.startsWith("http")) return p;
  if (p.includes("twimg.com")) return `https://${p}`;
  // bare twimg path (media/…, profile_images/…, *_video_thumb/…) → pbs.twimg.com
  if (/^(media|profile_images|tweet_video_thumb|ext_tw_video_thumb|amplify_video_thumb)\//.test(p)) {
    return `https://pbs.twimg.com/${p}`;
  }
  return undefined; // unknown/encrypted form — let the client fall back
}

/** Pull tweet media (image URLs) out of a Nitter item's HTML <description>. */
function imagesFromDescription(desc: unknown): string[] | undefined {
  if (typeof desc !== "string" || !desc) return undefined;
  const out: string[] = [];
  const re = /<img[^>]+src="([^"]+)"/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(desc)) && out.length < 4) {
    const real = realPic(mm[1]!);
    if (real && !out.includes(real)) out.push(real);
  }
  return out.length ? out : undefined;
}

/** Parse a Nitter RSS feed: account name + avatar + items. Link rewritten to x.com. */
export function parseNitterRss(xml: string, handle: string): NitterFeed {
  const obj = parser.parse(xml);
  const channel = obj?.rss?.channel;
  if (!channel) return { items: [] };

  const title = String(channel.title || "");
  const namePart = title.split(" / @")[0]?.replace(/^@/, "").trim();
  const name = namePart && namePart.toLowerCase() !== handle.toLowerCase() ? namePart : undefined;
  const avatar = realPic(typeof channel.image?.url === "string" ? channel.image.url : undefined);

  let raw = channel.item ?? [];
  if (!Array.isArray(raw)) raw = [raw];

  // bail if the feed is actually an instance error notice masquerading as RSS —
  // check the channel title and any item title for the known sentinels.
  if (isNitterErrorText(title)) return { items: [], error: title.trim().slice(0, 120) };
  for (const it of raw) {
    const t = String(it?.title || "");
    if (isNitterErrorText(t)) return { items: [], error: t.trim().slice(0, 120) };
  }

  const items: NitterItem[] = raw
    .map((it: any) => {
      const link = String(it.link || "")
        .replace(/https?:\/\/[^/]+/, "https://x.com")
        .replace(/#m$/, "");
      const pubMs = it.pubDate ? Date.parse(it.pubDate) || Date.now() : Date.now();
      const author = String(it["dc:creator"] || `@${handle}`).replace(/^@/, "");
      const images = imagesFromDescription(it.description);
      return { text: String(it.title || "").trim(), link, pubMs, author, ...(images ? { images } : {}) };
    })
    .filter((i: NitterItem) => i.text && i.link && !isNitterErrorText(i.text));

  return { name, avatar, items };
}
