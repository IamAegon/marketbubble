import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { MarketSentiment } from "@app/shared";
import { logger } from "../observability/logger.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BROWSER_HEADERS = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "upgrade-insecure-requests": "1",
};

const CRYPTO_MS = 30 * 60_000;
const CNN_MS = 5 * 60_000;
const AAII_MS = 6 * 60 * 60_000;

/** Holds the three market-sentiment gauges, persisted for cold-start. */
export class MarketSentimentStore {
  private data: MarketSentiment = {};
  constructor(private readonly cachePath: string) {
    if (existsSync(cachePath)) {
      try {
        this.data = JSON.parse(readFileSync(cachePath, "utf8"));
      } catch {
        /* ignore */
      }
    }
  }
  get(): MarketSentiment {
    return this.data;
  }
  private merge(patch: Partial<MarketSentiment>): void {
    this.data = { ...this.data, ...patch };
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      writeFileSync(this.cachePath, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  async pullCryptoFng(): Promise<void> {
    const r = await fetch("https://api.alternative.me/fng/?limit=1", { signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error(`fng ${r.status}`);
    const d = ((await r.json()) as any)?.data?.[0];
    if (d) this.merge({ cryptoFng: { value: Number(d.value), label: String(d.value_classification), updatedMs: Date.now() } });
  }

  async pullStockFng(): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const r = await fetch(`https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${date}`, {
      headers: { "user-agent": UA, referer: "https://www.cnn.com/markets/fear-and-greed" },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) throw new Error(`cnn ${r.status}`);
    const f = ((await r.json()) as any)?.fear_and_greed;
    if (f)
      this.merge({
        stockFng: {
          score: Math.round(f.score),
          rating: String(f.rating),
          previousClose: Math.round(f.previous_close ?? 0),
          updatedMs: Date.now(),
        },
      });
  }

  async pullAaii(): Promise<void> {
    const r = await fetch("https://www.aaii.com/sentimentsurvey", {
      headers: { ...BROWSER_HEADERS, referer: "https://www.google.com/" },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`aaii ${r.status}`);
    const html = await r.text();
    const pick = (cls: string) => {
      const m = html.match(new RegExp(`bar ${cls}"[^>]*width:\\s*([0-9.]+)%`, "i"));
      return m ? Number(m[1]) : undefined;
    };
    const bullish = pick("bullish");
    const neutral = pick("neutral");
    const bearish = pick("bearish");
    const dm = html.match(/datebars"[^>]*>([\s\S]{0,180}?)<\/(?:div|span|p)>/i);
    const date = dm ? dm[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    if (bullish != null && neutral != null && bearish != null)
      this.merge({ aaii: { bullish, neutral, bearish, date, updatedMs: Date.now() } });
  }
}

const loop = (fn: () => Promise<void>, ms: number, signal: AbortSignal, label: string) => {
  const tick = () => {
    if (signal.aborted) return;
    fn().catch((e) => logger.debug({ err: String(e) }, `${label} sentiment failed`));
  };
  tick();
  const id = setInterval(tick, ms);
  signal.addEventListener("abort", () => clearInterval(id));
};

/** Start the three sentiment pollers on their own cadences. */
export function startMarketSentiment(store: MarketSentimentStore, signal: AbortSignal): void {
  loop(() => store.pullCryptoFng(), CRYPTO_MS, signal, "crypto-fng");
  loop(() => store.pullStockFng(), CNN_MS, signal, "stock-fng");
  loop(() => store.pullAaii(), AAII_MS, signal, "aaii");
}
