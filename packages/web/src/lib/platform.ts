import type { ActionResult, ChatPost, ChatSettingsResult, ConnectStatus, FollowsResult, ModLogEntry, ModRequest, PlatformId } from "@app/shared";
import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;
const authH = (): Record<string, string> => {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
};

export async function connectStatus(): Promise<ConnectStatus> {
  const r = await fetch(`${API}/api/connect/status`, { headers: authH() });
  if (!r.ok) throw new Error(`connect status ${r.status}`);
  return r.json();
}

/** Begin the OAuth flow — fetch the authorize URL (Bearer) then navigate to it. */
export async function startConnect(platform: PlatformId): Promise<void> {
  const r = await fetch(`${API}/api/connect/${platform}/start`, { headers: authH() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error(j.error || `couldn't start ${platform} connect`);
  window.location.href = j.url;
}

export async function disconnect(platform: PlatformId): Promise<void> {
  await fetch(`${API}/api/connect/${platform}`, { method: "DELETE", headers: authH() });
}

/** admin: save the Twitch OAuth app credentials server-side (no .env / restart) */
export async function saveTwitchConfig(
  clientId: string,
  clientSecret: string,
  redirectUri?: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(`${API}/api/connect/twitch/config`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authH() },
    body: JSON.stringify({ clientId, clientSecret, redirectUri }),
  });
  return r.json().catch(() => ({ ok: false, error: `config ${r.status}` }));
}

/** admin: save the Kick OAuth app credentials server-side (no .env / restart) */
export async function saveKickConfig(
  clientId: string,
  clientSecret: string,
  redirectUri?: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(`${API}/api/connect/kick/config`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authH() },
    body: JSON.stringify({ clientId, clientSecret, redirectUri }),
  });
  return r.json().catch(() => ({ ok: false, error: `config ${r.status}` }));
}

export async function platformPost(req: ChatPost): Promise<ActionResult> {
  const r = await fetch(`${API}/api/platform/post`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authH() },
    body: JSON.stringify(req),
  });
  return r.json().catch(() => ({ ok: false, error: `post ${r.status}` }));
}

export async function platformMod(req: ModRequest): Promise<ActionResult> {
  const r = await fetch(`${API}/api/platform/mod`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authH() },
    body: JSON.stringify(req),
  });
  return r.json().catch(() => ({ ok: false, error: `mod ${r.status}` }));
}

/** current chat modes for a channel (slow/followers/subs/emote) — Twitch only */
export async function getChatSettings(channel: string): Promise<ChatSettingsResult> {
  const r = await fetch(`${API}/api/platform/chat-settings?channel=${encodeURIComponent(channel)}`, { headers: authH() });
  return r.json().catch(() => ({ ok: false, error: `chat-settings ${r.status}` }));
}

/** the moderation audit log (newest-first) — mods/admins only */
export async function getModLog(limit = 100): Promise<ModLogEntry[]> {
  const r = await fetch(`${API}/api/platform/mod-log?limit=${limit}`, { headers: authH() });
  const j = await r.json().catch(() => ({ entries: [] }));
  return Array.isArray(j.entries) ? j.entries : [];
}

/** the linked user's followed Twitch channels (live-first) */
export async function twitchFollows(): Promise<FollowsResult> {
  const r = await fetch(`${API}/api/platform/twitch/follows`, { headers: authH() });
  return r.json().catch(() => ({ ok: false, error: `follows ${r.status}` }));
}

export interface KickLiveChannel {
  slug: string;
  title?: string;
  viewers: number;
  category?: string;
  thumbnail?: string;
  language?: string;
}

/** channels live on Kick right now (official API) — Kick has no "your follows" API,
 * so this powers a discovery picker instead. */
export async function kickLive(): Promise<{ ok: boolean; error?: string; channels?: KickLiveChannel[] }> {
  const r = await fetch(`${API}/api/platform/kick/live`, { headers: authH() });
  return r.json().catch(() => ({ ok: false, error: `kick live ${r.status}` }));
}
