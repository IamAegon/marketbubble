import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { ulid } from "ulid";
import type { Role, RoomInfo } from "@app/shared";
import { logger } from "../observability/logger.js";

export const DEFAULT_ROOMS: RoomInfo[] = [
  { id: "mb:shared", label: "Shared", access: "all" },
  { id: "mb:mod", label: "Mod", access: "mod" },
  { id: "mb:ansem", label: "Ansem", access: "all" },
  { id: "mb:faze", label: "Faze", access: "all" },
];

const isMod = (role: Role | undefined) => role === "mod" || role === "admin";
const isAdmin = (role: Role | undefined) => role === "admin";
const norm = (h: string) => h.trim().toLowerCase().replace(/^@/, "");
const cap = (h: string) => (h ? h[0]!.toUpperCase() + h.slice(1) : h);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const CONTROL = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

/** who is performing a mutation (role-gated) */
export type Actor = { role: Role | undefined; handle?: string };
/** result of a room mutation */
export interface RoomMutation {
  ok: boolean;
  error?: string;
  room?: RoomInfo;
  /** the whole room ceased to exist (e.g. last member left) */
  removed?: boolean;
}

type NameOf = (handle: string) => string | undefined;

/** Registry of native MB rooms + access checks. Rooms with `members` are private
 * (DMs / group DMs) — readable/writable only by those handles. Dynamic (member)
 * rooms persist so threads survive restarts. Non-MB channels are always readable.
 *
 * Deleted rooms are tombstoned (not just dropped): `canRead` denies a tombstoned id
 * forever, so a removed private room's history can never leak back as a "public"
 * (unknown-channel) read. Tombstones persist so admin deletes survive a restart. */
