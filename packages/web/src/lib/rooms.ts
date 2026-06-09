import type { DirectoryUser, RoomInfo } from "@app/shared";
import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;
const authH = (): Record<string, string> => {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
};

export async function getRooms(): Promise<RoomInfo[]> {
  const r = await fetch(`${API}/api/rooms`, { headers: authH() });
  if (!r.ok) return [];
  return (await r.json()).rooms as RoomInfo[];
}

export async function fetchDirectory(): Promise<DirectoryUser[]> {
  try {
    const r = await fetch(`${API}/api/users/directory`, { headers: authH() });
    if (!r.ok) return [];
    return (await r.json()).users as DirectoryUser[];
  } catch {
    return [];
  }
}

/** Create-or-open a DM / group DM with one or more handles; returns the room. */
export async function createDm(withHandles: string[]): Promise<RoomInfo | null> {
  try {
    const r = await fetch(`${API}/api/rooms/dm`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authH() },
      body: JSON.stringify({ with: withHandles }),
    });
    if (!r.ok) return null;
    return (await r.json()).room as RoomInfo;
  } catch {
    return null;
  }
}

/** Add participants to a private room (creator or admin); returns the updated room. */
export async function addRoomMembers(id: string, handles: string[]): Promise<RoomInfo | null> {
  try {
    const r = await fetch(`${API}/api/rooms/${encodeURIComponent(id)}/members`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authH() },
      body: JSON.stringify({ add: handles }),
    });
    if (!r.ok) return null;
    return (await r.json()).room as RoomInfo;
  } catch {
    return null;
  }
}

/** Remove a participant from a private room (creator or admin). */
export async function removeRoomMember(id: string, handle: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/rooms/${encodeURIComponent(id)}/members/${encodeURIComponent(handle)}`, {
      method: "DELETE",
      headers: authH(),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Rename a private room (creator or admin); returns the updated room. */
export async function renameRoom(id: string, label: string): Promise<RoomInfo | null> {
  try {
    const r = await fetch(`${API}/api/rooms/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authH() },
      body: JSON.stringify({ label }),
    });
    if (!r.ok) return null;
    return (await r.json()).room as RoomInfo;
  } catch {
    return null;
  }
}

/** Globally delete a room (admin only). */
export async function deleteRoom(id: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/rooms/${encodeURIComponent(id)}`, { method: "DELETE", headers: authH() });
    return r.ok;
  } catch {
    return false;
  }
}
