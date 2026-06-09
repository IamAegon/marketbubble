import type { RoomInfo } from "@app/shared";

/** Single source of truth for how a room is prefixed across every surface
 * (switcher, forward modals, settings, assistant picker). DMs (rooms with a
 * `members` list) get an envelope; mod-only rooms a shield; everything else a
 * hash. The label text itself (e.g. "Ansem DM") comes from the server. */
export const roomIcon = (r: RoomInfo): string => (r.members ? "✉ " : r.access === "mod" ? "🛡 " : "# ");

/** Full prefixed label, e.g. "✉ Ansem DM", "🛡 Mod", "# Shared". */
export const roomTabLabel = (r: RoomInfo): string => roomIcon(r) + r.label;
