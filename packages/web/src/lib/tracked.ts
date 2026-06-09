import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

export interface TrackedAccountInfo {
  handle: string;
  category: string;
  id: string;
  status: string;
}

export async function getTracked(): Promise<TrackedAccountInfo[]> {
  const r = await fetch(`${API}/api/tracked`);
  if (!r.ok) return [];
  return (await r.json()).accounts as TrackedAccountInfo[];
}

export async function addTracked(handle: string, category: string): Promise<void> {
  const t = getToken();
  const r = await fetch(`${API}/api/tracked`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify({ handle, category }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `add ${r.status}`);
}

export async function removeTracked(handle: string): Promise<void> {
  const t = getToken();
  await fetch(`${API}/api/tracked/${encodeURIComponent(handle)}`, {
    method: "DELETE",
    headers: t ? { authorization: `Bearer ${t}` } : {},
  });
}
