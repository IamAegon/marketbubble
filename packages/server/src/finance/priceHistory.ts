import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../observability/logger.js";

export interface PricePoint {
  t: number;
  p: number;
}

interface CacheEntry {
  fetchedAt: number;
  days: number;
  source: string;
  points: PricePoint[];
}

const TTL_MS = 3 * 60 * 60_000; // daily candles — a few hours is plenty fresh
const DAY = 86_400_000;

/** Symbols Binance does NOT list — skip straight to the alt source. */
const NOT_ON_BINANCE = new Set(["HYPE", "VVV"]);

/**
 * Disk-cached daily price history, keyed by ticker symbol. Pulls from Binance
 * klines first (no key, generous limits), then Hyperliquid (for HYPE-style perps
 * Binance lacks), then CoinGecko as a last resort. Used by the portfolio tracker
 * to value baskets over a date range.
 */
export class PriceHistoryStore {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly cachePath: string) {
    if (existsSync(cachePath)) {
      try {
        const raw = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, CacheEntry>;
        for (const [k, v] of Object.entries(raw)) this.cache.set(k, v);
      } catch {
        /* ignore */
      }
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      writeFileSync(this.cachePath, JSON.stringify(Object.fromEntries(this.cache)));
    } catch {
      /* ignore */
    }
  }

  // --- per-source fetchers (each returns [] on miss/failure) ---

  private async fromBinance(symbol: string, start: number, end: number): Promise<PricePoint[]> {
    if (NOT_ON_BINANCE.has(symbol)) return [];
    try {
      const r = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&startTime=${start}&endTime=${end}&limit=1000`,
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
      );
      if (!r.ok) return [];
      const rows = (await r.json()) as unknown[];
      if (!Array.isArray(rows)) return [];
      return rows
        .map((k) => ({ t: Number((k as any[])[0]), p: Number((k as any[])[4]) }))
        .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p));
    } catch {
      return [];
    }
  }

  private async fromHyperliquid(symbol: string, start: number, end: number): Promise<PricePoint[]> {
    try {
      const r = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "candleSnapshot", req: { coin: symbol, interval: "1d", startTime: start, endTime: end } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) return [];
      const rows = (await r.json()) as { t: number; c: string }[];
      if (!Array.isArray(rows)) return [];
      return rows.map((k) => ({ t: Number(k.t), p: Number(k.c) })).filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p));
    } catch {
      return [];
    }
  }

  private get cgKey(): string | undefined {
    return process.env.COINGECKO_API_KEY?.trim() || undefined;
  }

  /** CoinGecko market_chart — last resort; retries past the free-tier 429. */
  private async fromCoinGecko(coingeckoId: string, days: number, retries = 2): Promise<PricePoint[]> {
    if (!coingeckoId) return [];
    const want = Math.min(365, Math.max(2, Math.ceil(days)));
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.cgKey) headers["x-cg-demo-api-key"] = this.cgKey;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const r = await fetch(
          `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coingeckoId)}/market_chart?vs_currency=usd&days=${want}&interval=daily`,
          { headers, signal: AbortSignal.timeout(12_000) },
        );
        if (r.status === 429 && attempt < retries) {
          await new Promise((res) => setTimeout(res, 1500 * (attempt + 1) ** 2));
          continue;
        }
        if (!r.ok) return [];
        const j = (await r.json()) as { prices?: [number, number][] };
        return (j.prices ?? []).map(([t, p]) => ({ t, p }));
      } catch {
        /* retry / give up */
      }
    }
    return [];
  }

  /** Daily history for a ticker, trying Binance → Hyperliquid → CoinGecko. */
  async seriesFor(symbol: string, coingeckoId: string, days: number): Promise<PricePoint[]> {
    const key = (symbol || "").toUpperCase();
    if (!key) return [];
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < TTL_MS && hit.days >= days) return hit.points;

    const want = Math.min(365, Math.max(2, Math.ceil(days)));
    const end = Date.now();
    const start = end - want * DAY;

    let source = "";
    let points = await this.fromBinance(key, start, end);
    if (points.length) source = "binance";
    if (!points.length) {
      points = await this.fromHyperliquid(key, start, end);
      if (points.length) source = "hyperliquid";
    }
    if (!points.length) {
      points = await this.fromCoinGecko(coingeckoId, want);
      if (points.length) source = "coingecko";
    }

    points = points.sort((a, b) => a.t - b.t);
    if (points.length) {
      this.cache.set(key, { fetchedAt: Date.now(), days: want, source, points });
      this.persist();
      return points;
    }
    return hit?.points ?? []; // stale-but-usable fallback, or empty
  }

  /** Fetch history for many calls; returns a map of SYMBOL → points. */
  async many(items: { symbol: string; coingeckoId: string }[], days: number): Promise<Map<string, PricePoint[]>> {
    const out = new Map<string, PricePoint[]>();
    const seen = new Set<string>();
    for (const it of items) {
      const key = (it.symbol || "").toUpperCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.set(key, await this.seriesFor(it.symbol, it.coingeckoId, days));
      await new Promise((r) => setTimeout(r, 150)); // gentle spacing
    }
    return out;
  }
}

/** The price on or just before time `t` (linear-interpolated); 0 if no data. */
export function priceAt(points: PricePoint[], t: number): number {
  if (!points.length) return 0;
  if (t <= points[0]!.t) return points[0]!.p;
  if (t >= points[points.length - 1]!.t) return points[points.length - 1]!.p;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = points[lo]!;
  const b = points[Math.min(lo + 1, points.length - 1)]!;
  if (b.t === a.t) return a.p;
  const f = (t - a.t) / (b.t - a.t);
  return a.p + (b.p - a.p) * f;
}

export const DAY_MS = DAY;
