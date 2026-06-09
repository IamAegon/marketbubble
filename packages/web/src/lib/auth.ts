import type { AuthResponse, User } from "@app/shared";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;
const KEY = "mb.token.v1";

export const getToken = (): string | null => localStorage.getItem(KEY);
export const setToken = (t: string) => localStorage.setItem(KEY, t);
export const clearToken = () => localStorage.removeItem(KEY);

async function postJson(path: string, body: unknown): Promise<any> {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${path} ${r.status}`);
  return j;
}

export async function signup(handle: string, password: string, displayName?: string): Promise<AuthResponse> {
  const j = await postJson("/api/auth/signup", { handle, password, displayName });
  setToken(j.token);
  return j;
}

export async function login(handle: string, password: string): Promise<AuthResponse> {
  const j = await postJson("/api/auth/login", { handle, password });
  setToken(j.token);
  return j;
}

export async function me(): Promise<User | null> {
  const t = getToken();
  if (!t) return null;
  const r = await fetch(API + "/api/auth/me", { headers: { authorization: `Bearer ${t}` } });
  if (!r.ok) {
    clearToken();
    return null;
  }
  return (await r.json()).user as User;
}

export async function updateProfile(patch: {
  displayName?: string;
  color?: string;
  avatarUrl?: string;
  welcomeTitle?: string;
}): Promise<User | null> {
  const t = getToken();
  if (!t) return null;
  const r = await fetch(API + "/api/auth/profile", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "update failed");
  return (await r.json()).user as User;
}

export function logout() {
  clearToken();
}
