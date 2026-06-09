import { useEffect, useState } from "react";
import type { NewsFeed } from "@app/shared";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

/** Poll the server's Finviz markets + crypto news every 30s (server refreshes from
 * Finviz on the same cadence, so new headlines surface within ~30s). */
export function useNews(): NewsFeed & { loading: boolean } {
  const [feed, setFeed] = useState<NewsFeed>({ articles: [], updatedAt: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/api/news`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!alive || !j) return;
          setFeed({ articles: j.articles || [], updatedAt: j.updatedAt || 0 });
          setLoading(false);
        })
        .catch(() => {});
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return { ...feed, loading };
}
