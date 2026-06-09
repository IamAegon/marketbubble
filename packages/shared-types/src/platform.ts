/** Streaming platforms a user can link their account to (post + moderate). */
export type PlatformId = "twitch" | "kick";

/** Send (or reply to) a message in a connected platform chat, as the linked user. */
export interface ChatPost {
  /** connector channel id, e.g. "twitch:#xqc" or "kick:trainwreckstv" */
  channel: string;
  text: string;
  /** platform message id being replied to (threads the reply where supported) */
  replyToMsgId?: string;
}

/** A moderation action against a channel/user (mods only, re-verified server-side). */
export type ModAction =
  | { kind: "timeout"; seconds: number; reason?: string }
  | { kind: "ban"; reason?: string }
  | { kind: "unban" }
  | { kind: "delete" } // delete one message (needs platformMsgId)
  | { kind: "clear" } // clear the whole chat
  | { kind: "mode"; mode: "slow" | "followers" | "subs" | "emote"; enabled: boolean; seconds?: number };

export interface ModRequest {
  channel: string;
  /** the offending user — id preferred, login as fallback */
  targetUserId?: string;
  targetLogin?: string;
  /** the offending user's display name — for a readable audit log only (server ignores it) */
  targetName?: string;
  /** the message to delete (delete action) */
  platformMsgId?: string;
  action: ModAction;
}

/** One recorded moderation action, for the audit log (who did what to whom, when). */
export interface ModLogEntry {
  id: string;
  at: number;
  /** the moderator who acted */
  actor: string;
  actorName: string;
  channel: string;
  channelLabel: string;
  platform: string;
  action: "timeout" | "ban" | "unban" | "delete" | "clear" | "mode";
  /** the affected user (for user-targeted actions) */
  target?: string;
  durationSecs?: number;
  reason?: string;
  /** for mode actions: which mode + whether it was turned on */
  mode?: string;
  enabled?: boolean;
  /** did the platform accept it */
  ok: boolean;
}

/** Result of a post/mod call. `mock:true` ⇒ the platform isn't configured on the server. */
export interface ActionResult {
  ok: boolean;
  error?: string;
  mock?: boolean;
}

/** The channel-wide chat modes (Twitch). Reflects what `setChatSettings` controls, so the
 *  channel-control bar can show live on/off state instead of guessing. */
export interface ChatSettings {
  slow: boolean;
  /** slow-mode delay between messages, in seconds */
  slowSecs: number;
  followers: boolean;
  /** how long someone must have followed before chatting, in minutes (0 = any follower) */
  followersMins: number;
  subs: boolean;
  emote: boolean;
}
/** Reading chat modes is Twitch-only; `settings` is absent when unsupported/unavailable. */
export interface ChatSettingsResult {
  ok: boolean;
  error?: string;
  settings?: ChatSettings;
}

export interface PlatformStatus {
  /** server has the OAuth app credentials (client id/secret) */
  configured: boolean;
  /** this user has linked their account */
  linked: boolean;
  /** the linked login, when connected */
  login?: string;
  /** the OAuth redirect URI to register in the platform's developer console */
  redirectUri?: string;
}
export interface ConnectStatus {
  twitch: PlatformStatus;
  kick: PlatformStatus;
}

/** A channel the linked user follows (for the "add from your follows" picker). */
export interface TwitchFollow {
  login: string;
  name: string;
  live: boolean;
}

export interface FollowsResult {
  ok: boolean;
  error?: string;
  /** the token lacks the follows scope — the user should reconnect */
  reconnect?: boolean;
  follows?: TwitchFollow[];
}
