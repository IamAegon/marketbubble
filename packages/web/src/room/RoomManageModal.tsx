import { useEffect, useMemo, useState } from "react";
import type { DirectoryUser, RoomInfo, User } from "@app/shared";
import { addRoomMembers, fetchDirectory, removeRoomMember, renameRoom } from "../lib/rooms";

/** Edit a private room: rename, add/remove participants. Creator + admin only get
 * the edit controls; everyone else sees a read-only participant list. The `room`
 * prop is the LIVE room (derived in the parent from the rooms list), so it reflects
 * each change after the parent refreshes. */
export function RoomManageModal({
  room,
  me,
  onClose,
  onChanged,
}: {
  room: RoomInfo;
  me: User;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [dir, setDir] = useState<DirectoryUser[]>([]);
  const [addSel, setAddSel] = useState<Set<string>>(new Set());
  const [name, setName] = useState(room.label);
  const [busy, setBusy] = useState(false);

  const canEdit = !!room.members && (me.role === "admin" || room.creator === me.handle.toLowerCase());
  const members = room.members ?? [];

  useEffect(() => {
    fetchDirectory().then(setDir);
  }, []);
  useEffect(() => {
    setName(room.label);
  }, [room.id, room.label]);

  const lookup = useMemo(() => new Map(dir.map((u) => [u.handle, u])), [dir]);
  const candidates = dir.filter((u) => !members.includes(u.handle));

  const doRename = async () => {
    const label = name.trim();
    if (!label || label === room.label) return;
    setBusy(true);
    await renameRoom(room.id, label);
    setBusy(false);
    onChanged();
  };
  const doAdd = async () => {
    if (addSel.size === 0) return;
    setBusy(true);
    await addRoomMembers(room.id, [...addSel]);
    setBusy(false);
    setAddSel(new Set());
    onChanged();
  };
  const doRemove = async (h: string) => {
    setBusy(true);
    await removeRoomMember(room.id, h);
    setBusy(false);
    onChanged();
  };
  const toggle = (h: string) =>
    setAddSel((p) => {
      const n = new Set(p);
      n.has(h) ? n.delete(h) : n.add(h);
      return n;
    });

  return (
    <div className="fwd-overlay" onClick={onClose}>
      <div className="fwd-modal rm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fwd-head">Manage chat</div>

        {canEdit && (
          <label className="rm-rename">
            <span>Name</span>
            <div className="rm-rename-row">
              <input
                value={name}
                maxLength={60}
                placeholder="Group name"
                onChange={(e) => setName(e.target.value)}
              />
              <button className="cc-chip" disabled={busy || !name.trim() || name.trim() === room.label} onClick={doRename}>
                Save
              </button>
            </div>
          </label>
        )}

        <div className="rm-section-title">Participants ({members.length})</div>
        <div className="rm-members">
          {members.map((h) => {
            const u = lookup.get(h);
            const isCreator = room.creator === h;
            return (
              <div key={h} className="rm-member">
                <span className="dm-dot" style={{ background: u?.color ?? "var(--text-muted)" }} />
                <span className="dm-name">{u?.displayName ?? h}</span>
                <span className="dm-handle">@{h}</span>
                {isCreator && <span className="rm-creator">creator</span>}
                {canEdit && !isCreator && (
                  <button className="rm-x" title="Remove" disabled={busy} onClick={() => doRemove(h)}>
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {canEdit && (
          <>
            <div className="rm-section-title">Add people</div>
            <div className="dm-people">
              {candidates.length === 0 && <div className="cc-empty-sm">Everyone's already in.</div>}
              {candidates.map((u) => (
                <label key={u.handle} className={`dm-person ${addSel.has(u.handle) ? "on" : ""}`}>
                  <input type="checkbox" checked={addSel.has(u.handle)} onChange={() => toggle(u.handle)} />
                  <span className="dm-dot" style={{ background: u.color }} />
                  <span className="dm-name">{u.displayName}</span>
                  <span className="dm-handle">@{u.handle}</span>
                </label>
              ))}
            </div>
            <div className="set-actions" style={{ marginTop: 10 }}>
              <button className="cc-chip active" disabled={busy || addSel.size === 0} onClick={doAdd}>
                Add{addSel.size > 0 ? ` (${addSel.size})` : ""}
              </button>
            </div>
          </>
        )}

        {!canEdit && (
          <div className="cc-empty-sm" style={{ marginTop: 10 }}>
            Only the creator or an admin can change this chat.
          </div>
        )}

        <button className="fwd-cancel" style={{ marginTop: 12 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
