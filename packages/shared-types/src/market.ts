/** Market-wide sentiment gauges shown on the Markets page. */
export interface MarketSentiment {
  /** Crypto Fear & Greed (alternative.me), 0–100 */
  cryptoFng?: { value: number; label: string; updatedMs: number };
  /** Stock-market Fear & Greed (CNN), 0–100 */
  stockFng?: { score: number; rating: string; previousClose: number; updatedMs: number };
  /** AAII weekly investor sentiment survey, percentages */
  aaii?: { bullish: number; neutral: number; bearish: number; date: string; updatedMs: number };
}

/** Historical price levels for an asset — period opens + a daily series, used to
 * show performance "since open" (day/week/month/year) and charts with levels. */
export interface PriceLevels {
  symbol: string;
  /** open of the current day / week / month / year (period anchors) */
  dailyOpen: number;
  weekOpen: number;
  monthOpen: number;
  yearOpen: number;
  /** 52-week range */
  yearHigh?: number;
  yearLow?: number;
  /** daily close series (~1y), oldest→newest */
  series: { t: number; c: number }[];
}
