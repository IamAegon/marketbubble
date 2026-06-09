import type { PriceLevels } from "@app/shared";
import { logger } from "../observability/logger.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const YEAR_MS = 365 * 86_400_000;

interface Bar {
  t: number;
  o: number;
  c: number;
}

/** display symbol -> Binance USDT pair (crypto majors) */
const BINANCE: Record<string, string> = {
  BTC: "BTCUSDT",
  SOL: "SOLUSDT",
  ETH: "ETHUSDT",
  BNB: "BNBUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
  AVAX: "AVAXUSDT",
  LINK: "LINKUSDT",
  SUI: "SUIUSDT",
};
/** display symbol -> CoinGecko id (assets Binance/CNBC don't cover) */
const COINGECKO: Record<string, string> = { HYPE: "hyperliquid" };
/** display symbol -> CNBC ticker (indices, FX, metals, bonds, vol) */
const CNBC: Record<string, string> = {
  SPX: ".SPX",
  NASDAQ: ".IXIC",
  NDX: ".NDX",
  DOW: ".DJI",
  DXY: ".DXY",
  US10Y: "US10Y",
  GOLD: "@GC.1",
  SILVER: "@SI.1",
  COPPER: "@HG.1",
  WTI: "@CL.1",
  VIX: ".VIX",
};

/** Cache of per-symbol historical levels, refreshed on a slow timer. */
export class HistoryStore {
  private map = new Map<string, PriceLevels>();
  get(): PriceLevels[] {
    return [...this.map.values()];
  }
  set(l: PriceLevels): void {
    this.map.set(l.symbol, l);
  }
}

/** Build levels from raw daily bars: period opens + 52w range + ~1y close series. */
function toLevels(symbol: string, raw: Bar[]): PriceLevels | null {
  const bars = raw
    .filter((b) => Number.isFinite(b.c) && Number.isFinite(b.t))
    .sort((a, b) => a.t - b.t);
  if (bars.length < 2) return null;
  const now = Date.now();
  const recent = bars.filter((b) => b.t >= now - YEAR_MS);
  const series = (recent.length >= 2 ? recent : bars).slice(-370);

  const d = new Date();
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = dayStart - dow * 86_400_000;
  const last = series[series.length - 1]!;
  const openAt = (boundary: number): number => series.find((p) => p.t >= boundary)?.o ?? last.c;

  const closes = series.map((s) => s.c);
  return {
    symbol,
    dailyOpen: openAt(dayStart),
    weekOpen: openAt(weekStart),
    monthOpen: openAt(monthStart),
    yearOpen: openAt(yearStart),
    yearHigh: Math.max(...closes),
    yearLow: Math.min(...closes),
    series: series.map((p) => ({ t: p.t, c: p.c })),
  };
}

async function fetchBinance(symbol: string, pair: string): Promise<PriceLevels | null> {
  const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&limit=365`, {
    headers: { accept: "application/json" },
  });
  if (!r.ok) return null;
  const rows = (await r.json()) as any[][];
  return toLevels(symbol, rows.map((k) => ({ t: Number(k[0]), o: parseFloat(k[1]), c: parseFloat(k[4]) })));
}

async function fetchCoinGecko(symbol: string, id: string): Promise<PriceLevels | null> {
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`, {
    headers: { accept: "application/json" },
  });
  if (!r.ok) return null;
  const prices: [number, number][] = ((await r.json()) as any)?.prices ?? [];
  return toLevels(symbol, prices.map(([t, c]) => ({ t, o: c, c })));
}

async function fetchCnbc(symbol: string, ticker: string): Promise<PriceLevels | null> {
  const url = `https://ts-api.cnbc.com/harmony/app/charts/1Y.json?symbol=${encodeURIComponent(ticker)}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json" } });
  if (!r.ok) return null;
  const bars: any[] = ((await r.json()) as any)?.barData?.priceBars ?? [];
  return toLevels(
    symbol,
    bars.map((b) => ({ t: Number(b.tradeTimeinMills), o: parseFloat(b.open), c: parseFloat(b.close) })),
  );
}

/**
 * Periodically fetch ~1y of daily candles per asset and cache period opens +
 * series. Binance (crypto) / CoinGecko (HYPE) / CNBC (macro) — all reachable
 * from Node. Slow + staggered; failures keep the last cached value.
 */
export function startHistory(store: HistoryStore, signal: AbortSignal): void {
  const jobs: { sym: string; fn: () => Promise<PriceLevels | null> }[] = [
    ...Object.entries(BINANCE).map(([sym, p]) => ({ sym, fn: () => fetchBinance(sym, p) })),
    ...Object.entries(COINGECKO).map(([sym, id]) => ({ sym, fn: () => fetchCoinGecko(sym, id) })),
    ...Object.entries(CNBC).map(([sym, t]) => ({ sym, fn: () => fetchCnbc(sym, t) })),
  ];
  let stopped = false;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const runAll = async () => {
    for (const job of jobs) {
      if (stopped) return;
      try {
        const l = await job.fn();
        if (l) store.set(l);
      } catch (e) {
        logger.debug({ sym: job.sym, err: String(e) }, "history fetch failed");
      }
      await sleep(1200);
    }
    logger.info({ symbols: store.get().length }, "market history refreshed");
  };

  void runAll();
  const timer = setInterval(() => void runAll(), 15 * 60_000);
  timer.unref?.();
  signal.addEventListener(
    "abort",
    () => {
      stopped = true;
      clearInterval(timer);
    },
    { once: true },
  );
}
