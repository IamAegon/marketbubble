import { useEffect, useState } from "react";
import type { PerfAnalysis } from "@app/shared";
import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

export interface ReactionParams {
  binMs: number;
  sinceMs?: number;
  channel: string;
  z?: number;
}

export async function fetchReactions(p: ReactionParams): Promise<PerfAnalysis | null> {
  const token = getToken();
  const q = new URLSearchParams({ binMs: String(p.binMs), channel: p.channel });
  if (p.sinceMs) q.set("sinceMs", String(p.sinceMs));
  if (p.z) q.set("z", String(p.z));
  try {
    const r = await fetch(`${API}/api/reactions?${q.toString()}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) return null;
    return (await r.json()) as PerfAnalysis;
  } catch {
    return null;
  }
}

/**
 * Poll the server-side reaction fold. The heavy per-bucket driver attribution runs
 * on the server (off the browser's main thread); the client just renders the result.
 * Pass enabled=false to pause polling (e.g. when viewing a recorded session).
 */
export function useReactions(p: ReactionParams, enabled: boolean, intervalMs = 4000) {
  const [analysis, setAnalysis] = useState<PerfAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  // re-run only when the actual params change, not on every render (p is a fresh object each render)
  const key = `${p.binMs}|${p.sinceMs ?? 0}|${p.channel}|${p.z ?? 2}|${enabled}`;
  useEffect(() => {
    if (!enabled) {
      setAnalysis(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    setLoading(true);
    const tick = async () => {
      const a = await fetchReactions(p);
      if (cancelled) return;
      if (a) setAnalysis(a);
      setLoading(false);
      timer = window.setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs]);

  return { analysis, loading };
}
