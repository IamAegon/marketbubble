import type { RoomInfo } from "@app/shared";
import { roomTabLabel } from "../lib/roomLabel";

export function RoomSwitcher({
  rooms,
  active,
  onSelect,
}: {
  rooms: RoomInfo[];
  active: string;
  onSelect: (id: string) => void;
}) {
  if (rooms.length === 0) return null;
  return (
    <div className="room-switcher">
      {rooms.map((r) => {
        const dm = !!r.members;
        return (
          <button
            key={r.id}
            className={`room-tab ${active === r.id ? "active" : ""} ${r.access === "mod" ? "mod" : ""} ${dm ? "dm" : ""}`}
            onClick={() => onSelect(r.id)}
            title={dm ? "Direct message" : r.access === "mod" ? "Mods only" : r.label}
          >
            {roomTabLabel(r)}
          </button>
        );
      })}
    </div>
  );
}
