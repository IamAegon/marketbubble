import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RoomInfo } from "@app/shared";
import { useDashboard } from "../state/DashboardProvider";
import { useAuth } from "../state/useAuth";
import { roomIcon } from "../lib/roomLabel";
import { deleteRoom } from "../lib/rooms";
import { RoomManageModal } from "./RoomManageModal";

/** Settings → Rooms: a management overview of every chat you're in — channels and
 * direct messages — with per-room actions (open, manage participants/rename, hide for
 * yourself, admin-delete) and a roster of chats you've hidden so you can bring them back. */
export function RoomsSettings() {
  const d = useDashboard();
  const { user } = useAuth();
  const nav = useNavigate();
  const [manageId, setManageId] = useState<string | null>(null);

  const hidden = d.layout.hiddenRooms;
  const meHandle = user?.handle.toLowerCase();
  const channels = d.rooms.filter((r) => !r.members);
  const dms = d.rooms.filter((r) => r.members);
  const hiddenCount = dms.filter((r) => hidden.includes(r.id)).length;

  const canEdit = (r: RoomInfo) => !!r.members && !!user && (user.role === "admin" || r.creator === meHandle);
  const canDelete = user?.role === "admin";
  const manageRoom = manageId ? d.rooms.find((r) => r.id === manageId) : undefined;

  const open = (id: string) => {
    d.setActiveRoom(id);
    nav("/app/rooms");
  };
  const del = async (r: RoomInfo) => {
    if (!window.confirm(`Delete "${r.label}" for everyone? This removes it for all members and can't be undone.`)) return;
    if (await deleteRoom(r.id)) d.refreshRooms();
  };

  const meta = (r: RoomInfo): string => {
    if (!r.members) return r.access === "mod" ? "Mods-only channel" : "Team channel";
    const base = r.members.length <= 2 ? "Direct message" : `Group · ${r.members.length} people`;
    return r.creator === meHandle ? `${base} · you created` : base;
  };

  const row = (r: RoomInfo) => {
    const isDm = !!r.members;
    const isHidden = hidden.includes(r.id);
    return (
      <div key={r.id} className={`rset-row ${isHidden ? "hidden" : ""}`}>
        <span className="rset-icon">{roomIcon(r).trim()}</span>
        <div className="rset-main">
          <div className="rset-label">{r.label}</div>
          <div className="rset-meta">{meta(r)}</div>
        </div>
        <div className="rset-acts">
          <button className="cc-chip sm" onClick={() => open(r.id)}>
            Open
          </button>
          {canEdit(r) && (
            <button className="cc-chip sm" onClick={() => setManageId(r.id)}>
              Manage
            </button>
          )}
          {isDm && (
            <button className="cc-chip sm" onClick={() => d.layout.toggleHiddenRoom(r.id)}>
              {isHidden ? "Unhide" : "Hide"}
            </button>
          )}
          {canDelete && (
            <button className="cc-chip sm danger" onClick={() => del(r)}>
              Delete
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <p className="set-sub" style={{ marginTop: 0 }}>
        Your team channels and direct messages. Open a chat, manage who's in a group, hide a chat from your own
        sidebar, or {canDelete ? "delete one for everyone" : "leave it to an admin to remove shared rooms"}.
      </p>

      <div className="rset-summary">
        <span>
          <b>{channels.length}</b> channel{channels.length === 1 ? "" : "s"}
        </span>
        <span>
          <b>{dms.length}</b> direct message{dms.length === 1 ? "" : "s"}
        </span>
        {hiddenCount > 0 && (
          <span>
            <b>{hiddenCount}</b> hidden
          </span>
        )}
        <button className="cc-chip sm accent" style={{ marginLeft: "auto" }} onClick={() => nav("/app/rooms")}>
          + New direct message
        </button>
      </div>

      <div className="rset-group-h">Channels</div>
      <div className="rset-list">{channels.map(row)}</div>

      <div className="rset-group-h">Direct messages</div>
      <div className="rset-list">
        {dms.length === 0 ? <div className="cc-empty-sm">No direct messages yet — start one above.</div> : dms.map(row)}
      </div>

      {manageRoom && user && (
        <RoomManageModal room={manageRoom} me={user} onClose={() => setManageId(null)} onChanged={d.refreshRooms} />
      )}
    </>
  );
}
