import type { ChatMessage, MessageEmbed, Platform, ReplyRef } from "./chat-message";
import type { TeamEvent } from "./checklist";

/** Connector lifecycle state, surfaced to the UI as a banner. */
export type ConnectorStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "reconnecting"; error: string; attempt: number; delayMs: number }
  | { kind: "failed"; error: string }
  | { kind: "idle"; reason: string };

export interface Filters {
  /** empty = all platforms */
  platforms: Platform[];
  /** empty = all channels */
  channels: string[];
}

/** A connector descriptor for the UI (source list, health). */
export interface ConnectorInfo {
  id: string;
  platform: Platform;
  label: string;
  status: ConnectorStatus;
}

// ---- side-band (market) data, broadcast unfiltered ----
export interface PriceTick {
  symbol: string;
  name?: string;
  price: number;
  /** fraction, e.g. 0.023 = +2.3% over 24h */
  change24h?: number;
  /** fraction change since the session/stream baseline */
  changeSinceStart?: number;
  baseline?: number;
  startedAt?: number;
  source: "binance" | "coingecko" | "hyperliquid" | "cnbc";
  /** asset class for grouping in the UI */
  kind?: "crypto" | "macro";
}

export interface MarketOdds {
  id: string;
  question: string;
  slug?: string;
  /** 0..1 */
  yes: number;
  no: number;
  url: string;
  volume?: number;
  endDate?: string;
  /** top-level category derived from Polymarket event tags (Politics, Crypto, …) */
  category?: string;
}

export interface SentimentGauge {
  bullish: number;
  bearish: number;
  /** -1..1 */
  net: number;
  windowMs: number;
  sample: number;
}

/** client -> server */
export type ClientMsg =
  | { type: "hello"; filters: Filters; backfill: number; token?: string }
  | { type: "setFilters"; filters: Filters }
  | { type: "post"; room: string; text: string; replyTo?: ReplyRef; embed?: MessageEmbed }
  | { type: "pong" };

/** server -> client */
export type ServerMsg =
  | { type: "welcome"; connectors: ConnectorInfo[] }
  | { type: "backfill"; messages: ChatMessage[] }
  | { type: "message"; message: ChatMessage }
  | { type: "status"; connector: string; platform: Platform; label: string; status: ConnectorStatus }
  | { type: "ticker"; prices: PriceTick[] }
  | { type: "price"; tick: PriceTick }
  | { type: "markets"; markets: MarketOdds[] }
  | { type: "sentiment"; gauge: SentimentGauge; perCashtag?: Record<string, SentimentGauge> }
  | { type: "viewers"; counts: Record<string, number>; live?: string[] } // counts: connector id -> viewer count; live: connector ids actually streaming now (per the platform's live API, NOT chat-connection state)
  | { type: "team"; event: TeamEvent }
  | { type: "ping" };
