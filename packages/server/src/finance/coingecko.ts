import type { PriceStore } from "./PriceStore.js";
import { logger } from "../observability/logger.js";

// symbol -> CoinGecko id (for assets Binance doesn't list, e.g. HYPE)
const IDS: Record<string, { id: string; name: string }> = {
  HYPE: { id: "hyperliquid", name: "Hyperliquid" },
};

/** Poll CoinGecko for assets not covered by Binance (e.g. HYPE). Free, no key. */
export function startCoinGecko(store: PriceStore, symbols: string[], signal: AbortSignal): void {
  const wanted = symbols.filter((s) => IDS[s]);
  if (!wanted.length) return;
  const ids = wanted.map((s) => IDS[s]!.id).join(",");
  let timer: NodeJS.Timeout | null = null;

  const poll = async () => {
    try {
      const r = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
        { headers: { accept: "application/json" } },
      );
      if (!r.ok) return;
      const j = (await r.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
      for (const s of wanted) {
        const meta = IDS[s]!;
        const row = j[meta.id];
        if (row?.usd != null) {
          store.update(s, row.usd, row.usd_24h_change != null ? row.usd_24h_change / 100 : undefined, "coingecko", meta.name);
        }
      }
    } catch (e) {
      logger.warn({ err: String(e) }, "coingecko poll failed");
    }
  };

  poll();
  timer = setInterval(poll, 30_000);
  timer.unref?.();
  signal.addEventListener("abort", () => timer && clearInterval(timer), { once: true });
}
