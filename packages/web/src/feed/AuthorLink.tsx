import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatMessage, Platform } from "@app/shared";
import { profileUrl } from "../lib/profile";
import { useChatterStats } from "../state/chatterStats";
import { useAuthorFocus } from "../state/authorFocus";

const PLAT: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "Market Bubble" };

/** Twitch/Kick send no color tag for users who never picked one — instead of rendering
 * them flat white, derive a stable, readable color from the username (like the platforms
 * themselves do for default colors). */
function nameColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 62% 67%)`;
}

/** Username — click to filter the feed to just this chatter; hover for live stats and a
 * link to their platform profile. */
export function AuthorLink({ m, className = "author" }: { m: ChatMessage; className?: string }) {
  const href = profileUrl(m.platform, m.author.username);
  const color = m.author.color || nameColor(m.author.username);
  const style = { color };
  const statsFor = useChatterStats();
  const { setFocus } = useAuthorFocus();
  const [card, setCard] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const open = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const CARD_H = 120;
      const x = Math.min(r.left, window.innerWidth - 250);
      // flip above the name if it would overflow the bottom of the viewport
      const y = r.bottom + CARD_H > window.innerHeight ? Math.max(8, r.top - CARD_H) : r.bottom + 6;
      setCard({ x, y });
    }, 200);
  };
  const close = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCard(null), 120);
  };
  const keepOpen = () => window.clearTimeout(timer.current);

  const stats = card ? statsFor(m.platform, m.author.username) : null;
  const label = m.author.displayName;
  // clicking the name filters the feed to this user; the profile link lives in the hovercard
  const inner = (
    <span
      className={className}
      style={{ ...style, cursor: "pointer" }}
      role="button"
      tabIndex={0}
      title={`Show only ${label}'s messages`}
      onClick={() => setFocus(m)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setFocus(m);
        }
      }}
    >
      {label}
    </span>
  );

  return (
    <span className="author-wrap" onMouseEnter={open} onMouseLeave={close}>
      {inner}
      {card &&
        createPortal(
          <div
            className="hovercard"
            style={{ left: card.x, top: card.y }}
            onMouseEnter={keepOpen}
            onMouseLeave={close}
          >
            <div className="hc-top">
              <span className="hc-dot" style={{ background: color }} />
              <span className="hc-name">{label}</span>
              <span className={`pill ${m.platform}`}>{PLAT[m.platform]}</span>
            </div>
            <div className="hc-handle">@{m.author.username}</div>
            {stats ? (
              <div className="hc-stats">
                <b>{stats.count}</b> msg{stats.count !== 1 ? "s" : ""} this session · <b>{stats.perMin.toFixed(1)}</b>/min
              </div>
            ) : (
              <div className="hc-stats muted">new here</div>
            )}
            {href && (
              <a className="hc-link" href={href} target="_blank" rel="noopener noreferrer">
                Open profile ↗
              </a>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
