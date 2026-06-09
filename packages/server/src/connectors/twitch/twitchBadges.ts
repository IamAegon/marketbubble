import { clientCredentialsToken, twitchClientId, twitchConfigured } from "../../connect/oauth-twitch.js";
import { logger } from "../../observability/logger.js";

/**
 * Resolves Twitch chat badges (subscriber / mod / vip / bits / founder / …) to their
 * real image URLs via Helix, so the feed shows the same badge art as twitch.tv instead
 * of a generic glyph. Channel-custom badges (e.g. tiered sub badges) come from the
 * per-channel set; everything else from the global set. Both are cached; lazily warmed
 * on first sight of a channel. No-op (returns undefined) when no Twitch app is configured,
 * so the UI cleanly falls back to styled glyph chips.
 */

type BadgeMap = Map<string, string>; // "set_id/version_id" -> image url

let globalMap: BadgeMap | null = null;
let globalPending: Promise<void> | null = null;
const channelMaps = new Map<string, BadgeMap>();
const channelPending = new Map<string, Promise<void>>();

interface HelixBadges {
  data?: { set_id: string; versions: { id: string; image_url_2x?: string; image_url_4x?: string; image_url_1x?: string }[] }[];
}

async function fetchBadgeSet(url: string): Promise<BadgeMap> {
  const token = await clientCredentialsToken();
  if (!token) throw new Error("twitch app token unavailable");
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}`, "client-id": twitchClientId() } });
  if (!r.ok) throw new Error(`helix badges ${r.status}`);
  const j = (await r.json()) as HelixBadges;
  const m: BadgeMap = new Map();
  for (const set of j.data ?? [])
    for (const v of set.versions ?? []) {
      const img = v.image_url_2x || v.image_url_4x || v.image_url_1x;
      if (img) m.set(`${set.set_id}/${v.id}`, img);
    }
  return m;
}

function warmGlobal(): void {
  if (globalMap || globalPending || !twitchConfigured()) return;
  globalPending = fetchBadgeSet("https://api.twitch.tv/helix/chat/badges/global")
    .then((m) => {
      globalMap = m;
    })
    .catch((e) => logger.debug({ err: String(e) }, "twitch global badges fetch failed"))
    .finally(() => {
      globalPending = null;
    });
}

function warmChannel(roomId: string): void {
  if (channelMaps.has(roomId) || channelPending.has(roomId) || !twitchConfigured()) return;
  const p = fetchBadgeSet(`https://api.twitch.tv/helix/chat/badges?broadcaster_id=${roomId}`)
    .then((m) => {
      channelMaps.set(roomId, m);
    })
    .catch((e) => logger.debug({ err: String(e), roomId }, "twitch channel badges fetch failed"))
    .finally(() => {
      channelPending.delete(roomId);
    });
  channelPending.set(roomId, p);
}

/** Channel-custom badge image first, then global. Warms caches in the background; returns
 * undefined until they load (first messages glyph-fall-back, then images appear live). */
export function twitchBadgeImage(roomId: string | undefined, set: string, version: string): string | undefined {
  warmGlobal();
  if (roomId) warmChannel(roomId);
  const key = `${set}/${version}`;
  return (roomId ? channelMaps.get(roomId)?.get(key) : undefined) ?? globalMap?.get(key) ?? undefined;
}
