import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Platform } from "@app/shared";
import { searchMessages } from "../lib/search";
import { ContextModal } from "./ContextModal";
import { UserLink } from "../components/UserLink";

const PILL: Record<Platform, string> = { twitch: "Twitch", x: "X", kick: "Kick", mb: "MB" };

/** Top-bar cross-chat search: debounced query against /api/search with a results
 * dropdown. Results are access-filtered server-side; X posts link out. */
export function SearchBox() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [durable, setDurable] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ctx, setCtx] = useState<ChatMessage | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await searchMessages(q.trim());
      setResults(r.results);
      setDurable(r.durable);
      setLoading(false);
      setOpen(true);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div className="cc-searchbox" ref={box}>
      <input
        className="cc-search"
        placeholder="Search messages…  ⌘K"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      {open && q.trim() && (
        <div className="search-results">
          <div className="search-meta">
            {loading ? "Searching…" : `${results.length} match${results.length !== 1 ? "es" : ""}`}
            {!loading && (durable ? " · all history" : " · this session")}
          </div>
          {!loading && results.length === 0 && <div className="cc-empty-sm" style={{ padding: 10 }}>No matches</div>}
          {results.map((m) =>
            m.link ? (
              <a key={m.id} className="search-row" href={m.link} target="_blank" rel="noopener noreferrer">
                <span className={`pill ${m.platform}`}>{PILL[m.platform]}</span>
                <span className="search-author" style={m.author.color ? { color: m.author.color } : undefined}>
                  {m.author.displayName}
                </span>
                <span className="search-text">{m.text}</span>
                <span className="search-ch">{m.channelLabel} ↗</span>
              </a>
            ) : (
              <button
                key={m.id}
                className="search-row"
                onClick={() => {
                  setCtx(m);
                  setOpen(false);
                }}
                title="See this moment in context"
              >
                <span className={`pill ${m.platform}`}>{PILL[m.platform]}</span>
                <UserLink
                  platform={m.platform}
                  username={m.author.username}
                  name={m.author.displayName}
                  className="search-author"
                  style={m.author.color ? { color: m.author.color } : undefined}
                />
                <span className="search-text">{m.text}</span>
                <span className="search-ch">{m.channelLabel}</span>
              </button>
            ),
          )}
        </div>
      )}
      {ctx && <ContextModal hit={ctx} onClose={() => setCtx(null)} />}
    </div>
  );
}
