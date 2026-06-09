import type { XGuestAuth } from "./xGuestAuth.js";

export interface BroadcastInfo {
  broadcastId: string;
  mediaKey: string;
  state: string;
  userDisplayName?: string;
  username?: string;
  chatToken: string;
  lifecycleToken?: string;
  sourceStatus?: string;
  /** live HLS master playlist URL (from live_video_stream/status `source`) — what x.com's
   * own guest web player uses; no login required for a public broadcast. */
  hlsUrl?: string;
}

/** Pull the playable HLS master URL out of a live_video_stream/status `source` object,
 *  tolerant of X renaming the field (location / noRedirectPlaybackUrl / …) — fall back to
 *  any string value that looks like an .m3u8 so a minor shape change doesn't break playback. */
function pickHls(source: any): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  const named = [source.location, source.noRedirectPlaybackUrl, source.streamMasterUrl, source.url];
  for (const c of named) if (typeof c === "string" && c.includes(".m3u8")) return c;
  for (const v of Object.values(source)) if (typeof v === "string" && v.includes(".m3u8")) return v;
  return undefined;
}

/** Accepts a full broadcast URL or a bare id. */
export function parseBroadcastId(input: string): string {
  const m = input.match(/broadcasts\/([A-Za-z0-9]+)/);
  if (m) return m[1]!;
  return input.trim();
}

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url.split("?")[0]} -> ${r.status}`);
  return r.json();
}

/**
 * Validated chain: broadcasts/show.json -> media_key -> live_video_stream/status
 * -> chatToken. Throws if the broadcast isn't live (no chatToken).
 */
export async function resolveBroadcast(
  auth: XGuestAuth,
  broadcastId: string,
): Promise<BroadcastInfo> {
  const fetchWith = async (force: boolean) => {
    const headers = await auth.authHeaders(force);
    const show = await getJson(
      `https://x.com/i/api/1.1/broadcasts/show.json?ids=${broadcastId}&include_events=true`,
      headers,
    );
    const bc = show?.broadcasts?.[broadcastId];
    if (!bc) throw new Error("broadcast not found");
    const status = await getJson(
      `https://x.com/i/api/1.1/live_video_stream/status/${bc.media_key}?client=web&use_syndication_guest_id=false&cookie_set_host=twitter.com`,
      headers,
    );
    return { bc, status };
  };

  let res;
  try {
    res = await fetchWith(false);
  } catch (e) {
    // refresh the guest token once on auth failure
    if (/-> 40[13]/.test(String(e))) res = await fetchWith(true);
    else throw e;
  }

  const { bc, status } = res;
  if (!status?.chatToken) throw new Error(`no chatToken (state=${bc.state})`);
  return {
    broadcastId,
    mediaKey: bc.media_key,
    state: bc.state,
    userDisplayName: bc.user_display_name,
    username: bc.username,
    chatToken: status.chatToken,
    lifecycleToken: status.lifecycleToken,
    sourceStatus: status.source?.status,
    hlsUrl: pickHls(status.source),
  };
}

/** Lightweight live-state + current viewer count for a broadcast (no chatToken needed) —
 * for the viewer poller. `total_watching` is the live audience; state "RUNNING" = live. */
export async function getBroadcastViewers(
  auth: XGuestAuth,
  broadcastId: string,
): Promise<{ live: boolean; viewers: number } | null> {
  const fetchWith = async (force: boolean) =>
    getJson(`https://x.com/i/api/1.1/broadcasts/show.json?ids=${broadcastId}&include_events=false`, await auth.authHeaders(force));
  try {
    let show;
    try {
      show = await fetchWith(false);
    } catch (e) {
      if (/-> 40[13]/.test(String(e))) show = await fetchWith(true);
      else throw e;
    }
    const bc = show?.broadcasts?.[broadcastId];
    if (!bc) return null;
    return { live: bc.state === "RUNNING", viewers: Number(bc.total_watching ?? 0) || 0 };
  } catch {
    return null;
  }
}
