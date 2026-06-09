import type { SideBus } from "../bus/SideBus.js";
import { clientCredentialsToken } from "../connect/oauth-twitch.js";
import { appToken as kickAppToken } from "../connect/oauth-kick.js";
import { getStreams } from "./TwitchClient.js";
import * as kc from "./KickClient.js";
import { getBroadcastViewers } from "../connectors/x/broadcastDiscovery.js";
import type { XGuestAuth } from "../connectors/x/xGuestAuth.js";
import { logger } from "../observability/logger.js";

/** Poll live viewer counts (app tokens) for connected Twitch + Kick channels and
 * broadcast them on the SideBus, keyed by connector id. No-ops per platform when
 * that platform's app isn't configured. */
export function startViewerPoller(deps: {
  sideBus: SideBus;
  twitchLogins: () => string[];
  /** kick connectors as {id, slug} so counts key by the exact connector id */
  kickChannels?: () => { id: string; slug: string }[];
  /** X live-broadcast connectors as {id, broadcastId} for Periscope viewer counts */
  xBroadcasts?: () => { id: string; broadcastId: string }[];
  /** shared X guest auth (required to poll X broadcast viewer counts) */
  xAuth?: XGuestAuth;
  /** notified each tick with the connector ids actually live now (drives auto-recording) */
  onLive?: (liveConnectorIds: string[]) => void;
  signal: AbortSignal;
  intervalMs?: number;
}): void {
  const interval = deps.intervalMs ?? 30_000;
  let timer: NodeJS.Timeout | null = null;
  const kickIdBySlug = new Map<string, string>(); // slug → broadcaster id (cached)

  const tick = async () => {
    if (deps.signal.aborted) return;
    const counts: Record<string, number> = {};
    // a connector is LIVE only if the platform's streams API actually returns it — chat
    // sockets connect to offline channels too, so connection state is not live state.
    const live: string[] = [];

    // Twitch (Helix Get Streams — only LIVE channels are returned)
    try {
      const token = await clientCredentialsToken();
      const logins = deps.twitchLogins();
      if (token && logins.length) {
        const byLogin = await getStreams(token, logins);
        for (const login of logins) {
          const id = `twitch:#${login}`;
          const isLive = login.toLowerCase() in byLogin;
          counts[id] = isLive ? byLogin[login.toLowerCase()]! : 0;
          if (isLive) live.push(id);
        }
      }
    } catch (e) {
      logger.debug({ err: String(e) }, "twitch viewer poll failed");
    }

    // Kick (public livestreams — only LIVE broadcasters are returned)
    try {
      const chans = deps.kickChannels?.() ?? [];
      if (chans.length) {
        const app = await kickAppToken();
        if (app) {
          const want: { id: string; broadcasterId: string }[] = [];
          for (const c of chans) {
            let bid = kickIdBySlug.get(c.slug);
            if (!bid) {
              bid = (await kc.resolveChannelId(app, c.slug)) ?? undefined;
              if (bid) kickIdBySlug.set(c.slug, bid);
            }
            if (bid) want.push({ id: c.id, broadcasterId: bid });
          }
          if (want.length) {
            const byId = await kc.getLivestreams(app, want.map((w) => w.broadcasterId));
            for (const w of want) {
              const isLive = w.broadcasterId in byId;
              counts[w.id] = isLive ? byId[w.broadcasterId]! : 0;
              if (isLive) live.push(w.id);
            }
          }
        }
      }
    } catch (e) {
      logger.debug({ err: String(e) }, "kick viewer poll failed");
    }

    // X live broadcasts (Periscope show.json — current viewers + RUNNING state)
    try {
      const bcs = deps.xBroadcasts?.() ?? [];
      if (bcs.length && deps.xAuth) {
        for (const b of bcs) {
          const r = await getBroadcastViewers(deps.xAuth, b.broadcastId);
          if (!r) continue;
          counts[b.id] = r.live ? r.viewers : 0;
          if (r.live) live.push(b.id);
        }
      }
    } catch (e) {
      logger.debug({ err: String(e) }, "x viewer poll failed");
    }

    // always notify the auto-recorder (even when nothing is live, so it can close
    // sessions for streams that just went offline)
    deps.onLive?.(live);
    if (Object.keys(counts).length) deps.sideBus.publish({ type: "viewers", counts, live });
    if (!deps.signal.aborted) {
      timer = setTimeout(() => void tick(), interval);
      timer.unref?.();
    }
  };

  void tick();
  deps.signal.addEventListener("abort", () => timer && clearTimeout(timer), { once: true });
}
