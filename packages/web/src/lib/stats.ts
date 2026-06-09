import { useEffect, useState } from "react";
import type { StatsRange, StatsScope, StatsSnapshot } from "@app/shared";
import { getToken } from "./auth";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

/** Build the ?range/scope/streamer query for the stats + report endpoints. */
export function statsQuery(range: StatsRange, scope: StatsScope, streamer?: string): string {
  const p = new URLSearchParams({ range, scope });
  if (streamer) p.set("streamer", streamer);
  return p.toString();
}

export async function fetchStats(range: StatsRange, scope: StatsScope, streamer?: string): Promise<StatsSnapshot | null> {
  const token = getToken();
  try {
    const r = await fetch(`${API}/api/stats?${statsQuery(range, scope, streamer)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) return null;
    return (await r.json()) as StatsSnapshot;
  } catch {
    return null;
  }
}

/** Poll /api/stats for the selected range/scope/streamer. Re-fetches on any change. */
export function useStats(range: StatsRange, scope: StatsScope, streamer?: string, intervalMs = 7000) {
  const [data, setData] = useState<StatsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // per-effect cancel flag: a late response from a *previous* range/scope/
    // streamer can't overwrite the current one (each run owns its own flag).
    let cancelled = false;
    let timer: number | undefined;

    // changed selection → drop the stale snapshot so the view never renders
    // data that disagrees with the active controls.
    setData(null);
    setLoading(true);

    const tick = async () => {
      const s = await fetchStats(range, scope, streamer);
      if (cancelled) return;
      if (s) {
        setData(s);
        setError(false);
      } else {
        setError(true);
      }
      setLoading(false);
      timer = window.setTimeout(tick, intervalMs);
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [range, scope, streamer, intervalMs]);

  return { data, loading, error };
}
