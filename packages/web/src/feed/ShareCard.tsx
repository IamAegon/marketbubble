import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toPng } from "html-to-image";
import type { ChatMessage, Platform } from "@app/shared";
import { renderRich } from "../render/emotes";

const PLAT: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "Market Bubble" };

interface ShareApi {
  open: (m: ChatMessage) => void;
}
const Ctx = createContext<ShareApi>({ open() {} });
export const useShareCard = () => useContext(Ctx);

export function ShareCardProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ChatMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const open = useCallback((m: ChatMessage) => {
    setErr(false);
    setMsg(m);
  }, []);
  const value = useMemo(() => ({ open }), [open]);

  const download = async () => {
    if (!cardRef.current) return;
    setBusy(true);
    setErr(false);
    try {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0e0c0b";
      const url = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: bg });
      const a = document.createElement("a");
      a.download = `marketbubble-${msg?.author.username ?? "clip"}.png`;
      a.href = url;
      a.click();
    } catch (e) {
      console.error("share-card export failed", e);
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {msg &&
        createPortal(
          <div className="share-overlay" onClick={() => setMsg(null)}>
            <div className="share-modal" onClick={(e) => e.stopPropagation()}>
              <div className="share-card" ref={cardRef}>
                <span className="share-accent" />
                <div className="share-head">
                  <span className="share-mark">◗</span>
                  <span className="share-wordmark">
                    <span className="share-name">Market Bubble</span>
                    <span className="share-tag">Read the tape</span>
                  </span>
                </div>
                <div className="share-quote">
                  <span className="share-qmark">“</span>
                  <div className="share-text">{renderRich(msg.text, { emotes: msg.emotes, cashtags: msg.cashtags })}</div>
                </div>
                <div className="share-author">
                  <span className="hc-dot" style={{ background: msg.author.color || "var(--accent)" }} />
                  <b>{msg.author.displayName}</b>
                  <span className={`pill ${msg.platform}`}>{PLAT[msg.platform]}</span>
                </div>
                <div className="share-foot">
                  <span className="share-foot-dom">marketbubble.com</span>
                  <span className="share-foot-src">{msg.channelLabel}</span>
                </div>
              </div>
              {err && <div className="share-err">Couldn’t render the image — please try again.</div>}
              <div className="share-actions">
                <button className="auth-btn" onClick={download} disabled={busy}>
                  {busy ? "Rendering…" : "Download PNG"}
                </button>
                <button className="cc-icon-btn" onClick={() => setMsg(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}
