import type { ConnectorInfo, Platform } from "@app/shared";

export interface StreamSource {
  id: string;
  platform: Platform;
  label: string;
  /** iframe-embeddable player URL (Twitch/Kick), or null when not embeddable (X) */
  embedUrl: string | null;
  /** X broadcast id — played via the server HLS proxy (no iframe) */
  xBroadcastId?: string;
  /** external "watch" URL */
  watchUrl: string;
  live: boolean;
}

/** Parse the channel key out of a connector id (e.g. "twitch:#fazebanks" -> "fazebanks"). */
function keyOf(id: string): string {
  const rest = id.slice(id.indexOf(":") + 1);
  return rest.replace(/^#/, "");
}

/** Build the embeddable player URL for a stream connector. `liveIds` (from the viewer
 * poller) is the set of connectors actually streaming now; when provided we trust it for
 * Twitch/Kick (their chat sockets connect to offline channels too). X broadcasts have no
 * live API here, so they fall back to connection state. */
export function playerFor(c: ConnectorInfo, host: string, liveIds?: Set<string>): StreamSource | null {
  // exclude native rooms and X news (tracked-account) connectors — not live streams
  if (c.platform === "mb") return null;
  if (c.platform === "x" && c.id.startsWith("xnews:")) return null;

  const key = keyOf(c.id);
  const connected = c.status.kind === "connected";
  // Twitch/Kick: trust the live API set when we have it; X (no live API): use connection
  const live = c.platform === "x" ? connected : liveIds ? liveIds.has(c.id) : connected;

  if (c.platform === "twitch") {
    return {
      id: c.id,
      platform: "twitch",
      label: c.label,
      embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(key)}&parent=${host}&muted=true&autoplay=true`,
      watchUrl: `https://www.twitch.tv/${key}`,
      live,
    };
  }
  if (c.platform === "kick") {
    // start muted (default is unmuted) so it doesn't blast; unmute via the player's own controls
    return {
      id: c.id,
      platform: "kick",
      label: c.label,
      embedUrl: `https://player.kick.com/${encodeURIComponent(key)}?autoplay=true&muted=true`,
      watchUrl: `https://kick.com/${key}`,
      live,
    };
  }
  if (c.platform === "x") {
    // X Live broadcasts can't be iframed — played via the server HLS proxy instead.
    return {
      id: c.id,
      platform: "x",
      label: c.label,
      embedUrl: null,
      xBroadcastId: key,
      watchUrl: `https://x.com/i/broadcasts/${key}`,
      live,
    };
  }
  return null;
}

/** All embeddable/known stream sources from the connector list. Pass `liveIds` (the
 * viewer poller's live set) so Twitch/Kick live dots reflect real stream state. */
export function streamSources(connectors: ConnectorInfo[], host: string, liveIds?: Set<string>): StreamSource[] {
  return connectors.map((c) => playerFor(c, host, liveIds)).filter((s): s is StreamSource => s !== null);
}
