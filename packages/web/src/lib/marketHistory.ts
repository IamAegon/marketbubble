import { useEffect, useState } from "react";
import type { PriceLevels } from "@app/shared";

const API = (import.meta as any).env?.VITE_API_URL ?? `http://${location.hostname}:8787`;

/** Poll /api/history (period opens + daily series). Refreshes slowly — the data
 * is daily candles, so every couple of minutes is plenty. */
export function useMarketHistory(): Record<string, PriceLevels> {
  const [levels, setLevels] = useState<Record<string, PriceLevels>>({});
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const r = await fetch(`${API}/api/history`);
        if (!r.ok) return;
        const d = await r.json();
        if (dead) return;
        const m: Record<string, PriceLevels> = {};
        for (const l of d.levels as PriceLevels[]) m[l.symbol] = l;
        setLevels(m);
      } catch {
        /* keep last */
      }
    };
    load();
    const t = setInterval(load, 120_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);
  return levels;
}
