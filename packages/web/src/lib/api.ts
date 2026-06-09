import type { ConnectorInfo, Platform } from "@app/shared";
import { getToken } from "./auth";

const API_BASE =
  (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

const authH = (): Record<string, string> => {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
};

export async function getSources(): Promise<ConnectorInfo[]> {
  const r = await fetch(`${API_BASE}/api/sources`);
  if (!r.ok) throw new Error(`getSources ${r.status}`);
  return r.json();
}

export async function addSource(
  platform: Platform,
  value: string,
  label?: string,
): Promise<ConnectorInfo> {
  const r = await fetch(`${API_BASE}/api/sources`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authH() },
    body: JSON.stringify({ platform, value, label }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `addSource ${r.status}`);
  return body;
}

export async function removeSource(id: string): Promise<void> {
  const r = await fetch(`${API_BASE}/api/sources/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authH(),
  });
  if (!r.ok) throw new Error(`removeSource ${r.status}`);
}
