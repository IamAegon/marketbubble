import type { Portfolio, PortfolioPerformance, PortfolioSeries, PortfolioPoint } from "@app/shared";
import { priceAt, DAY_MS, type PricePoint, type PriceHistoryStore } from "../finance/priceHistory.js";

/** Pick ~weekly sample columns across [start, now], always landing the last on now. */
function sampleTimes(start: number, now: number): number[] {
  const span = Math.max(now - start, DAY_MS);
  const cols = Math.min(9, Math.max(2, Math.round(span / (7 * DAY_MS)) + 1));
  return Array.from({ length: cols }, (_, i) => Math.round(start + (span * i) / (cols - 1)));
}

/** Value of one portfolio at time `t` given each holding's price history. */
function valueAt(p: Portfolio, t: number, hist: Map<string, PricePoint[]>): number {
  const totalWeight = p.calls.reduce((s, c) => s + (c.weight || 0), 0) || 1;
  let value = 0;
  for (const c of p.calls) {
    const alloc = (p.startingCapital * (c.weight || 0)) / totalWeight;
    if (t < c.calledAt) {
      value += alloc; // not deployed yet — sits as cash
      continue;
    }
    const series = hist.get(c.symbol.toUpperCase()) ?? [];
    const entry = c.entryPrice && c.entryPrice > 0 ? c.entryPrice : priceAt(series, c.calledAt);
    if (!entry || entry <= 0) {
      value += alloc; // no entry price → can't value, hold flat
      continue;
    }
    const closed = c.closedAt != null && t >= c.closedAt;
    const cur = closed && c.closePrice ? c.closePrice : priceAt(series, closed ? c.closedAt! : t);
    if (!cur || cur <= 0) {
      value += alloc;
      continue;
    }
    const ratio = cur / entry;
    const contribution = c.side === "short" ? alloc * (2 - ratio) : alloc * ratio;
    value += Math.max(0, contribution);
  }
  return value;
}

/** Compute the full performance series for a set of portfolios. */
export async function computePerformance(portfolios: Portfolio[], store: PriceHistoryStore): Promise<PortfolioPerformance> {
  const now = Date.now();
  const startedAt = portfolios.length ? Math.min(...portfolios.map((p) => p.startedAt)) : now;
  const days = Math.ceil((now - startedAt) / DAY_MS) + 3;
  const items = portfolios.flatMap((p) => p.calls.map((c) => ({ symbol: c.symbol, coingeckoId: c.coingeckoId })));
  const hist = await store.many(items, days);

  const times = sampleTimes(startedAt, now);
  const missing = new Set<string>();

  const series: PortfolioSeries[] = portfolios.map((p) => {
    for (const c of p.calls) {
      if ((hist.get(c.symbol.toUpperCase()) ?? []).length === 0) missing.add(c.symbol);
    }
    const points: PortfolioPoint[] = times.map((t) => {
      const value = valueAt(p, t, hist);
      return { t, value, returnPct: ((value - p.startingCapital) / p.startingCapital) * 100 };
    });
    const last = points[points.length - 1]!;
    return {
      portfolioId: p.id,
      name: p.name,
      color: p.color,
      startingCapital: p.startingCapital,
      holdings: p.calls.map((c) => c.symbol),
      tagline: p.tagline,
      points,
      finalValue: last.value,
      finalReturnPct: last.returnPct,
    };
  });

  let spread: PortfolioPerformance["spread"];
  if (series.length >= 2) {
    // rank by return % so the % and $ figures describe the SAME two baskets
    // (baskets can have different starting capital, so $-leader ≠ %-leader)
    const sorted = [...series].sort((a, b) => b.finalReturnPct - a.finalReturnPct);
    const leader = sorted[0]!;
    const laggard = sorted[sorted.length - 1]!;
    spread = {
      leaderName: leader.name,
      laggardName: laggard.name,
      usd: leader.finalValue - laggard.finalValue,
      pct: leader.finalReturnPct - laggard.finalReturnPct,
    };
  }

  return { startedAt, now, sampleTimes: times, series, spread, missing: [...missing] };
}
