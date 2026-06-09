import type { ActionResult, ChatPost, ChatSettingsResult, FollowsResult, ModRequest, PlatformId } from "@app/shared";
import type { TokenRec, UserStore } from "../auth/UserStore.js";
import { refreshToken as twitchRefresh, twitchConfigured } from "../connect/oauth-twitch.js";
import { refreshToken as kickRefresh, kickConfigured, appToken as kickAppToken } from "../connect/oauth-kick.js";
import * as tw from "./TwitchClient.js";
import * as kc from "./KickClient.js";
import { getCachedId, setCachedId } from "./idCache.js";
import { logger } from "../observability/logger.js";

/** connector channel id ("twitch:#xqc" / "kick:slug") → platform + login */
function parseChannel(channel: string): { platform: PlatformId; login: string } | null {
  const m = String(channel || "").match(/^(twitch|kick):#?(.+)$/);
  return m ? { platform: m[1] as PlatformId, login: m[2]! } : null;
}

function modeToPatch(a: Extract<ModRequest["action"], { kind: "mode" }>): Record<string, unknown> {
  switch (a.mode) {
    case "slow":
      return a.enabled ? { slow_mode: true, slow_mode_wait_time: a.seconds ?? 30 } : { slow_mode: false };
    case "followers":
      return a.enabled ? { follower_mode: true, follower_mode_duration: a.seconds ? Math.round(a.seconds / 60) : 0 } : { follower_mode: false };
    case "subs":
      return { subscriber_mode: a.enabled };
    case "emote":
      return { emote_mode: a.enabled };
  }
}

const friendly = (r: tw.CallResult): ActionResult =>
  r.ok
    ? { ok: true }
    : { ok: false, error: r.status === 401 || r.status === 403 ? "you don't moderate this channel (or missing scope)" : r.error };

/**
 * The authenticated post + moderation layer, keyed off each user's linked
 * platform token. One surface (`post` / `moderate`) the router calls; it parses
 * the channel, refreshes the token, resolves ids, and dispatches per platform.
 * Twitch enforces mod status itself (401/403 ⇒ "you don't moderate this channel").
 */
export class PlatformService {
  constructor(private readonly users: UserStore) {}

  async post(handle: string, req: ChatPost): Promise<ActionResult> {
    const parsed = parseChannel(req.channel);
    if (!parsed) return { ok: false, error: "unsupported channel" };
    const text = String(req.text ?? "").trim();
    if (!text) return { ok: false, error: "empty message" };
    if (parsed.platform === "kick") return this.kickPost(handle, parsed.login, text, req.replyToMsgId);
    if (parsed.platform !== "twitch") return { ok: false, error: `${parsed.platform} posting isn't available yet` };
    if (!twitchConfigured()) return { ok: false, mock: true, error: "Twitch isn't configured on the server" };
    const tok = await this.twitchToken(handle);
    if (!tok?.userId) return { ok: false, error: "connect your Twitch account in Settings → Connections" };
    const broadcasterId = await this.twitchId(tok.accessToken, parsed.login);
    if (!broadcasterId) return { ok: false, error: "unknown channel" };
    return friendly(await tw.sendMessage(tok.accessToken, broadcasterId, tok.userId, text.slice(0, 500), req.replyToMsgId));
  }

  async moderate(handle: string, req: ModRequest): Promise<ActionResult> {
    const parsed = parseChannel(req.channel);
    if (!parsed) return { ok: false, error: "unsupported channel" };
    if (parsed.platform === "kick") return this.kickModerate(handle, parsed.login, req);
    if (parsed.platform !== "twitch") return { ok: false, error: `${parsed.platform} moderation isn't available yet` };
    if (!twitchConfigured()) return { ok: false, mock: true, error: "Twitch isn't configured on the server" };
    const tok = await this.twitchToken(handle);
    if (!tok?.userId) return { ok: false, error: "connect your Twitch account in Settings → Connections" };
    const broadcasterId = await this.twitchId(tok.accessToken, parsed.login);
    if (!broadcasterId) return { ok: false, error: "unknown channel" };
    const mod = tok.userId;
    const a = req.action;

    const target = async (): Promise<string | null> =>
      req.targetUserId ? req.targetUserId : req.targetLogin ? this.twitchId(tok.accessToken, req.targetLogin) : null;

    switch (a.kind) {
      case "timeout": {
        const t = await target();
        return t ? friendly(await tw.ban(tok.accessToken, broadcasterId, mod, t, a.seconds, a.reason)) : { ok: false, error: "no target user" };
      }
      case "ban": {
        const t = await target();
        return t ? friendly(await tw.ban(tok.accessToken, broadcasterId, mod, t, undefined, a.reason)) : { ok: false, error: "no target user" };
      }
      case "unban": {
        const t = await target();
        return t ? friendly(await tw.unban(tok.accessToken, broadcasterId, mod, t)) : { ok: false, error: "no target user" };
      }
      case "delete":
        return req.platformMsgId
          ? friendly(await tw.deleteMessage(tok.accessToken, broadcasterId, mod, req.platformMsgId))
          : { ok: false, error: "no message id" };
      case "clear":
        return friendly(await tw.clearChat(tok.accessToken, broadcasterId, mod));
      case "mode":
        return friendly(await tw.setChatSettings(tok.accessToken, broadcasterId, mod, modeToPatch(a)));
      default: {
        const _exhaustive: never = a;
        return { ok: false, error: "unsupported action" };
      }
    }
  }

  /** read a channel's current chat modes (slow/followers/subs/emote) so the control bar
   *  shows live state. Twitch-only — Kick's API doesn't expose chat settings. */
  async chatSettings(handle: string, channel: string): Promise<ChatSettingsResult> {
    const parsed = parseChannel(channel);
    if (!parsed) return { ok: false, error: "unsupported channel" };
    if (parsed.platform !== "twitch") return { ok: false, error: "Kick doesn't expose chat modes via the API" };
    if (!twitchConfigured()) return { ok: false, error: "Twitch isn't configured on the server" };
    const tok = await this.twitchToken(handle);
    if (!tok?.userId) return { ok: false, error: "connect your Twitch account in Settings → Connections" };
    const broadcasterId = await this.twitchId(tok.accessToken, parsed.login);
    if (!broadcasterId) return { ok: false, error: "unknown channel" };
    const r = await tw.getChatSettings(tok.accessToken, broadcasterId, tok.userId);
    if (!r.ok)
      return { ok: false, error: r.status === 401 || r.status === 403 ? "you don't moderate this channel (or missing scope)" : r.error };
    return { ok: true, settings: r.settings };
  }

  /** the channels the linked user follows (live-first), for the add-from-follows picker */
  async twitchFollows(handle: string): Promise<FollowsResult> {
    if (!twitchConfigured()) return { ok: false, error: "Twitch isn't configured on the server" };
    const tok = await this.twitchToken(handle);
    if (!tok?.userId) return { ok: false, error: "connect your Twitch account first" };
    const { status, channels } = await tw.getFollowedChannels(tok.accessToken, tok.userId);
    if (status === 401) return { ok: false, reconnect: true, error: "reconnect Twitch to grant the follows permission" };
    if (status !== 200) return { ok: false, error: `twitch ${status}` };
    const live = await tw.getFollowedLiveLogins(tok.accessToken, tok.userId);
    const follows = channels
      .map((c) => ({ login: c.login, name: c.name, live: live.has(c.login) }))
      .sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name));
    return { ok: true, follows };
  }

  /** load the user's Twitch token, refreshing it if within 60s of expiry */
  private async twitchToken(handle: string): Promise<TokenRec | null> {
    const t = this.users.getPlatformToken(handle, "twitch");
    if (!t) return null;
    if (t.expiresAt && t.refreshToken && t.expiresAt - Date.now() < 60_000) {
      try {
        const fresh = await twitchRefresh(t.refreshToken);
        const patch = {
          accessToken: fresh.accessToken,
          refreshToken: fresh.refreshToken ?? t.refreshToken,
          expiresAt: fresh.expiresAt,
          scopes: fresh.scopes ?? t.scopes,
        };
        this.users.updatePlatformToken(handle, "twitch", patch);
        return { ...t, ...patch };
      } catch (e) {
        logger.warn({ err: String(e) }, "twitch token refresh failed");
      }
    }
    return t;
  }

  private async twitchId(accessToken: string, login: string): Promise<string | null> {
    const cached = getCachedId("twitch", login);
    if (cached) return cached;
    const id = await tw.getUserId(accessToken, login);
    if (id) setCachedId("twitch", login, id);
    return id;
  }

  /** channels LIVE on Kick right now (official API, app token) — the "live now" picker */
  async kickLive(): Promise<{ ok: boolean; error?: string; channels?: kc.KickLiveChannel[] }> {
    if (!kickConfigured()) return { ok: false, error: "Kick isn't configured on the server" };
    const app = await kickAppToken();
    if (!app) return { ok: false, error: "couldn't get a Kick app token" };
    return { ok: true, channels: await kc.browseLivestreams(app, 36) };
  }

  // ---- Kick (post + moderate as the linked account) ----
  private async kickPost(handle: string, slug: string, text: string, replyToMsgId?: string): Promise<ActionResult> {
    if (!kickConfigured()) return { ok: false, mock: true, error: "Kick isn't configured on the server" };
    const tok = await this.kickToken(handle);
    if (!tok) return { ok: false, error: "connect your Kick account in Settings → Connections" };
    const broadcasterId = await this.kickId(slug);
    if (!broadcasterId) return { ok: false, error: "unknown channel" };
    return friendly(await kc.sendMessage(tok.accessToken, broadcasterId, text.slice(0, 500), replyToMsgId));
  }

  private async kickModerate(handle: string, slug: string, req: ModRequest): Promise<ActionResult> {
    if (!kickConfigured()) return { ok: false, mock: true, error: "Kick isn't configured on the server" };
    const tok = await this.kickToken(handle);
    if (!tok) return { ok: false, error: "connect your Kick account in Settings → Connections" };
    const broadcasterId = await this.kickId(slug);
    if (!broadcasterId) return { ok: false, error: "unknown channel" };
    const a = req.action;
    // Kick moderates users by numeric id (taken from the message author); login lookup isn't supported
    const t = req.targetUserId || null;
    switch (a.kind) {
      case "timeout":
        return t
          ? friendly(await kc.ban(tok.accessToken, broadcasterId, t, Math.max(1, Math.round((a.seconds ?? 600) / 60)), a.reason))
          : { ok: false, error: "no target user" };
      case "ban":
        return t ? friendly(await kc.ban(tok.accessToken, broadcasterId, t, undefined, a.reason)) : { ok: false, error: "no target user" };
      case "unban":
        return t ? friendly(await kc.unban(tok.accessToken, broadcasterId, t)) : { ok: false, error: "no target user" };
      case "delete":
        return req.platformMsgId ? friendly(await kc.deleteMessage(tok.accessToken, req.platformMsgId)) : { ok: false, error: "no message id" };
      case "clear":
      case "mode":
        return { ok: false, error: "Kick doesn't support that action via the API" };
      default:
        return { ok: false, error: "unsupported action" };
    }
  }

  /** load the user's Kick token, refreshing it if within 60s of expiry */
  private async kickToken(handle: string): Promise<TokenRec | null> {
    const t = this.users.getPlatformToken(handle, "kick");
    if (!t) return null;
    if (t.expiresAt && t.refreshToken && t.expiresAt - Date.now() < 60_000) {
      try {
        const fresh = await kickRefresh(t.refreshToken);
        const patch = {
          accessToken: fresh.accessToken,
          refreshToken: fresh.refreshToken ?? t.refreshToken,
          expiresAt: fresh.expiresAt,
          scopes: fresh.scopes ?? t.scopes,
        };
        this.users.updatePlatformToken(handle, "kick", patch);
        return { ...t, ...patch };
      } catch (e) {
        logger.warn({ err: String(e) }, "kick token refresh failed");
      }
    }
    return t;
  }

  /** resolve a Kick channel slug → broadcaster id (cached; uses the app token) */
  private async kickId(slug: string): Promise<string | null> {
    const cached = getCachedId("kick", slug);
    if (cached) return cached;
    const app = await kickAppToken();
    if (!app) return null;
    const id = await kc.resolveChannelId(app, slug);
    if (id) setCachedId("kick", slug, id);
    return id;
  }
}
