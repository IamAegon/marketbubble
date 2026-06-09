import type { SessionSummary, StreamerInfo } from "@app/shared";
import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${ss}s` : `${ss}s`;
}
const authH = (): Record<string, string> => {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
};

export async function fetchStreamers(): Promise<StreamerInfo[]> {
  try {
    const r = await fetch(`${API}/api/streamers`, { headers: authH() });
    if (!r.ok) return [];
    return (await r.json()).streamers as StreamerInfo[];
  } catch {
    return [];
  }
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  try {
    const r = await fetch(`${API}/api/sessions`, { headers: authH() });
    if (!r.ok) return [];
    return (await r.json()).sessions as SessionSummary[];
  } catch {
    return [];
  }
}

export interface SessionCaption {
  t: number;
  text: string;
  conf: number | null;
}

/** The transcript (captions, oldest-first) of one recorded session, for replay. */
export async function fetchSessionCaptions(id: string): Promise<SessionCaption[]> {
  try {
    const r = await fetch(`${API}/api/sessions/${encodeURIComponent(id)}/captions`, { headers: authH() });
    if (!r.ok) return [];
    return (await r.json()).captions as SessionCaption[];
  } catch {
    return [];
  }
}

export async function startSession(
  streamerId: string,
  xUrl?: string,
): Promise<{ ok: boolean; error?: string; session?: SessionSummary }> {
  try {
    const r = await fetch(`${API}/api/sessions/start`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authH() },
      body: JSON.stringify({ streamerId, xUrl }),
    });
    return await r.json();
  } catch {
    return { ok: false, error: "network error" };
  }
}

export async function stopSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${API}/api/sessions/stop`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authH() },
      body: JSON.stringify({ sessionId }),
    });
    return await r.json();
  } catch {
    return { ok: false, error: "network error" };
  }
}

/** toggle a streamer's auto-capture settings (record-on-live / transcribe-on-live) */
export async function setStreamerSettings(
  streamerId: string,
  patch: { recordSessions?: boolean; transcribe?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${API}/api/streamers/${encodeURIComponent(streamerId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authH() },
      body: JSON.stringify(patch),
    });
    return await r.json();
  } catch {
    return { ok: false, error: "network error" };
  }
}
