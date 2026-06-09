import { useState } from "react";
import type { StreamSource } from "./playerUrls";
import { XPlayer } from "./XPlayer";

const PLAT: Record<string, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };

/** One stream player cell. Twitch/Kick = iframe; X = a watch-link card (HLS later).
 * Twitch/Kick embeds can throw client-side playback errors (e.g. Twitch #4000:
 * extensions/audio/cache), so each player carries a reload + pop-out control. */
export function Player({ s }: { s: StreamSource }) {
  const [nonce, setNonce] = useState(0);
  const [muted, setMuted] = useState(true);

  if (s.embedUrl) {
    // flip the player's muted state by rewriting the URL param (the only
    // cross-origin way to mute/unmute an iframe player); remount to apply.
    const src = /muted=(true|false)/.test(s.embedUrl)
      ? s.embedUrl.replace(/muted=(true|false)/, `muted=${muted}`)
      : `${s.embedUrl}${s.embedUrl.includes("?") ? "&" : "?"}muted=${muted}`;
    return (
      <div className="vp">
        {/* key includes muted/nonce so toggling mute (or reload) remounts the iframe */}
        <iframe
          key={`${nonce}-${muted ? "m" : "u"}`}
          className="vp-frame"
          src={src}
          title={s.label}
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture"
          scrolling="no"
        />
        <div className="vp-ctl">
          <button className="vp-btn" title={muted ? "Unmute" : "Mute"} onClick={() => setMuted((m) => !m)}>
            {muted ? "🔇" : "🔊"}
          </button>
          <button className="vp-btn" title="Reload player (fixes Twitch #4000)" onClick={() => setNonce((n) => n + 1)}>
            ⟳
          </button>
          <a className="vp-btn" title={`Open ${s.label} on ${PLAT[s.platform]}`} href={s.watchUrl} target="_blank" rel="noopener noreferrer">
            ↗
          </a>
        </div>
      </div>
    );
  }

  // X Live: not iframe-embeddable — played via the server HLS proxy
  return <XPlayer s={s} />;
}
