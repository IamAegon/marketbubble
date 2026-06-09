import { useState } from "react";
import type { DirectoryUser, RoomInfo, User } from "@app/shared";
import { roomIcon } from "../lib/roomLabel";

interface Props {
  rooms: RoomInfo[];
  active: string;
  onSelect: (id: string) => void;
  me: User | null;
  /** teammate directory (handle → display/color/avatar) for DM avatars */
  directory: DirectoryUser[];
  /** room ids the user has hidden from their own view */
  hidden: string[];
  onToggleHidden: (id: string) => void;
  onNewDm: () => void;
  onManage: (room: RoomInfo) => void;
  onDelete: (room: RoomInfo) => void;
}

/** Discord-style left rail: built-in Channels + your Direct Messages, each with a
 * per-row options menu (hide for me / manage / delete) gated by role + ownership. */
export function RoomsSidebar({ rooms, active, onSelect, me, directory, hidden, onToggleHidden, onNewDm, onManage, onDelete }: Props) {
  const [menu, setMenu] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const channels = rooms.filter((r) => !r.members);
  const dms = rooms.filter((r) => r.members);
  const shownDms = dms.filter((r) => showHidden || !hidden.includes(r.id));
  const hiddenCount = dms.filter((r) => hidden.includes(r.id)).length;

  const meHandle = me?.handle.toLowerCase();

  // DM avatar: the OTHER member's pfp (initials fallback so it's never soulless)
  const dmAvatar = (r: RoomInfo) => {
    const others = (r.members ?? []).filter((h) => h.toLowerCase() !== meHandle);
    const u = directory.find((x) => x.handle.toLowerCase() === (others[0] ?? "").toLowerCase());
    const name = u?.displayName || others[0] || "?";
    const initial = name.trim().charAt(0).toUpperCase() || "?";
    if (u?.avatarUrl) return <img className="rs-row-av" src={u.avatarUrl} alt="" loading="lazy" />;
    return (
      <span className="rs-row-av rs-row-av-ph" style={{ background: u?.color || "var(--surface-3)" }}>
        {initial}
      </span>
    );
  };
  const canEditRoom = (r: RoomInfo) => !!r.members && !!me && (me.role === "admin" || r.creator === meHandle);
  const canDeleteAny = me?.role === "admin";

  const renderRow = (r: RoomInfo) => {
    const isDm = !!r.members;
    const isHidden = hidden.includes(r.id);
    const actions: { id: string; label: string; danger?: boolean; run: () => void }[] = [];
    if (isDm) actions.push({ id: "hide", label: isHidden ? "Show for me" : "Hide for me", run: () => onToggleHidden(r.id) });
    if (canEditRoom(r)) actions.push({ id: "manage", label: "Manage", run: () => onManage(r) });
    if (canDeleteAny) actions.push({ id: "delete", label: "Delete for everyone", danger: true, run: () => onDelete(r) });
    const count = r.members?.length ?? 0;

    return (
      <div key={r.id} className={`rs-row-wrap ${isHidden ? "hidden" : ""}`}>
        <button
          className={`rs-row ${active === r.id ? "active" : ""} ${r.access === "mod" ? "mod" : ""}`}
          onClick={() => onSelect(r.id)}
          title={r.label}
        >
          {isDm ? dmAvatar(r) : <span className="rs-row-icon">{roomIcon(r).trim()}</span>}
          <span className="rs-row-label">{r.label}</span>
          {isDm && count > 2 && <span className="rs-row-count">{count}</span>}
        </button>
        {actions.length > 0 && (
          <button
            className="rs-row-menu-btn"
            title="Options"
            onClick={(e) => {
              e.stopPropagation();
              setMenu((m) => (m === r.id ? null : r.id));
            }}
          >
            ⋯
          </button>
        )}
        {menu === r.id && (
          <div className="rs-menu">
            {actions.map((a) => (
              <button
                key={a.id}
                className={a.danger ? "danger" : ""}
                onClick={() => {
                  setMenu(null);
                  a.run();
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="rooms-sidebar">
      <div className="rs-head">
        <h2>Rooms</h2>
      </div>
      <div className="rs-scroll">
        <div className="rs-section-label">Channels</div>
        {channels.map(renderRow)}

        <div className="rs-section-label">
          <span>Direct Messages</span>
          <button className="rs-newdm" title="New direct message" onClick={onNewDm}>
            ＋
          </button>
        </div>
        {shownDms.length === 0 && <div className="rs-empty">No direct messages yet.</div>}
        {shownDms.map(renderRow)}

        {hiddenCount > 0 && (
          <button className="rs-hidden-toggle" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? "Hide muted chats" : `Show hidden (${hiddenCount})`}
          </button>
        )}
      </div>
      {menu && <div className="rs-menu-backdrop" onClick={() => setMenu(null)} />}
    </aside>
  );
}
