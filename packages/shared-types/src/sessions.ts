import type { Platform } from "./chat-message";
import type { ActivityBucket, CashtagStat, ChatterRank, EmoteStat, SentimentPoint } from "./stats";

export type SessionStatus = "recording" | "ended";

/** A mod-bracketed recording session for one streamer's broadcast. Persisted so
 * analytics are durable + historical across restarts. */
export interface SessionSummary {
  id: string;
  streamerId: string;
  streamerName: string;
  owned: boolean;
  /** mod who started it */
  startedBy: string;
  startedAt: number;
  /** null while recording */
  endedAt: number | null;
  status: SessionStatus;
  durationMs: number;
  messages: number;
  chatters: number;
  /** messages per minute over the session */
  avgPerMin: number;
  peakPerMin: number;
  peakAt: number;
  /** overall net sentiment (-1..1) */
  net: number;
  byPlatform: Record<string, number>;
  topChatters: ChatterRank[];
  topEmotes: EmoteStat[];
  topCashtags: CashtagStat[];
  /** per-minute activity timeline */
  activity: ActivityBucket[];
  /** per-minute sentiment trend */
  sentiment: SentimentPoint[];
}

/** Request to start a recording session (mod). For X, pass the live broadcast URL. */
export interface StartSessionRequest {
  streamerId: string;
  /** live X broadcast URL/id to attach to the streamer before recording (X only) */
  xUrl?: string;
}

export interface StreamerChannelInfo {
  platform: Platform;
  channel: string;
}

/** A streamer (Market Bubble's own or external) and its platform channels. */
export interface StreamerInfo {
  id: string;
  name: string;
  owned: boolean;
  channels: StreamerChannelInfo[];
  /** auto-capture a session report when this streamer goes live (default: on for
   * owned, opt-in for external). Storage of all messages is always-on regardless. */
  recordSessions: boolean;
  /** run live speech-to-text while this streamer is live (opt-in, off by default) */
  transcribe: boolean;
}
