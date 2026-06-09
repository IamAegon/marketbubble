/** Which Finviz news view an article came from — drives the lane tabs in the News page. */
export type NewsLane = "crypto" | "markets";

/** A markets/crypto news headline aggregated from Finviz for the Markets → News page. */
export interface NewsArticle {
  title: string;
  /** the outlet's article URL (opens in a new tab) */
  url: string;
  /** publishing outlet, e.g. "CoinDesk", "MarketWatch", "Bloomberg" */
  source: string;
  lane: NewsLane;
  /** Finviz's own time label, e.g. "2 hours" or "02:35PM" — shown verbatim */
  time?: string;
  /** ticker tags Finviz attached to the row, e.g. ["BTC", "ETH"] */
  tickers?: string[];
}

/** The /api/news payload. */
export interface NewsFeed {
  articles: NewsArticle[];
  updatedAt: number;
}
