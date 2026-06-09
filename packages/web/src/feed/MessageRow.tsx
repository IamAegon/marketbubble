import React, { useState } from "react";
import type { Badge, ChatMessage, Platform } from "@app/shared";
import { renderRich } from "../render/emotes";
import { mdToHtml } from "../lib/markdown";
import { useRowActions } from "./actions";
import { usePrices } from "../state/prices";
import { useHighlights } from "../state/highlights";
import { useShareCard } from "./ShareCard";
import { AuthorLink } from "./AuthorLink";
import { ModMenu } from "./ModMenu";
import { FitName } from "./FitName";
import { useMbAvatar } from "../state/mbAvatars";
import { useAuth } from "../state/useAuth";
import { usePlatform } from "../state/usePlatform";

const PILL: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };

// status badges worth surfacing (broadcaster/mod/vip/sub/verified) → a compact glyph +
// tone. Everything else (turbo, bits, prime, …) is intentionally dropped to stay clean.
const BADGE_META: Record<string, { glyph: string; cls: string; label: string }> = {
  broadcaster: { glyph: "●", cls: "b-host", label: "Broadcaster" },
  moderator: { glyph: "⚔", cls: "b-mod", label: "Moderator" },
  vip: { glyph: "◆", cls: "b-vip", label: "VIP" },
  og: { glyph: "◆", cls: "b-vip", label: "OG" },
  subscriber: { glyph: "★", cls: "b-sub", label: "Subscriber" },
  founder: { glyph: "★", cls: "b-sub", label: "Founder" },
  verified: { glyph: "✓", cls: "b-ver", label: "Verified" },
  partner: { glyph: "✓", cls: "b-ver", label: "Partner" },
};

function MsgBadges({ badges }: { badges?: Badge[] }) {
  if (!badges?.length) return null;
  const seen = new Set<string>();
  const chips = [];
  for (const b of badges) {
    // real platform badge art (Twitch Helix) — show the actual icon like twitch.tv does
    if (b.imageUrl) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      chips.push(<img key={b.id} className="msg-badge-img" src={b.imageUrl} alt={b.title} title={b.title} loading="lazy" />);
      continue;
    }
    // fallback: styled glyph chip for the meaningful status badges (e.g. Kick, or before
    // Twitch badge art loads) — dedupe by tone so we don't stack identical chips
    const meta = BADGE_META[b.title];
    if (!meta || seen.has(meta.cls)) continue;
    seen.add(meta.cls);
    const v = b.title === "subscriber" || b.title === "founder" ? Number(b.id.split("/")[1]) : NaN;
    const months = Number.isFinite(v) && v > 1 ? v : null;
    chips.push(
      <span key={b.id} className={`msg-badge ${meta.cls}`} title={meta.label + (months ? ` · ${months} mo` : "")}>
        {meta.glyph}
        {months ? <span className="msg-badge-n">{months}</span> : null}
      </span>,
    );
  }
  return chips.length ? <span className="msg-badges">{chips}</span> : null;
}

