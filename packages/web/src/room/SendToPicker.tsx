import { useMemo, useState } from "react";
import type { RoomInfo } from "@app/shared";
import { roomIcon } from "../lib/roomLabel";

interface StreamTarget {
  id: string;
  label: string;
  platform: string;
}

/** Compact destination picker for the composer: the bar shows only the selected
 * chats (+ a "Send to ▾" button); the full grouped, filterable list lives in a
 * popover, so it stays one clean line no matter how many streams are connected. */
export function SendToPicker({
  rooms,
  streams,
  enabledPlatforms,
  targets,
  onToggle,
}: {
  rooms: RoomInfo[];
  streams: StreamTarget[];
  /** platforms the user has linked (and can therefore post to) */
  enabledPlatforms: Set<string>;
  targets: Set<string>;
  onToggle: (id: string, isRoom: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = useMemo(() => {
    const out: { id: string; label: string; isRoom: boolean; platform?: string }[] = [];
    for (const r of rooms) if (targets.has(r.id)) out.push({ id: r.id, label: r.label, isRoom: true });
    for (const s of streams) if (targets.has(s.id)) out.push({ id: s.id, label: s.label, isRoom: false, platform: s.platform });
    return out;
  }, [rooms, streams, targets]);

  const ql = q.trim().toLowerCase();
  const roomMatch = rooms.filter((r) => !ql || r.label.toLowerCase().includes(ql));
  const streamMatch = streams.filter((s) => !ql || s.label.toLowerCase().includes(ql));

  return (
    <div className="sendto">
      <button type="button" className={`sendto-btn ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Send to <span className="sendto-caret">▾</span>
      </button>
      <div className="sendto-chips">
        {selected.length === 0 ? (
          <span className="sendto-empty">pick a chat →</span>
        ) : (
          selected.map((s) => (
            <span className={`sendto-chip ${s.isRoom ? "" : "stream"}`} key={s.id}>
              {s.platform && <span className={`pill ${s.platform}`}>{s.platform}</span>}
              {s.label}
              <button type="button" className="sendto-x" title="Remove" onClick={() => onToggle(s.id, s.isRoom)}>
                ✕
              </button>
            </span>
          ))
        )}
      </div>

      {open && (
        <>
          <div className="sendto-backdrop" onClick={() => setOpen(false)} />
          <div className="sendto-pop" role="listbox">
            <input
              className="sendto-filter"
              autoFocus
              placeholder="Filter chats…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="sendto-scroll">
              <div className="sendto-group-h">Rooms</div>
              {roomMatch.map((r) => (
                <label className="sendto-row" key={r.id}>
                  <input type="checkbox" checked={targets.has(r.id)} onChange={() => onToggle(r.id, true)} />
                  <span className="sendto-row-ic">{roomIcon(r)}</span>
                  <span className="sendto-row-lbl">{r.label}</span>
                </label>
              ))}
              <div className="sendto-group-h">Streams</div>
              {streamMatch.length === 0 && <div className="sendto-none">no streams</div>}
              {streamMatch.map((s) => {
                const on = enabledPlatforms.has(s.platform);
                return (
                  <label
                    className={`sendto-row ${!on ? "disabled" : ""}`}
                    key={s.id}
                    title={!on ? `Connect ${s.platform} in Settings → Connections to post` : undefined}
                  >
                    <input type="checkbox" disabled={!on} checked={targets.has(s.id)} onChange={() => onToggle(s.id, false)} />
                    <span className={`pill ${s.platform}`}>{s.platform}</span>
                    <span className="sendto-row-lbl">{s.label}</span>
                    {!on && <span className="sendto-hint">connect {s.platform}</span>}
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
