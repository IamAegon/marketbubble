/**
 * The canonical message every platform connector normalizes into.
 * Separates event time (`timestamp`) from processing time (`receivedAt`),
 * and carries `(platform, platformMsgId)` as the cross-source dedup key.
 */

export type Platform = "twitch" | "x" | "kick" | "mb";

export const PLATFORMS: Platform[] = ["twitch", "x", "kick", "mb"];

/** Where an emote came from (native platform or a third-party set). */
export type EmoteProvider = "twitch" | "kick" | "7tv" | "bttv" | "ffz";

/** A cashtag span detected in `text` (e.g. $BTC). */
export interface Cashtag {
  symbol: string;
  start: number;
  end: number;
}

/** A positional emote span over `text` (Twitch/Kick). X broadcast chat has none. */
export interface Emote {
  id: string;
  /** char offset into `text` (inclusive) */
  start: number;
  /** char offset into `text` (inclusive) */
  end: number;
  url: string;
  name?: string;
  provider?: EmoteProvider;
  /** 7TV zero-width emotes overlay the previous emote */
  zeroWidth?: boolean;
}

export interface Badge {
  id: string;
  title: string;
  imageUrl?: string;
}

export interface ChatAuthor {
  username: string;
  displayName: string;
  /** hex color e.g. "#FF4500" */
  color?: string;
  avatarUrl?: string;
  /** platform-native numeric/string id (Twitch user-id, Kick sender id) */
  platformUserId?: string;
}

export interface ReplyRef {
  id: string;
  author: string;
  textPreview: string;
}

/** A rich card attached to a native MB room message. Right now the only source is
 * the AI assistant: a forwarded answer carries its full markdown here so the feed
 * can render it as a formatted "from the assistant" card instead of plain chat
 * text (which is capped + unformatted). `text` still holds a plain preview. */
export interface MessageEmbed {
  /** what produced the embed (drives the icon/label + styling) */
  kind: "ai" | "x" | "news";
  /** header label, e.g. "Assistant", a tweet author, or a news outlet */
  title?: string;
  /** full markdown body, rendered with the same renderer the assistant uses */
  markdown: string;
  /** source link (e.g. the tweet URL) — shown as an open-in-new-tab affordance */
  link?: string;
}

export interface ChatMessage {
  /** our own id (ULID) — stable PK, safe across sources */
  id: string;
  platform: Platform;
  /** source-native id; dedup key together with `platform` */
  platformMsgId: string;
  /** machine label, e.g. "twitch:#xqc", "x:1jxXggyQWrjJZ", "kick:asmongold" */
  channel: string;
  /** human label shown in the UI */
  channelLabel: string;
  author: ChatAuthor;
  /** canonical plain text */
  text: string;
  emotes?: Emote[];
  badges?: Badge[];
  /** event time (ms epoch) from the source */
  timestamp: number;
  /** processing time (ms epoch) stamped on ingest */
  receivedAt: number;
  replyTo?: ReplyRef;
  /** 'chat' (default), 'post' = a tracked X account's tweet (Nitter), or
   * 'caption' = a live speech-to-text segment from the stream's audio */
  kind?: "chat" | "post" | "caption";
  /** user-defined category for tracked-account posts (e.g. "News") */
  category?: string;
  /** external link (e.g. the tweet URL for posts) */
  link?: string;
  /** attached media image URLs (e.g. a tweet's photos) */
  media?: string[];
  /** detected cashtags in `text` (e.g. $BTC) */
  cashtags?: Cashtag[];
  /** rich card (e.g. an answer forwarded from the AI assistant) — when set, the UI
   * renders this formatted card instead of the plain `text` */
  embed?: MessageEmbed;
  /** bull/bear lean (-1/0/+1) computed ONCE at enrich and stamped here; every
   * downstream consumer (analytics fold, session fold, side-band gauge) reads
   * this instead of re-scoring the text */
  sentiment?: number;
  /** speech-to-text confidence 0..1 — only set on `kind:"caption"` segments */
  conf?: number;
}
