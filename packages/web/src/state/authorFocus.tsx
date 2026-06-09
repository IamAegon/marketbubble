import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ChatMessage, Platform } from "@app/shared";

const PLAT: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };

export interface FocusedAuthor {
  username: string;
  /** stable per-user id when the platform provides one (X user_id, Twitch/Kick sender id);
   * preferred over username, which can collapse to "anon" on X broadcast chat. */
  userId?: string;
  platform: Platform;
  label: string;
  color?: string;
}

interface AuthorFocusApi {
  focus: FocusedAuthor | null;
  setFocus: (m: ChatMessage) => void;
  clear: () => void;
  /** true if this message should be shown given the current focus (no focus ⇒ all). */
  matches: (m: ChatMessage) => boolean;
}

const Ctx = createContext<AuthorFocusApi>({ focus: null, setFocus() {}, clear() {}, matches: () => true });
export const useAuthorFocus = () => useContext(Ctx);

/** A live "show only this chatter" filter. Clicking a username anywhere focuses that
 * user; the feed views filter to their messages and a banner offers a one-click clear.
 * Username collides across platforms, so we key on (platform, username). */
export function AuthorFocusProvider({ children }: { children: ReactNode }) {
  const [focus, setFocusState] = useState<FocusedAuthor | null>(null);

  const setFocus = useCallback((m: ChatMessage) => {
    setFocusState({
      username: m.author.username.toLowerCase(),
      userId: m.author.platformUserId,
      platform: m.platform,
      label: m.author.displayName || m.author.username,
      color: m.author.color,
    });
  }, []);
  const clear = useCallback(() => setFocusState(null), []);

  const matches = useCallback(
    (m: ChatMessage) => {
      if (!focus) return true;
      if (m.platform !== focus.platform) return false;
      // prefer the stable id (X chatters share the "anon" username); fall back to
      // username for platforms/messages without one.
      if (focus.userId) return m.author.platformUserId === focus.userId;
      return m.author.username.toLowerCase() === focus.username;
    },
    [focus],
  );

  // Esc clears the filter
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, clear]);

  const value = useMemo(() => ({ focus, setFocus, clear, matches }), [focus, setFocus, clear, matches]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {focus &&
        createPortal(
          <div className="author-focus-bar">
            <span className="afb-dot" style={{ background: focus.color || "var(--accent)" }} />
            <span className="afb-text">
              Showing only <b>{focus.label}</b>
              <span className={`pill ${focus.platform}`}>{PLAT[focus.platform]}</span>
            </span>
            <button className="afb-clear" onClick={clear} title="Clear filter (Esc)">
              Clear ✕
            </button>
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}
