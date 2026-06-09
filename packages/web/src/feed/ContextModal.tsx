import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { ChatMessage, Platform } from "@app/shared";
import { fetchAround } from "../lib/search";
import { jumpToMessage } from "../lib/jumpBus";
import { UserLink } from "../components/UserLink";

const PILL: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };
const clock = (t: number) =>
  new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Jump-to-context: shows the conversation surrounding a search hit (the hit's
 * same-channel neighbours), highlighting and scrolling to the matched message. */
export function ContextModal({ hit, onClose }: { hit: ChatMessage; onClose: () => void }) {
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    let dead = false;
    fetchAround(hit.id).then((m) => !dead && setMsgs(m.length ? m : [hit]));
    return () => {
      dead = true;
    };
  }, [hit.id]);

  useEffect(() => {
    if (msgs) hitRef.current?.scrollIntoView({ block: "center" });
  }, [msgs]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const openInLive = () => {
    onClose();
    nav("/app");
    window.setTimeout(() => jumpToMessage(hit.id), 140);
  };

  return createPortal(
    <div className="ctx-overlay" onClick={onClose}>
      <div className="ctx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ctx-head">
          <div className="ctx-title">
            <span className={`pill ${hit.platform}`}>{PILL[hit.platform]}</span>
            <span className="ctx-ch">{hit.channelLabel}</span>
            <span className="ctx-at">{clock(hit.timestamp)}</span>
          </div>
          <div className="ctx-acts">
            <button className="cc-chip" onClick={openInLive} title="Scroll to it in the live feed">
              Open in Live →
            </button>
            <button className="cc-icon-btn" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </div>
        <div className="ctx-body">
          {msgs === null ? (
            <div className="ctx-loading">
              <div className="report-spin" />
              <span>Loading conversation…</span>
            </div>
          ) : (
            msgs.map((m) => (
              <div key={m.id} ref={m.id === hit.id ? hitRef : undefined} className={`ctx-row ${m.id === hit.id ? "hit" : ""}`}>
                <span className="ctx-time">{new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <UserLink
                  platform={m.platform}
                  username={m.author.username}
                  name={m.author.displayName}
                  className="ctx-author"
                  style={m.author.color ? { color: m.author.color } : undefined}
                />
                <span className="ctx-text">{m.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
