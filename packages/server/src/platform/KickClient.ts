// Thin Kick public-API wrappers for posting + moderation. Post/mod use the linked
// user's access token; channel resolution + livestreams use an app token.
const API = "https://api.kick.com/public/v1";

export interface CallResult {
  ok: boolean;
  status?: number;
  error?: string;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" };
}

async function errText(r: Response): Promise<string> {
  try {
    const j: any = await r.json();
    return j?.message || j?.error || `HTTP ${r.status}`;
  } catch {
    return `HTTP ${r.status}`;
  }
}

/** resolve a channel slug → broadcaster user id */
export async function resolveChannelId(token: string, slug: string): Promise<string | null> {
  const r = await fetch(`${API}/channels?slug=${encodeURIComponent(slug)}`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  const c = j?.data?.[0];
  const id = c?.broadcaster_user_id ?? c?.user_id;
  return id != null ? String(id) : null;
}

/** the token owner → {id, name} */
export async function getCurrentUser(token: string): Promise<{ id: string; name: string } | null> {
  const r = await fetch(`${API}/users`, { headers: authHeaders(token), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const j: any = await r.json();
  const u = j?.data?.[0];
  return u ? { id: String(u.user_id), name: String(u.name ?? "") } : null;
}

export interface KickLiveChannel {
  slug: string;
  title?: string;
  viewers: number;
  category?: string;
  thumbnail?: string;
  language?: string;
}

/** browse channels LIVE on Kick right now (app token), sorted by viewers — for the
 * "live now" discovery picker. Resolves slugs from broadcaster ids when absent. */
export async function browseLivestreams(token: string, limit = 30): Promise<KickLiveChannel[]> {
  const r = await fetch(`${API}/livestreams?sort=viewer_count&limit=${Math.min(100, limit)}`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return [];
  const j: any = await r.json();
  const rows = (j?.data ?? []).map((d: any) => ({
    slug: String(d.slug ?? d.channel?.slug ?? "").toLowerCase(),
    broadcasterId: d.broadcaster_user_id != null ? String(d.broadcaster_user_id) : "",
    title: d.stream_title ?? d.session_title ?? undefined,
    viewers: Number(d.viewer_count) || 0,
    category: d.category?.name ?? undefined,
    thumbnail: d.thumbnail ?? undefined,
    language: d.language ?? undefined,
  }));
  // fill any missing slugs by resolving broadcaster ids via /channels
  const missing = rows.filter((x: any) => !x.slug && x.broadcasterId).map((x: any) => x.broadcasterId);
  if (missing.length) {
    const bySlug = await channelsByBroadcasterId(token, missing);
    for (const row of rows) if (!row.slug && bySlug[row.broadcasterId]) row.slug = bySlug[row.broadcasterId];
  }
  return rows
    .filter((x: any) => x.slug)
    .map((x: any) => ({ slug: x.slug, title: x.title, viewers: x.viewers, category: x.category, thumbnail: x.thumbnail, language: x.language }));
}

async function channelsByBroadcasterId(token: string, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const qs = ids.slice(i, i + 50).map((id) => `broadcaster_user_id=${encodeURIComponent(id)}`).join("&");
    const r = await fetch(`${API}/channels?${qs}`, { headers: authHeaders(token), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) continue;
    const j: any = await r.json();
    for (const c of j?.data ?? []) out[String(c.broadcaster_user_id)] = String(c.slug);
  }
  return out;
}

/** official live status + title for given channel slugs (app token) */
export async function getChannels(
  token: string,
  slugs: string[],
): Promise<Record<string, { isLive: boolean; viewers: number; title?: string; category?: string }>> {
  const out: Record<string, { isLive: boolean; viewers: number; title?: string; category?: string }> = {};
  for (let i = 0; i < slugs.length; i += 50) {
    const qs = slugs.slice(i, i + 50).map((s) => `slug=${encodeURIComponent(s)}`).join("&");
    const r = await fetch(`${API}/channels?${qs}`, { headers: authHeaders(token), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) continue;
    const j: any = await r.json();
    for (const c of j?.data ?? [])
      out[String(c.slug).toLowerCase()] = {
        isLive: !!c.stream?.is_live,
        viewers: Number(c.stream?.viewer_count) || 0,
        title: c.stream_title ?? undefined,
        category: c.category?.name ?? undefined,
      };
  }
  return out;
}

/** live viewer counts by broadcaster id (app token; offline channels omitted) */
export async function getLivestreams(token: string, broadcasterIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < broadcasterIds.length; i += 50) {
    const qs = broadcasterIds
      .slice(i, i + 50)
      .map((id) => `broadcaster_user_id=${encodeURIComponent(id)}`)
      .join("&");
    const r = await fetch(`${API}/livestreams?${qs}`, { headers: authHeaders(token), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) continue;
    const j: any = await r.json();
    for (const d of j?.data ?? []) out[String(d.broadcaster_user_id)] = Number(d.viewer_count) || 0;
  }
  return out;
}

export async function sendMessage(token: string, broadcasterId: string, content: string, replyToMessageId?: string): Promise<CallResult> {
  const r = await fetch(`${API}/chat`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      broadcaster_user_id: Number(broadcasterId),
      content: content.slice(0, 500),
      type: "user",
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return { ok: false, status: r.status, error: await errText(r) };
  const j: any = await r.json();
  const sent = j?.data?.is_sent ?? j?.is_sent;
  return sent === false ? { ok: false, error: "message was not sent" } : { ok: true };
}

/** timeout (durationMin set, 1–10080) or permanent ban (durationMin omitted) */
export async function ban(token: string, broadcasterId: string, userId: string, durationMin?: number, reason?: string): Promise<CallResult> {
  const r = await fetch(`${API}/moderation/bans`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      broadcaster_user_id: Number(broadcasterId),
      user_id: Number(userId),
      ...(durationMin ? { duration: Math.min(10080, Math.max(1, durationMin)) } : {}),
      ...(reason ? { reason: reason.slice(0, 100) } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return r.ok ? { ok: true } : { ok: false, status: r.status, error: await errText(r) };
}

export async function unban(token: string, broadcasterId: string, userId: string): Promise<CallResult> {
  const r = await fetch(`${API}/moderation/bans`, {
    method: "DELETE",
    headers: authHeaders(token),
    body: JSON.stringify({ broadcaster_user_id: Number(broadcasterId), user_id: Number(userId) }),
    signal: AbortSignal.timeout(10_000),
  });
  return r.ok ? { ok: true } : { ok: false, status: r.status, error: await errText(r) };
}

export async function deleteMessage(token: string, messageId: string): Promise<CallResult> {
  const r = await fetch(`${API}/chat/${encodeURIComponent(messageId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  return r.ok ? { ok: true } : { ok: false, status: r.status, error: await errText(r) };
}
