import type { Platform } from "./chat-message";

/** Time window the analytics view is scoped to. */
export type StatsRange = "5m" | "20m" | "1h" | "6h" | "session";

/** Which streamers the analytics view aggregates: ours, external, or everyone. */
export type StatsScope = "owned" | "external" | "all";

/** One streamer's headline metrics — for the picker list and comparison. */
export interface StreamerSummary {
  id: string;
  name: string;
  owned: boolean;
  total: number;
  chatters: number;
  perMin: number;
  peakPerMin: number;
  /** -1..1 latest net sentiment */
  net: number;
  /** currently being recorded (mod-controlled session open) */
  recording?: boolean;
}

/** Aggregate metrics across an ownership group (owned or external). */
export interface RollupSummary {
  streamers: number;
  total: number;
  chatters: number;
  perMin: number;
  peakPerMin: number;
  net: number;
}

/** One time-bucket of chat activity, split by platform. */
export interface ActivityBucket {
  /** bucket start (ms epoch) */
  t: number;
  twitch: number;
  x: number;
  kick: number;
  mb: number;
  total: number;
}

export interface ChannelStat {
  channel: string;
  label: string;
  platform: Platform;
  count: number;
}

export interface ChatterRank {
  username: string;
  name: string;
  platform: Platform;
  count: number;
  /** messages per minute over the chatter's active span */
  perMin: number;
}

export interface CashtagStat {
  symbol: string;
  count: number;
}

export interface EmoteStat {
  name: string;
  url: string;
  count: number;
}

export interface SentimentPoint {
  t: number;
  /** -1..1 */
  net: number;
  bullish: number;
  bearish: number;
}

/** Live hype/velocity gauge (0..100) + activity-spike bucket times. */
export interface HypeStat {
  /** 0..100 blended hype score (rate spike + sentiment swing + emote/cashtag burst) */
  score: number;
  /** current msgs/min (last 5m) */
  perMinNow: number;
  /** rolling baseline msgs/min (earlier part of the window) */
  baselinePerMin: number;
  /** change in msgs/min per minute (last 5m vs prior 5m) */
  acceleration: number;
  /** bucket start times flagged as spikes (for chart markers) */
  spikes: number[];
}

/** New-vs-returning chatter lifecycle over the range. */
export interface ChatterInsights {
  newChatters: number;
  returning: number;
  /** returning / (new + returning), 0..1 */
  returningRate: number;
  /** unique chatters active in the last 5m, per minute */
  activeUniquesPerMin: number;
}

/** Sentiment for a single channel/stream over the range. */
export interface ChannelSentiment {
  channel: string;
  label: string;
  platform: Platform;
  /** -1..1 */
  net: number;
  bullish: number;
  bearish: number;
}

/** A message that drew the most emote reactions in the range. */
export interface ReactedMessage {
  id: string;
  channel: string;
  label: string;
  author: string;
  text: string;
  emoteCount: number;
  t: number;
}

/** Momentum of an emote or cashtag: recent vs prior count within the range. */
export interface MomentumStat {
  key: string;
  label?: string;
  url?: string;
  now: number;
  prev: number;
  delta: number;
}

/** Server-aggregated analytics snapshot for a given range. */
export interface StatsSnapshot {
  range: StatsRange;
  /** which streamers this snapshot aggregates */
  scope: StatsScope;
  /** set when a single streamer is selected (overrides scope) */
  streamerId?: string;
  streamerName?: string;
  owned?: boolean;
  now: number;
  startedAt: number;
  /** messages within the selected range */
  total: number;
  /** all messages observed this session (uncapped by the ring buffer) */
  sessionTotal: number;
  /** width of one display bucket (ms) — for labeling bars */
  bucketMs: number;
  /** current rate: messages/min over the last 5 minutes */
  perMin: number;
  /** peak per-minute rate within the range */
  peakPerMin: number;
  /** start time (ms) of the peak bucket */
  peakAt: number;
  /** unique chatters observed this session */
  chatters: number;
  byPlatform: Record<string, number>;
  buckets: ActivityBucket[];
  channels: ChannelStat[];
  topChatters: ChatterRank[];
  cashtags: CashtagStat[];
  emotes: EmoteStat[];
  sentiment: SentimentPoint[];
  /** every known streamer's headline metrics — for the picker + comparison */
  streamers: StreamerSummary[];
  /** owned-vs-external aggregate comparison */
  comparison: { owned: RollupSummary; external: RollupSummary };
  /** durable history (Postgres) backing the totals? */
  durable: boolean;
  // ---- enriched live metrics (optional; absent on older servers) ----
  hype?: HypeStat;
  chatterInsights?: ChatterInsights;
  channelSentiment?: ChannelSentiment[];
  mostReacted?: ReactedMessage[];
  emoteMomentum?: MomentumStat[];
  cashtagMomentum?: MomentumStat[];
}
