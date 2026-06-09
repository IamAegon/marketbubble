import type { Episode, EpisodeDraft, GuestPost } from "@app/shared";
import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;
const authH = (): Record<string, string> => {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
};
const jsonH = (): Record<string, string> => ({ "content-type": "application/json", ...authH() });

export async function fetchEpisodes(): Promise<Episode[]> {
  try {
    const r = await fetch(`${API}/api/episodes`);
    if (!r.ok) return [];
    return (await r.json()).episodes as Episode[];
  } catch {
    return [];
  }
}

export async function createEpisode(draft: EpisodeDraft): Promise<Episode | null> {
  try {
    const r = await fetch(`${API}/api/episodes`, { method: "POST", headers: jsonH(), body: JSON.stringify(draft) });
    return r.ok ? ((await r.json()) as Episode) : null;
  } catch {
    return null;
  }
}

export async function updateEpisode(id: string, draft: EpisodeDraft): Promise<Episode | null> {
  try {
    const r = await fetch(`${API}/api/episodes/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: jsonH(),
      body: JSON.stringify(draft),
    });
    return r.ok ? ((await r.json()) as Episode) : null;
  } catch {
    return null;
  }
}

export async function deleteEpisode(id: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/episodes/${encodeURIComponent(id)}`, { method: "DELETE", headers: authH() });
    return r.ok;
  } catch {
    return false;
  }
}

/** On-demand recent X posts for a guest handle. */
export async function fetchGuestPosts(handle: string): Promise<GuestPost[]> {
  try {
    const r = await fetch(`${API}/api/x/recent?handle=${encodeURIComponent(handle)}`);
    if (!r.ok) return [];
    return (await r.json()).posts as GuestPost[];
  } catch {
    return [];
  }
}
