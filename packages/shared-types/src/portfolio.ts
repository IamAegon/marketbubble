/**
 * Portfolio tracker — records the trade "calls" made on stream and tracks how
 * each basket of calls would have performed, then renders the branded
 * "Portfolio Performance" report.
 */

export type CallSide = "long" | "short";

/** One trade call (a position in a portfolio). */
export interface PortfolioCall {
  id: string;
  /** ticker shown in the UI, e.g. "BTC" */
  symbol: string;
  /** CoinGecko id used to pull price history, e.g. "bitcoin" */
  coingeckoId: string;
  side: CallSide;
  /** relative allocation weight within the portfolio (any positive number) */
  weight: number;
  /** explicit entry price; when omitted the price at `calledAt` is used */
  entryPrice?: number;
  /** when the call was made (ms epoch) */
  calledAt: number;
  /** who made the call (streamer handle / display name) */
  calledBy?: string;
  note?: string;
  /** optional close — after this the position is realized at `closePrice` */
  closedAt?: number;
  closePrice?: number;
}

/** A named basket of calls tracked from a starting capital. */
export interface Portfolio {
  id: string;
  name: string;
  /** notional the basket starts with, e.g. 100000 */
  startingCapital: number;
  /** baseline date the basket is tracked from (ms epoch) */
  startedAt: number;
  /** hex color for the bars/legend */
  color: string;
  calls: PortfolioCall[];
  createdBy: string;
  createdAt: number;
  /** optional script-flourish line for this basket's report ("Never Fade Ansem") */
  tagline?: string;
}

/** Input shape for create/update (server assigns id/createdAt). */
export interface PortfolioDraft {
  name: string;
  startingCapital?: number;
  startedAt?: number;
  color?: string;
  tagline?: string;
}

/** One sampled point on a portfolio's value curve. */
export interface PortfolioPoint {
  t: number;
  value: number;
  /** total return vs starting capital, in percent */
  returnPct: number;
}

/** A portfolio's computed value series over the tracked window. */
export interface PortfolioSeries {
  portfolioId: string;
  name: string;
  color: string;
  startingCapital: number;
  holdings: string[];
  tagline?: string;
  points: PortfolioPoint[];
  finalValue: number;
  finalReturnPct: number;
}

/** Full performance computation across one or more portfolios. */
export interface PortfolioPerformance {
  startedAt: number;
  now: number;
  /** the sample timestamps shared by every series (x-axis) */
  sampleTimes: number[];
  series: PortfolioSeries[];
  /** spread between the best and worst final value (for the report rail) */
  spread?: { leaderName: string; laggardName: string; usd: number; pct: number };
  /** assets whose price history could not be fetched (degraded result) */
  missing: string[];
}
