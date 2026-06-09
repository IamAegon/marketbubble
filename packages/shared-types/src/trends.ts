/** Which platform / surface a trend came from — drives the UI lane, icon and filter. */
export type TrendPlatform =
  | "search" // Google Trends — what the world is Googling
  | "bluesky"
  | "mastodon"
  | "reddit"
  | "news"
  | "tiktok"
  | "instagram"
  | "youtube";

/** A trending item a Market Bubble host can talk about on stream — a hot coin,
 * a big mover, a crypto/macro headline, or what social is buzzing about. */
export interface TrendItem {
  title: string;
  /** the lane it belongs to, e.g. "Bluesky · Politics", "TikTok", "Crypto News · CoinDesk" */
  source: string;
  /** the headline stat — a price, a signed % move, an upvote/post count, or an index value */
  traffic?: string;
  /** a context line — price, volume, rank, or a related headline */
  snippet?: string;
  /** link to read/trade more */
  url?: string;
  /** color intent for the card: market direction or heat */
  tone?: "up" | "down" | "hot" | "cold";
  /** small icon (e.g. a coin logo) */
  icon?: string;
  /** which platform / surface produced this trend — drives the filter chips + lane icon */
  platform?: TrendPlatform;
  /** topical bucket when the source provides one (e.g. "Pop Culture", "Politics", "Crypto") */
  category?: string;
  /** when the trend started surfacing (epoch ms) — powers a "started 12m ago" freshness chip */
  at?: number;
}

/** Which provider-gated trend sources have an API key configured, so the UI can
 * prompt the user to enable them (TikTok / Instagram have no free public feed). */
export interface TrendProviders {
  tiktok: boolean;
  instagram: boolean;
}

/** The full /api/trends payload. */
export interface TrendsPayload {
  trends: TrendItem[];
  updatedAt: number;
  providers: TrendProviders;
}
