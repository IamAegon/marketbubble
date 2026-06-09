import type { PriceTick } from "@app/shared";

// macro assets that aren't dollar-denominated (indices in points, FX index, yield %, vol index)
const NO_DOLLAR = new Set(["SPX", "NASDAQ", "NDX", "DOW", "DXY", "US10Y", "VIX"]);

export function pricePrefix(t: Pick<PriceTick, "symbol" | "kind">): string {
  return t.kind === "macro" && NO_DOLLAR.has(t.symbol) ? "" : "$";
}

export function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}

export function isMacro(t: Pick<PriceTick, "kind">): boolean {
  return t.kind === "macro";
}
