import type { EmoteProvider } from "@app/shared";
import { logger } from "../observability/logger.js";

/** A resolved third-party emote: name -> render info. */
export interface EmoteHit {
  id: string;
  url: string;
  provider: EmoteProvider;
  zeroWidth?: boolean;
}
export type EmoteIndex = Map<string, EmoteHit>;

const TTL = 6 * 60 * 60 * 1000; // 6h
const UA = "MarketBubble/1.0 (+emote-sets)";

const channelCache = new Map<string, { idx: EmoteIndex; at: number }>();
const inflight = new Set<string>();
let globalIdx: EmoteIndex | null = null;
let globalAt = 0;
let globalInflight = false;

async function fetchJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { accept: "application/json", "user-agent": UA } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ---- 7TV (Twitch + Kick) ----
function add7tv(idx: EmoteIndex, emotes: any[] | undefined): void {
  for (const e of emotes ?? []) {
    const name = e?.name;
    const id = e?.id;
    if (!name || !id || idx.has(name)) continue;
    idx.set(name, { id, url: `https://cdn.7tv.app/emote/${id}/2x.webp`, provider: "7tv", zeroWidth: (e.flags & 1) === 1 });
  }
}
async function load7tvGlobal(idx: EmoteIndex) {
  add7tv(idx, (await fetchJson("https://7tv.io/v3/emote-sets/global"))?.emotes);
}
async function load7tvUser(idx: EmoteIndex, platform: "twitch" | "kick", id: string) {
  add7tv(idx, (await fetchJson(`https://7tv.io/v3/users/${platform}/${id}`))?.emote_set?.emotes);
}

// ---- BTTV (Twitch only) ----
// BTTV has no zero-width flag in its API — well-known overlay emotes by code:
const BTTV_ZERO_WIDTH = new Set(["SoSnowy", "IceCold", "SantaHat", "TopHat", "ReinDeer", "CandyCane", "cvMask", "cvHazmat"]);
function addBttv(idx: EmoteIndex, arr: any[] | undefined): void {
  for (const e of arr ?? []) {
    const name = e?.code;
    const id = e?.id;
    if (!name || !id || idx.has(name)) continue;
    idx.set(name, { id, url: `https://cdn.betterttv.net/emote/${id}/2x.webp`, provider: "bttv", zeroWidth: BTTV_ZERO_WIDTH.has(name) });
  }
}
async function loadBttvGlobal(idx: EmoteIndex) {
  const j = await fetchJson("https://api.betterttv.net/3/cached/emotes/global");
  addBttv(idx, Array.isArray(j) ? j : []);
}
async function loadBttvTwitch(idx: EmoteIndex, id: string) {
  const j = await fetchJson(`https://api.betterttv.net/3/cached/users/twitch/${id}`);
  if (j) {
    addBttv(idx, j.channelEmotes);
    addBttv(idx, j.sharedEmotes);
  }
}

// ---- FFZ (Twitch only) ----
function addFfz(idx: EmoteIndex, sets: any, setIds: string[]): void {
  for (const sid of setIds) {
    for (const e of sets?.[sid]?.emoticons ?? []) {
      if (e?.modifier) continue; // FFZ "effect" modifiers, not renderable overlays
      const name = e?.name;
      const raw = e?.urls?.["4"] || e?.urls?.["2"] || e?.urls?.["1"];
      if (!name || !raw || idx.has(name)) continue;
      const url = String(raw).startsWith("//") ? `https:${raw}` : String(raw);
      idx.set(name, { id: String(e.id), url, provider: "ffz" });
    }
  }
}
async function loadFfzGlobal(idx: EmoteIndex) {
  const j = await fetchJson("https://api.frankerfacez.com/v1/set/global");
  if (j) addFfz(idx, j.sets, (j.default_sets ?? []).map(String));
}
async function loadFfzTwitch(idx: EmoteIndex, id: string) {
  const j = await fetchJson(`https://api.frankerfacez.com/v1/room/id/${id}`);
  if (j?.room?.set != null) addFfz(idx, j.sets, [String(j.room.set)]);
}

async function ensureGlobal(): Promise<EmoteIndex> {
  if (globalIdx && Date.now() - globalAt < TTL) return globalIdx;
  if (globalInflight && globalIdx) return globalIdx;
  globalInflight = true;
  try {
    const idx: EmoteIndex = new Map();
    await Promise.all([load7tvGlobal(idx), loadBttvGlobal(idx), loadFfzGlobal(idx)]);
    globalIdx = idx;
    globalAt = Date.now();
    logger.info({ emotes: idx.size }, "global 3rd-party emote set cached");
  } finally {
    globalInflight = false;
  }
  return globalIdx!;
}

async function buildChannel(platform: "twitch" | "kick", channelId: string): Promise<EmoteIndex> {
  const idx: EmoteIndex = new Map();
  if (platform === "twitch") {
    await Promise.all([load7tvUser(idx, "twitch", channelId), loadBttvTwitch(idx, channelId), loadFfzTwitch(idx, channelId)]);
  } else {
    await load7tvUser(idx, "kick", channelId);
  }
  return idx;
}

/** Warm the global emote set at startup so the first messages resolve emotes. */
export function primeGlobalEmotes(): void {
  ensureGlobal().catch((e) => logger.warn({ err: String(e) }, "prime global emotes failed"));
}

/**
 * Synchronously return the cached emote index for a channel (channel set merged
 * over globals). On a cache miss, kicks off a background fetch and returns the
 * global set (or null) in the meantime, so it never blocks the message path.
 */
export function getChannelEmotes(platform: "twitch" | "kick", channelId: string | undefined): EmoteIndex | null {
  if (!channelId) return globalIdx;
  const key = `${platform}:${channelId}`;
  const hit = channelCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.idx;
  if (!inflight.has(key)) {
    inflight.add(key);
    void (async () => {
      try {
        const g = await ensureGlobal();
        const ch = await buildChannel(platform, channelId);
        const merged: EmoteIndex = new Map(g);
        for (const [k, v] of ch) merged.set(k, v); // channel overrides global
        channelCache.set(key, { idx: merged, at: Date.now() });
        logger.info({ platform, channelId, emotes: merged.size }, "channel 3rd-party emote set cached");
      } catch (e) {
        logger.warn({ err: String(e), platform, channelId }, "channel emote set build failed");
      } finally {
        inflight.delete(key);
      }
    })();
  }
  return hit?.idx ?? globalIdx;
}
