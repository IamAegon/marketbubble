import { useEffect, useMemo, useState } from "react";
import type { ChatMessage, DirectoryUser, Platform, ReplyRef } from "@app/shared";
import { useDashboard } from "../state/DashboardProvider";
import { useAuth } from "../state/useAuth";
import { ActionsProvider } from "../feed/actions";
import { UnifiedView } from "../feed/UnifiedView";
import { MessageComposer } from "../room/MessageComposer";
import { RoomsSidebar } from "../room/RoomsSidebar";
import { RoomManageModal } from "../room/RoomManageModal";
import { createDm, deleteRoom, fetchDirectory } from "../lib/rooms";
import { roomIcon } from "../lib/roomLabel";

const MB_ONLY = new Set<Platform>(["mb"]);

/** Market Bubble team chat — a Discord-style left rail (Channels + DMs) with the
 * active room's feed + composer on the right. Reuses the feed + composer. */
export function RoomsView() {
  const d = useDashboard();
  const { user } = useAuth();
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);

  const [picker, setPicker] = useState(false);
  const [dir, setDir] = useState<DirectoryUser[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [manageId, setManageId] = useState<string | null>(null);

  const hidden = d.layout.hiddenRooms;
  const active = d.activeRoom;
  const msgs = useMemo(() => d.messages.filter((m) => m.platform === "mb" && m.channel === active), [d.messages, active]);
  const actions = useMemo(() => ({ ...d.actions, reply: setReplyTo, forward: setForwardMsg }), [d.actions]);
  const activeRoom = d.rooms.find((r) => r.id === active);
  const roomLabel = activeRoom?.label ?? "Shared";
  const manageRoom = manageId ? d.rooms.find((r) => r.id === manageId) : undefined;
  const canManageActive =
    !!activeRoom?.members && !!user && (user.role === "admin" || activeRoom.creator === user.handle.toLowerCase());

  // keep a valid active room: if the current one was hidden-for-me or deleted, fall back.
  // depend on the stable setActiveRoom ref (not the whole `d` context, which is a fresh
  // object every render and would re-fire this effect on every parent re-render).
  const setActiveRoom = d.setActiveRoom;
  const visibleRooms = useMemo(() => d.rooms.filter((r) => !(r.members && hidden.includes(r.id))), [d.rooms, hidden]);
  useEffect(() => {
    if (visibleRooms.length && !visibleRooms.some((r) => r.id === active)) {
      setActiveRoom(visibleRooms[0]!.id);
    }
  }, [visibleRooms, active, setActiveRoom]);

  // close the manage modal if its room vanished (deleted, or last member removed)
  useEffect(() => {
    if (manageId && !manageRoom) setManageId(null);
  }, [manageId, manageRoom]);

  // load the teammate directory up-front so DM rows can show each person's avatar
  useEffect(() => {
    fetchDirectory().then(setDir);
  }, []);

  const startDm = async () => {
    const handles = [...sel];
    if (handles.length === 0) return;
    const room = await createDm(handles);
    setPicker(false);
    setSel(new Set());
    if (room) {
      d.refreshRooms();
      d.setActiveRoom(room.id);
    }
  };
  const toggleSel = (h: string) =>
    setSel((p) => {
      const n = new Set(p);
      n.has(h) ? n.delete(h) : n.add(h);
      return n;
    });

  const onSend = (text: string) => {
    const ref: ReplyRef | undefined = replyTo
      ? { id: replyTo.id, author: replyTo.author.displayName, textPreview: replyTo.text.slice(0, 120) }
      : undefined;
    d.post(active, text, ref);
    setReplyTo(null);
  };
  const doForward = (roomId: string) => {
    if (!forwardMsg) return;
    d.post(roomId, forwardMsg.text, {
      id: forwardMsg.id,
      author: `${forwardMsg.author.displayName} · ${forwardMsg.channelLabel}`,
      textPreview: "",
    });
    setForwardMsg(null);
  };
  const doDelete = async (roomId: string, label: string) => {
    if (!window.confirm(`Delete "${label}" for everyone? This removes it for all members and can't be undone.`)) return;
    const ok = await deleteRoom(roomId);
    if (ok) d.refreshRooms();
  };

  return (
    <div className="rooms-view">
      <RoomsSidebar
        rooms={d.rooms}
        active={active}
        onSelect={d.setActiveRoom}
        me={user}
        directory={dir}
        hidden={hidden}
        onToggleHidden={d.layout.toggleHiddenRoom}
        onNewDm={() => setPicker(true)}
        onManage={(r) => setManageId(r.id)}
        onDelete={(r) => doDelete(r.id, r.label)}
      />

      <div className="rs-main">
        <div className="rs-main-head">
          {activeRoom?.members &&
            (() => {
              const others = activeRoom.members.filter((h) => h.toLowerCase() !== user?.handle.toLowerCase());
              const u = dir.find((x) => x.handle.toLowerCase() === (others[0] ?? "").toLowerCase());
              const initial = (u?.displayName || others[0] || "?").trim().charAt(0).toUpperCase() || "?";
              return u?.avatarUrl ? (
                <img className="rs-head-av" src={u.avatarUrl} alt="" />
              ) : (
                <span className="rs-head-av rs-head-av-ph" style={{ background: u?.color || "var(--surface-3)" }}>
                  {initial}
                </span>
              );
            })()}
          <span className="rs-main-title">
            {!activeRoom?.members && (activeRoom ? roomIcon(activeRoom) : "# ")}
            {roomLabel}
          </span>
          {activeRoom?.members && (
            <span className="rs-main-sub">
              {activeRoom.members.length} member{activeRoom.members.length === 1 ? "" : "s"}
            </span>
          )}
          {activeRoom?.members && (
            <div className="rs-main-actions">
              <button className="rs-main-btn" onClick={() => setManageId(active)}>
                {canManageActive ? "Manage" : "Members"}
              </button>
            </div>
          )}
        </div>

        <div className="rooms-feed">
          <ActionsProvider value={actions}>
            {msgs.length === 0 ? (
              <div className="empty">No messages in {roomLabel} yet — say something.</div>
            ) : (
              <UnifiedView messages={msgs} enabled={MB_ONLY} showNews={false} showChannel={false} showPill={false} />
            )}
          </ActionsProvider>
        </div>

        <div className="composer-bar">
          <MessageComposer
            roomLabel={roomLabel}
            displayName={user?.displayName ?? ""}
            onSend={onSend}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
          />
        </div>
      </div>

      {forwardMsg && (
        <div className="fwd-overlay" onClick={() => setForwardMsg(null)}>
          <div className="fwd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fwd-head">Forward to a room</div>
            <div className="fwd-quote">
              <b>{forwardMsg.author.displayName}</b> · {forwardMsg.channelLabel}
              <div className="fwd-quote-text">{forwardMsg.text.slice(0, 160)}</div>
            </div>
            <div className="fwd-rooms">
              {d.rooms.map((r) => (
                <button key={r.id} onClick={() => doForward(r.id)}>
                  {roomIcon(r)}
                  {r.label}
                </button>
              ))}
            </div>
            <button className="fwd-cancel" onClick={() => setForwardMsg(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {picker && (
        <div className="fwd-overlay" onClick={() => setPicker(false)}>
          <div className="fwd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fwd-head">New direct message</div>
            <div className="dm-people">
              {dir.filter((u) => u.handle !== user?.handle.toLowerCase()).length === 0 && (
                <div className="cc-empty-sm">No other teammates yet.</div>
              )}
              {dir
                .filter((u) => u.handle !== user?.handle.toLowerCase())
                .map((u) => (
                  <label key={u.handle} className={`dm-person ${sel.has(u.handle) ? "on" : ""}`}>
                    <input type="checkbox" checked={sel.has(u.handle)} onChange={() => toggleSel(u.handle)} />
                    <span className="dm-dot" style={{ background: u.color }} />
                    <span className="dm-name">{u.displayName}</span>
                    <span className="dm-handle">@{u.handle}</span>
                  </label>
                ))}
            </div>
            <div className="set-actions" style={{ marginTop: 12 }}>
              <button className="cc-chip active" disabled={sel.size === 0} onClick={startDm}>
                Start chat{sel.size > 1 ? ` (${sel.size})` : ""}
              </button>
              <button className="fwd-cancel" onClick={() => setPicker(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {manageRoom && user && (
        <RoomManageModal room={manageRoom} me={user} onClose={() => setManageId(null)} onChanged={d.refreshRooms} />
      )}
    </div>
  );
}
