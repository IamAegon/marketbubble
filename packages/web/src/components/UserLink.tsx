import type { CSSProperties, ReactNode } from "react";
import type { Platform } from "@app/shared";
import { channelUrl, profileUrl } from "../lib/profile";

/** A username / handle / streamer name that links to its public profile, opening in
 * a new tab. Falls back to plain text when there's no external profile (internal MB
 * users, "anon", missing username), so it's a drop-in anywhere. stopPropagation keeps
 * it working inside clickable rows/buttons. */
export function UserLink({
  platform,
  username,
  name,
  kind = "chatter",
  className,
  style,
  children,
}: {
  platform: Platform;
  username: string | undefined;
  /** display text (defaults to the username) */
  name?: string;
  /** "streamer" links to the channel page; "chatter" to the user profile (same URL on twitch/kick/x) */
  kind?: "chatter" | "streamer";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const href = kind === "streamer" ? channelUrl(platform, username) : profileUrl(platform, username);
  const label = children ?? name ?? username ?? "";
  if (!href) {
    return (
      <span className={className} style={style}>
        {label}
      </span>
    );
  }
  return (
    <a
      className={className}
      style={style}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  );
}