export class RoomRegistry {
  private rooms = new Map<string, RoomInfo>();
  private deleted = new Set<string>();
  constructor(
    private readonly persistPath?: string,
    rooms: RoomInfo[] = DEFAULT_ROOMS,
  ) {
    for (const r of rooms) this.rooms.set(r.id, r);
    if (persistPath && existsSync(persistPath)) {
      try {
        const raw = JSON.parse(readFileSync(persistPath, "utf8"));
        // back-compat: legacy files are a bare RoomInfo[]; new files are { rooms, deleted }
        const list: RoomInfo[] = Array.isArray(raw) ? raw : (raw.rooms ?? []);
        const tombstones: string[] = Array.isArray(raw) ? [] : (raw.deleted ?? []);
        for (const r of list) this.rooms.set(r.id, r);
        for (const id of tombstones) {
          this.deleted.add(id);
          this.rooms.delete(id); // re-bury any seeded default that was deleted
        }
      } catch {
        /* ignore */
      }
    }
  }
  private persist(): void {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const rooms = [...this.rooms.values()].filter((r) => r.members);
      writeFileSync(this.persistPath, JSON.stringify({ rooms, deleted: [...this.deleted] }));
    } catch (e) {
      // a lost write would drop a tombstone — surface it (read-side is still safe:
      // canRead denies any unregistered mb:/dm: channel regardless of tombstones)
      logger.warn({ err: String(e), path: this.persistPath }, "rooms: persist failed");
    }
  }

  list(): RoomInfo[] {
    return [...this.rooms.values()];
  }
  get(id: string): RoomInfo | undefined {
    return this.rooms.get(id);
  }

  private allowed(r: RoomInfo, role: Role | undefined, handle?: string): boolean {
    if (r.members) return !!handle && r.members.includes(norm(handle));
    return r.access !== "mod" || isMod(role);
  }
  /** rooms a user may see (public rooms by role; private rooms by membership) */
  visibleTo(role: Role | undefined, handle?: string): RoomInfo[] {
    return this.list().filter((r) => this.allowed(r, role, handle));
  }
  canRead(role: Role | undefined, channel: string, handle?: string): boolean {
    if (this.deleted.has(channel)) return false; // tombstoned — history stays buried for everyone
    const r = this.rooms.get(channel);
    if (r) return this.allowed(r, role, handle);
    // Not a registered room. MB-native namespaces are private-by-default: an mb:/dm:
    // channel that isn't a LIVE room (deleted, or never created) must never be read as
    // a "public" channel — that would expose buried DM history if a tombstone is ever
    // lost. Only true external platform channels (twitch/x/kick) are public-by-default.
    if (channel.startsWith("mb:") || channel.startsWith("dm:")) return false;
    return true;
  }
  canWrite(role: Role | undefined, channel: string, handle?: string): boolean {
    return this.canRead(role, channel, handle);
  }

  // ---- management permissions ----
  private isCreator(r: RoomInfo, handle?: string): boolean {
    return !!r.creator && !!handle && r.creator === norm(handle);
  }
  /** may add/remove participants or rename — private rooms only, creator or admin */
  canEdit(r: RoomInfo, role: Role | undefined, handle?: string): boolean {
    return !!r.members && (isAdmin(role) || this.isCreator(r, handle));
  }
  /** may globally delete a room (any room) — admin only */
  canDelete(role: Role | undefined): boolean {
    return isAdmin(role);
  }

  /** derive a label from membership: 1:1 → the other person; group → up to 3 names + overflow */
  private labelFor(members: string[], nameOf?: NameOf, creator?: string): string {
    const name = (h: string) => nameOf?.(h) ?? cap(h);
    if (members.length <= 2) {
      const others = creator ? members.filter((h) => h !== creator) : members;
      const pick = others.length ? others : members;
      return `${pick.map(name).join(", ")} DM`;
    }
    const named = members.map(name);
    return named.length <= 3 ? named.join(", ") : `${named.slice(0, 3).join(", ")} +${named.length - 3}`;
  }

  /** Get-or-create a private room for a set of handles. Reuses any existing live room
   * with the same member set (so the same people map to the same thread). If the
   * deterministic id was tombstoned by a prior delete, a fresh id is minted so old
   * (buried) history never resurfaces. Stamps the creator for later edit checks. */
  ensureDm(members: string[], opts?: { creator?: string; nameOf?: NameOf }): RoomInfo {
    const m = [...new Set(members.map(norm))].filter(Boolean).sort();
    for (const r of this.rooms.values()) if (r.members && sameSet(r.members, m)) return r;
    let id = `dm:${m.join("~")}`;
    // if the deterministic id is taken or tombstoned, mint a fresh, unused one so old
    // (buried) history never resurfaces — loop in case a suffix also collides
    while (this.rooms.has(id) || this.deleted.has(id)) id = `dm:${m.join("~")}~${ulid().slice(-6).toLowerCase()}`;
    const creator = norm(opts?.creator ?? "") || undefined;
    const r: RoomInfo = {
      id,
      label: this.labelFor(m, opts?.nameOf, creator),
      access: "all",
      members: m,
      ...(creator ? { creator } : {}),
    };
    this.rooms.set(id, r);
    this.persist();
    return r;
  }

  /** add participants to a private room (creator or admin) */
  addMembers(id: string, handles: string[], by: Actor, nameOf?: NameOf): RoomMutation {
    const r = this.rooms.get(id);
    if (!r || !r.members) return { ok: false, error: "not a group" };
    if (!this.canEdit(r, by.role, by.handle)) return { ok: false, error: "forbidden" };
    const add = handles.map(norm).filter(Boolean);
    const prevLen = r.members.length;
    const members = [...new Set([...r.members, ...add])].sort();
    if (members.length === prevLen) return { ok: true, room: r }; // no-op (all already in)
    r.members = members;
    if (!r.renamed) r.label = this.labelFor(members, nameOf, r.creator);
    this.persist();
    return { ok: true, room: r };
  }

  /** remove a participant (creator or admin). Empties → the room is deleted/tombstoned. */
  removeMember(id: string, handle: string, by: Actor, nameOf?: NameOf): RoomMutation {
    const r = this.rooms.get(id);
    if (!r || !r.members) return { ok: false, error: "not a group" };
    if (!this.canEdit(r, by.role, by.handle)) return { ok: false, error: "forbidden" };
    const h = norm(handle);
    const members = r.members.filter((x) => x !== h);
    if (members.length === r.members.length) return { ok: false, error: "not a member" };
    if (members.length === 0) {
      this.rooms.delete(id);
      this.deleted.add(id);
      this.persist();
      return { ok: true, removed: true };
    }
    r.members = members;
    if (!r.renamed) r.label = this.labelFor(members, nameOf, r.creator);
    this.persist();
    return { ok: true, room: r };
  }

  /** rename a private room (creator or admin) */
  rename(id: string, label: string, by: Actor): RoomMutation {
    const r = this.rooms.get(id);
    if (!r || !r.members) return { ok: false, error: "not a group" };
    if (!this.canEdit(r, by.role, by.handle)) return { ok: false, error: "forbidden" };
    const clean = String(label ?? "").replace(CONTROL, " ").trim().slice(0, 60);
    if (!clean) return { ok: false, error: "empty name" };
    r.label = clean;
    r.renamed = true;
    this.persist();
    return { ok: true, room: r };
  }

  /** globally delete a room (admin only) — tombstoned so its history can't leak back.
   * Returns the removed room so callers can target the removal at its (now ex-)members. */
  remove(id: string, by: Actor): RoomMutation {
    const r = this.rooms.get(id);
    if (!r) return { ok: false, error: "unknown room" };
    if (!this.canDelete(by.role)) return { ok: false, error: "forbidden" };
    this.rooms.delete(id);
    this.deleted.add(id);
    this.persist();
    return { ok: true, room: r };
  }
}
