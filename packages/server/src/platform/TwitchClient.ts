// Thin Twitch Helix wrappers for posting + moderation. Each call uses the linked
// user's access token; non-mods get 401/403 from Helix, surfaced as a clean error.
import type { ChatSettings } from "@app/shared";
import { twitchClientId } from "../connect/oauth-twitch.js";

const HELIX = "https://api.twitch.tv/helix";

export interface CallResult {
  ok: boolean;
  status?: number;
  error?: string;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}`, "client-id": twitchClientId(), "content-type": "application/json" };
}

async function errText(r: Response): Promise<string> {
  try {
    const j: any = await r.json();
    return j?.message || j?.error || `HTTP ${r.status}`;
  } catch {
    return `HTTP ${r.status}`;
  }
}

/** live viewer counts by login (public; works with an app token). Offline channels omitted. */
export async function getStreams(accessToken: string, logins: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < logins.length; i += 100) {
    const qs = logins.slice(i, i + 100).map((l) => `user_login=${encodeURIComponent(l)}`).join("&");
    const r = await fetch(`${HELIX}/streams?${qs}&first=100`, { headers: authHeaders(accessToken), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) continue;
    const j: any = await r.json();
    for (const d of j?.data ?? []) out[String(d.user_login).toLowerCase()] = Number(d.viewer_count) || 0;
  }
  return out;
}

/** the channels this user follows (status 401 ⇒ token missing user:read:follows) */
export async function getFollowedChannels(
  accessToken: string,
  userId: string,
): Promise<{ status: number; channels: { login: string; name: string }[] }> {
  const r = await fetch(`${HELIX}/channels/followed?user_id=${userId}&first=100`, {
    headers: authHeaders(accessToken),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return { status: r.status, channels: [] };
  const j: any = await r.json();
  const channels = (j?.data ?? []).map((d: any) => ({
    login: String(d.broadcaster_login),
    name: String(d.broadcaster_name || d.broadcaster_login),
  }));
  return { status: 200, channels };
}

/** logins of the user's followed channels that are LIVE right now */
export async function getFollowedLiveLogins(accessToken: string, userId: string): Promise<Set<string>> {
  const r = await fetch(`${HELIX}/streams/followed?user_id=${userId}&first=100`, {
    headers: authHeaders(accessToken),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return new Set();
  const j: any = await r.json();
  return new Set<string>((j?.data ?? []).map((d: any) => String(d.user_login)));
}

/** resolve a channel login → broadcaster user id */
export async function getUserId(accessToken: string, login: string): Promise<string | null> {
  const r = await fetch(`${HELIX}/users?login=${encodeURIComponent(login)}`, {
    headers: authHeaders(accessToken),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  const u = j?.data?.[0];
  return u ? String(u.id) : null;
}

export async function sendMessage(
  accessToken: string,
  broadcasterId: string,
  senderId: string,
  message: string,
  replyParentMessageId?: string,
): Promise<CallResult> {
  const r = await fetch(`${HELIX}/chat/messages`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      broadcaster_id: broadcasterId,
      sender_id: senderId,
      message,
      ...(replyParentMessageId ? { reply_parent_message_id: replyParentMessageId } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return { ok: false, status: r.status, error: await errText(r) };
  // Twitch returns is_sent + drop_reason even on 200
  const j: any = await r.json();
  const d = j?.data?.[0];
  if (d && d.is_sent === false) return { ok: false, error: d.drop_reason?.message || "message was dropped" };
  return { ok: true };
}

export async function ban(
  accessToken: string,
  broadcasterId: string,
  moderatorId: string,
  userId: string,
  durationSeconds?: number,
  reason?: string,
): Promise<CallResult> {
  const r = await fetch(`${HELIX}/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ data: { user_id: userId, ...(durationSeconds ? { duration: durationSeconds } : {}), ...(reason ? { reason } : {}) } }),
    signal: AbortSignal.timeout(10_000),
  });
  return r.ok ? { ok: true } : { ok: false, status: r.status, error: await errText(r) };
}

export async function unban(accessToken: string, broadcasterId: string, moderatorId: string, userId: string): Promise<CallResult> {
  const r = await fetch(`${HELIX}/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}&user_id=${userId}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
    signal: AbortSignal.timeout(10_000),
  });
  return r.ok ? { ok: true } : { ok: false, status: r.status, error: await errText(r) };
}

export async function deleteMessage(accessToken: string, broadcasterId: string, moderatorId: string, messageId: string): Promise<CallResult> {
  const r = await fetch(`${HELIX}/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}&message_id=${messageId}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
    signal: AbortSignal.timeout(10_000),
  });
  return r.ok ? { ok: true } : { ok: false, status: r.status, error: await errText(r) };
}

export async function clearChat(accessToken: string, broadcasterId: string, moderatorId: string): Promise<CallResult> {
  const r = await fetch(`${HELIX}/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
    signal: AbortSignal.timeout(10_000),
  });
  return r.ok ? { ok: true } : { ok: false, status: r.status, error: await errText(r) };
}

/** chat modes: slow / followers-only / subs-only / emote-only (PATCH /chat/settings) */
export async function setChatSettings(
  accessToken: string,
  broadcasterId: string,
  moderatorId: string,
  patch: Record<string, unknown>,
): Promise<CallResult> {
  const r = await fetch(`${HELIX}/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(10_000),
  });
  return r.ok ? { ok: true } : { ok: false, status: r.status, error: await errText(r) };
}

/** read the channel's current chat modes, so the control bar reflects live on/off state */
export async function getChatSettings(
  accessToken: string,
  broadcasterId: string,
  moderatorId: string,
): Promise<{ ok: boolean; status?: number; error?: string; settings?: ChatSettings }> {
  const r = await fetch(`${HELIX}/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`, {
    headers: authHeaders(accessToken),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return { ok: false, status: r.status, error: await errText(r) };
  const j: any = await r.json();
  const d = j?.data?.[0] ?? {};
  return {
    ok: true,
    settings: {
      slow: !!d.slow_mode,
      slowSecs: Number(d.slow_mode_wait_time) || 30,
      followers: !!d.follower_mode,
      followersMins: Number(d.follower_mode_duration) || 0,
      subs: !!d.subscriber_mode,
      emote: !!d.emote_mode,
    },
  };
}
