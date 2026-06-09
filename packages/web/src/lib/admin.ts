import type { AdminUser, Role } from "@app/shared";
import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;
const authH = (): Record<string, string> => {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
};

export async function fetchUsers(): Promise<AdminUser[]> {
  try {
    const r = await fetch(`${API}/api/admin/users`, { headers: authH() });
    if (!r.ok) return [];
    return (await r.json()).users as AdminUser[];
  } catch {
    return [];
  }
}

export async function createUser(
  handle: string,
  password: string,
  displayName: string,
  role: Role,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${API}/api/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authH() },
      body: JSON.stringify({ handle, password, displayName, role }),
    });
    const j = await r.json();
    return { ok: r.ok && !j.error, error: j.error };
  } catch {
    return { ok: false, error: "network error" };
  }
}

export async function patchUser(handle: string, body: { role?: Role; password?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${API}/api/admin/users/${encodeURIComponent(handle)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authH() },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok !== false, error: j.error };
  } catch {
    return { ok: false, error: "network error" };
  }
}

export async function deleteUser(handle: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${API}/api/admin/users/${encodeURIComponent(handle)}`, { method: "DELETE", headers: authH() });
    const j = await r.json();
    return { ok: r.ok && j.ok !== false, error: j.error };
  } catch {
    return { ok: false, error: "network error" };
  }
}