const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export const MessageRow = React.memo(function MessageRow({
  m,
  showChannel = true,
  showPill = true,
  bare = false,
  flash = false,
  streamerTag = false,
}: {
  m: ChatMessage;
  showChannel?: boolean;
  /** show the platform pill (hidden in Columns view where the column header says it) */
  showPill?: boolean;
  /** overlay/OBS mode: hide interactive action buttons */
  bare?: boolean;
  /** transient glow when jumped-to from a notification */
  flash?: boolean;
  /** show the source as one prominent platform-colored streamer chip (Showcase) instead
   *  of the small pill + muted channel name */
  streamerTag?: boolean;
}) {
  const { isSaved, toggleSave, hasNote, addNote, reply, forward } = useRowActions();
  const prices = usePrices();
  const { match } = useHighlights();
  const share = useShareCard();
  const mbAv = useMbAvatar();
  const saved = isSaved(m.id);
  const noted = hasNote(m.id);
  const hl = match(m.text);
  // resolve MB avatars live (so changing your avatar updates old messages too)
  const mbProf = m.platform === "mb" ? mbAv.get(m.author.username) : undefined;
  const avatarUrl = mbProf?.avatarUrl ?? m.author.avatarUrl;
  const avatarColor = mbProf?.color ?? m.author.color;
  // linked-account actions: reply/post (any linked user) + moderate (mods of the channel)
  const { user } = useAuth();
  const { twitchLinked, kickLinked } = usePlatform();
  const canPost = (twitchLinked && m.platform === "twitch") || (kickLinked && m.platform === "kick");
  const canMod = canPost && (user?.role === "mod" || user?.role === "admin") && !!m.author.platformUserId;
  // reply lands in the main bottom composer (MB rooms always; Twitch/Kick when linked)
  const canReply = m.platform === "mb" || canPost;
  // secondary actions (note/share/mod) hide behind a ⋯ toggle to keep the hover bar tidy
  const [more, setMore] = useState(false);
  // the message body (reply ref + avatar + badges + author + text/embed). In Showcase it's
  // wrapped in a content column so it aligns beside the fixed source gutter (elite grid).
  const body = (
    <>
      {m.replyTo ? (
        <span className="reply" title={m.replyTo.textPreview}>
          ↳ {m.replyTo.author}
          {m.replyTo.textPreview ? `: ${m.replyTo.textPreview}` : ""}
        </span>
      ) : null}
      {avatarUrl ? (
        <img className="msg-avatar" src={avatarUrl} alt="" loading="lazy" />
      ) : m.platform === "mb" ? (
        <span className="msg-avatar msg-avatar-fb" style={{ background: avatarColor || "var(--accent)" }}>
          {m.author.displayName.slice(0, 1).toUpperCase()}
        </span>
      ) : null}
      <MsgBadges badges={m.badges} />
      <AuthorLink m={m} />
      {m.embed ? (
        <div className={`msg-embed msg-embed-${m.embed.kind}`}>
          <div className="msg-embed-head">
            <span className="msg-embed-mark">{m.embed.kind === "x" ? "𝕏" : m.embed.kind === "news" ? "📰" : "✦"}</span>
            <span className="msg-embed-title">
              {m.embed.title || (m.embed.kind === "x" ? "Tweet" : m.embed.kind === "news" ? "News" : "Assistant")}
            </span>
            {m.embed.link && (
              <a className="msg-embed-link" href={m.embed.link} target="_blank" rel="noopener noreferrer">
                Open ↗
              </a>
            )}
          </div>
          <div className="msg-embed-body" dangerouslySetInnerHTML={{ __html: mdToHtml(m.embed.markdown) }} />
        </div>
      ) : (
        <span className="text">{renderRich(m.text, { emotes: m.emotes, cashtags: m.cashtags, prices })}</span>
      )}
    </>
  );
  return (
    <>
    <div className={`row ${saved ? "row-saved" : ""} ${hl ? "row-hl" : ""} ${flash ? "row-flash" : ""} ${m.kind === "caption" ? "row-caption" : ""}`}>
      {/* floated first so the text wraps around it (never overlaps) at any column width */}
      <time className="msg-time" dateTime={new Date(m.timestamp).toISOString()} title={new Date(m.timestamp).toLocaleString()}>
        {fmtTime(m.timestamp)}
      </time>
      {streamerTag ? (
        <span className="src" title={`${m.channelLabel} · ${PILL[m.platform]}`}>
          <span className={`src-p ${m.platform}`}>{PILL[m.platform]}</span>
          <FitName className="src-n" name={(m.channelLabel || "").replace(/^#/, "")} />
        </span>
      ) : (
        <>
          {showPill && <span className={`pill ${m.platform}`}>{PILL[m.platform]}</span>}
          {showChannel && (
            <span className="channel" title={m.channelLabel}>
              {m.channelLabel}
            </span>
          )}
        </>
      )}
      {streamerTag ? <span className="row-content">{body}</span> : body}
      {!bare && (
      <span className="row-actions">
        {canReply && (
          <button
            className="act"
            title={m.platform === "mb" ? "Reply" : "Reply from the composer as your linked account"}
            onClick={() => reply(m)}
          >
            ↩
          </button>
        )}
        <button className="act" title="Forward to a Market Bubble room" onClick={() => forward(m)}>
          ↪
        </button>
        <button
          className={`act ${saved ? "act-on" : ""}`}
          title={saved ? "Unsave" : "Save message"}
          onClick={() => toggleSave(m)}
        >
          {saved ? "★" : "☆"}
        </button>
        {/* moderation is first-class for mods — one click opens the full per-user menu
            (timeout/ban/unban/delete) instead of hunting cramped glyphs behind ⋯ */}
        {canMod && <ModMenu m={m} />}
        {more && (
          <>
            <button
              className={`act ${noted ? "act-on" : ""}`}
              title={noted ? "Edit note" : "Add a note"}
              onClick={() => addNote(m)}
            >
              ✎
            </button>
            <button className="act" title="Share as image" onClick={() => share.open(m)}>
              ⇪
            </button>
          </>
        )}
        <button
          className={`act ${more ? "act-on" : ""}`}
          title={more ? "Fewer actions" : "More actions"}
          onClick={() => setMore((v) => !v)}
        >
          ⋯
        </button>
      </span>
      )}
    </div>
    </>
  );
});
