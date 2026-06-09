import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { useDashboard } from "../state/DashboardProvider";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const focusComposer = () =>
  setTimeout(() => (document.querySelector(".composer-input") as HTMLInputElement | null)?.focus(), 60);

export function CommandPalette() {
  const nav = useNavigate();
  const d = useDashboard();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setI(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const cmds: Cmd[] = useMemo(
    () => [
      {
        id: "search",
        label: "Search messages…",
        hint: "search",
        run: () => {
          nav("/app");
          setTimeout(() => (document.querySelector(".cc-search") as HTMLInputElement | null)?.focus(), 60);
        },
      },
      { id: "live", label: "Go to Live", hint: "view", run: () => nav("/app") },
      { id: "markets", label: "Go to Markets", hint: "view", run: () => nav("/app/markets") },
      { id: "analytics", label: "Go to Analytics", hint: "view", run: () => nav("/app/analytics") },
      { id: "settings", label: "Go to Settings", hint: "view", run: () => nav("/app/settings") },
      { id: "addstream", label: "Add a stream…", hint: "settings", run: () => nav("/app/settings") },
      { id: "track", label: "Track an X account…", hint: "settings", run: () => nav("/app/settings") },
      { id: "ticker", label: "Toggle market ticker", hint: "layout", run: () => d.layout.toggleTicker() },
      { id: "rail", label: "Toggle right rail", hint: "layout", run: () => d.layout.toggleRail() },
      { id: "saved", label: "Show saved messages", hint: "layout", run: () => { nav("/app"); d.layout.showSaved(); } },
      { id: "compose", label: "Focus composer", hint: "chat", run: () => { nav("/app"); focusComposer(); } },
      { id: "unified", label: "Chat view: Unified", hint: "chat", run: () => { nav("/app"); d.setView("unified"); } },
      { id: "columns", label: "Chat view: Columns", hint: "chat", run: () => { nav("/app"); d.setView("columns"); } },
    ],
    [nav, d],
  );

  const filtered = useMemo(
    () => cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())),
    [cmds, q],
  );
  const exec = (c?: Cmd) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  if (!open) return null;
  return createPortal(
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Type a command…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setI((x) => Math.min(x + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setI((x) => Math.max(x - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              exec(filtered[i]);
            }
          }}
        />
        <div className="cmdk-list">
          {filtered.length === 0 && <div className="cc-empty-sm" style={{ padding: 12 }}>No commands</div>}
          {filtered.map((c, idx) => (
            <button
              key={c.id}
              className={`cmdk-item ${idx === i ? "active" : ""}`}
              onMouseEnter={() => setI(idx)}
              onClick={() => exec(c)}
            >
              <span>{c.label}</span>
              {c.hint && <span className="cmdk-hint">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
