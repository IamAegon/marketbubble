import { useEffect, useState } from "react";
import type { MarketSentiment } from "@app/shared";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

/** Polls the market-sentiment gauges (crypto F&G, stock F&G, AAII) every 5 min. */
export function useMarketSentiment(): MarketSentiment {
  const [s, setS] = useState<MarketSentiment>({});
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/api/market/sentiment`)
        .then((r) => (r.ok ? r.json() : {}))
        .then((j) => alive && setS(j || {}))
        .catch(() => {});
    load();
    const id = window.setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return s;
}
