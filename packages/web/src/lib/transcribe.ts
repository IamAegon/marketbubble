import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;
const authH = (): Record<string, string> => {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
};

export interface TranscribeStatus {
  active: { connector: string; label: string; since: number }[];
  worker: { online: boolean; model?: string; device?: string; jobs?: unknown[] };
}

export async function transcribeStatus(): Promise<TranscribeStatus> {
  try {
    const r = await fetch(`${API}/api/transcribe`);
    if (!r.ok) return { active: [], worker: { online: false } };
    return await r.json();
  } catch {
    return { active: [], worker: { online: false } };
  }
}

export async function startTranscribe(connector: string, label?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${API}/api/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authH() },
      body: JSON.stringify({ connector, label }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok !== false, error: j.error };
  } catch {
    return { ok: false, error: "network error" };
  }
}

export async function stopTranscribe(connector: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/transcribe/${encodeURIComponent(connector)}`, { method: "DELETE", headers: authH() });
    return r.ok;
  } catch {
    return false;
  }
}
