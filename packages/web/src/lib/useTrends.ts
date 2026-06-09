import { useEffect, useState } from "react";
import type { TrendItem, TrendProviders } from "@app/shared";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

const NO_PROVIDERS: TrendProviders = { tiktok: false, instagram: false };

export interface TrendsFeed {
  trends: TrendItem[];
  updatedAt: number;
  providers: TrendProviders;
}

/** Polls the server's social/search trends every 10 min and returns the full payload
 * (items + which provider lanes are configured). */
export function useTrendsFeed(): TrendsFeed {
  const [feed, setFeed] = useState<TrendsFeed>({ trends: [], updatedAt: 0, providers: NO_PROVIDERS });
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/api/trends`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!alive || !j) return;
          setFeed({ trends: j.trends || [], updatedAt: j.updatedAt || 0, providers: j.providers || NO_PROVIDERS });
        })
        .catch(() => {});
    load();
    const id = window.setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return feed;
}

/** Convenience: just the trend items (back-compat for the rail / brief / planning views). */
export function useTrends(): TrendItem[] {
  return useTrendsFeed().trends;
}
