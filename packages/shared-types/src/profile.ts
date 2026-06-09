import type { Platform } from "./chat-message";

/** Public profile URL for a chatter on each platform. Pure — shared by the web UI
 * (link-out) and the server reaction fold (chatter driver links). */
export function profileUrl(platform: Platform, username: string | undefined): string | null {
  const u = (username ?? "").trim().replace(/^@/, "");
  if (!u || u.toLowerCase() === "anon") return null;
  switch (platform) {
    case "twitch":
      return `https://www.twitch.tv/${u}`;
    case "kick":
      return `https://kick.com/${u}`;
    case "x":
      return `https://x.com/${u}`;
    default:
      return null; // 'mb' (native room) has no external profile
  }
}

/** A channel's public URL (== its profile URL for twitch/kick/x). Accepts a bare
 * channel/handle or a connector id like "twitch:#fazebanks". */
export function channelUrl(platform: Platform, channel: string | undefined): string | null {
  return profileUrl(platform, channel?.replace(/^.*[:#]/, ""));
}
